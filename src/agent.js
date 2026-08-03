const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { exec } = require('child_process');
const { loadConfig, saveConfig } = require('./configManager');
const { getHardwareFingerprint } = require('./hardwareFingerprint');
const { enableAutoStart } = require('./autoStartService');
const { getAvailablePrinters, printPdfSilent } = require('./printerService');
const { startConfigGui } = require('./gui');
const { showDesktopNotification } = require('./systemTray');
const { extractSelectedPages } = require('./pdfSlicer');

let socket = null;
let currentConfig = null;
let hardwareInfo = null;

function execAsync(command, options = {}) {
  return new Promise((resolve) => {
    exec(command, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ? stdout.trim() : '', stderr });
    });
  });
}

async function processPrintJob(jobData) {
  const { jobId, downloadUrl, pdfUrl, pdfBase64, pagesToPrint, copies, colorMode, customerName, paymentStatus } = jobData;

  // STRICT SECURITY CHECK: Never print unpaid jobs!
  if (paymentStatus && paymentStatus !== 'SUCCESS' && paymentStatus !== 'COMPLETED') {
    console.error(`[Security Violation] Aborting print for unpaid job #${jobId} (paymentStatus: ${paymentStatus}).`);
    reportJobStatus(jobId, 'FAILED', 'Unpaid print job rejected by agent security');
    showDesktopNotification('Print Rejected', 'Unpaid print job ignored by agent security');
    return;
  }

  console.log(`\n========================================================`);
  console.log(`[Job Dispatch] Received Paid Print Job #${jobId} for ${customerName}`);
  console.log(`[Options] Pages: ${pagesToPrint}, Copies: ${copies}, Mode: ${colorMode}, Payment: ${paymentStatus || 'SUCCESS'}`);

  const tempFilePath = path.join(os.tmpdir(), `print_job_${jobId}_${Date.now()}.pdf`);

  try {
    let rawBuffer = null;

    if (pdfBase64) {
      rawBuffer = Buffer.from(pdfBase64, 'base64');
      console.log(`[Zero-Storage] Received in-memory PDF buffer (${rawBuffer.length} bytes)...`);
    } else {
      let urlToUse = downloadUrl || pdfUrl;
      // Fix localhost URLs - replace with real backend Railway URL
      if (urlToUse) {
        urlToUse = urlToUse
          .replace('http://localhost:5000', 'https://saas-backend-production-5c3e.up.railway.app')
          .replace('http://127.0.0.1:5000', 'https://saas-backend-production-5c3e.up.railway.app');
      }
      if (urlToUse && !urlToUse.startsWith('http')) {
        const serverRoot = (currentConfig.backendUrl || 'https://saas-backend-production-5c3e.up.railway.app').replace(/\/api\/v1\/?$/, '');
        urlToUse = `${serverRoot}${urlToUse.startsWith('/') ? '' : '/'}${urlToUse}`;
      }
      console.log(`[Download] Downloading PDF from ${urlToUse}...`);

      const response = await axios({
        method: 'GET',
        url: urlToUse,
        responseType: 'arraybuffer',
        headers: {
          'X-Agent-Token': currentConfig.agentToken,
        },
      });
      rawBuffer = Buffer.from(response.data);
    }

    // Extract exact pages requested by customer (e.g., page 1 of 6)
    const finalPdfBuffer = await extractSelectedPages(rawBuffer, pagesToPrint);

    fs.writeFileSync(tempFilePath, finalPdfBuffer);
    console.log(`[Download] Processed PDF saved to temporary path: ${tempFilePath}`);

    // Update status to PRINTING
    reportJobStatus(jobId, 'PRINTING');

    // Auto-detect best available PHYSICAL printer
    const allPrinters = await getAvailablePrinters();
    const VIRTUAL_PRINTERS = ['microsoft print to pdf', 'microsoft xps', 'onenote', 'fax', 'adobe pdf', 'bullzip', 'dopdf', 'cutepdf'];
    const physicalPrinters = allPrinters.filter(p => {
      const name = (p.name || '').toLowerCase();
      return !VIRTUAL_PRINTERS.some(v => name.includes(v));
    });

    if (physicalPrinters.length === 0) {
      // ======================================================
      // NO PHYSICAL PRINTER CONNECTED → Save PDF to Laptop
      // ======================================================
      console.log(`[Printer Auto-Detect] No physical printer connected. Showing Save File Popup...`);

      const safeCustomer = (customerName || 'Customer').replace(/[^a-z0-9]/gi, '_');
      const suggestedName = `PrintJob_${safeCustomer}_${jobId.substring(0, 8)}.pdf`;
      const dialogScript = path.join(__dirname, '..', 'save_dialog.ps1');

      let savedPath = null;

      // 1. Non-blocking interactive Save File Dialog popup using asynchronous execAsync
      const resultFile = path.join(os.tmpdir(), `save_path_${Date.now()}.txt`);
      try {
        if (fs.existsSync(resultFile)) fs.unlinkSync(resultFile);
        const cmd = `cmd /c start /wait powershell -ExecutionPolicy Bypass -File "${dialogScript}" -FileName "${suggestedName}" -OutFile "${resultFile}"`;
        
        await execAsync(cmd, { timeout: 45000 });

        if (fs.existsSync(resultFile)) {
          const chosen = fs.readFileSync(resultFile, 'utf8').trim();
          fs.unlinkSync(resultFile);
          if (chosen && chosen !== 'CANCELLED' && chosen.length > 3) {
            savedPath = chosen;
          }
        }
      } catch (dialogErr) {
        console.warn('[Save Dialog Warning]:', dialogErr.message);
      }

      // 2. Fallback: Save directly to Desktop\AutoPrint_SavedJobs folder if cancelled or timed out
      if (!savedPath) {
        const desktopJobsDir = path.join(os.homedir(), 'Desktop', 'AutoPrint_SavedJobs');
        if (!fs.existsSync(desktopJobsDir)) {
          fs.mkdirSync(desktopJobsDir, { recursive: true });
        }
        savedPath = path.join(desktopJobsDir, suggestedName);
      }

      // 3. Save trimmed PDF file
      fs.copyFileSync(tempFilePath, savedPath);
      console.log(`[PDF Saved] File saved to laptop: ${savedPath}`);

      // 4. Auto-open File Explorer asynchronously without blocking
      execAsync(`explorer.exe /select,"${savedPath}"`).catch(() => {});

      // 5. Report COMPLETED status to backend
      reportJobStatus(jobId, 'COMPLETED');
      showDesktopNotification('PDF Saved to Laptop! ✅', `Location: ${path.basename(savedPath)}`);

    } else {
      // ======================================================
      // PHYSICAL PRINTER FOUND → Print directly
      // ======================================================
      const defaultPhysical = physicalPrinters.find(p => p.isDefault);
      const printerToUse = defaultPhysical ? defaultPhysical.name : physicalPrinters[0].name;
      console.log(`[Printer Auto-Detect] Physical printer found: "${printerToUse}"`);

      await printPdfSilent(tempFilePath, {
        printerName: printerToUse,
        pages: pagesToPrint,
        copies: copies || 1,
        colorMode: colorMode || 'BW',
      });

      reportJobStatus(jobId, 'COMPLETED');
      showDesktopNotification('Print Ho Gaya! ✅', `Printed on "${printerToUse}"`);
    }

  } catch (err) {
    console.error('[Job Execution Error]:', err.message);

    const isOffline = err.message.includes('PRINTER_OFFLINE') || err.message.includes('ECONNREFUSED');
    const statusToReport = isOffline ? 'PRINTER_OFFLINE' : 'FAILED';
    reportJobStatus(jobId, statusToReport, err.message);

    // Fallback: Save to Desktop\AutoPrint_SavedJobs if job processing failed midway
    try {
      const safeCustomer = (customerName || 'Customer').replace(/[^a-z0-9]/gi, '_');
      const fallbackPath = path.join(os.homedir(), 'Desktop', 'AutoPrint_SavedJobs', `PrintJob_${safeCustomer}_${jobId.substring(0,8)}.pdf`);
      if (fs.existsSync(tempFilePath)) {
        const fallbackDir = path.dirname(fallbackPath);
        if (!fs.existsSync(fallbackDir)) fs.mkdirSync(fallbackDir, { recursive: true });
        fs.copyFileSync(tempFilePath, fallbackPath);
        showDesktopNotification('PDF Saved to Desktop!', `Saved at: ${path.basename(fallbackPath)}`);
        reportJobStatus(jobId, 'COMPLETED');
      }
    } catch (fbErr) {
      console.error('[PDF Fallback Error]:', fbErr.message);
    }
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlink(tempFilePath, (unlinkErr) => {
        if (!unlinkErr) console.log(`[Cleanup] Local temp PDF deleted: ${tempFilePath}`);
      });
    }
    console.log(`========================================================\n`);
  }
}

function reportJobStatus(jobId, status, errorMessage = null) {
  if (socket && socket.connected) {
    socket.emit('job:status_update', {
      jobId,
      status,
      errorMessage,
      printerName: currentConfig.selectedPrinter,
    });
  } else {
    // HTTP Fallback status update
    axios
      .post(
        `${currentConfig.backendUrl}/api/v1/agent/jobs/${jobId}/status`,
        { status, errorMessage, printerName: currentConfig.selectedPrinter },
        { headers: { 'X-Agent-Token': currentConfig.agentToken } }
      )
      .catch((e) => console.warn('[HTTP Fallback Status Report Error]:', e.message));
  }
}

// HTTP Long-Polling Fallback Worker
function startPollingFallback() {
  setInterval(async () => {
    if (socket && socket.connected) return; // WebSocket active, skip polling

    try {
      const res = await axios.get(`${currentConfig.backendUrl}/api/v1/agent/poll`, {
        headers: { 'X-Agent-Token': currentConfig.agentToken },
      });

      if (res.data.success && res.data.hasJob && res.data.job) {
        await processPrintJob(res.data.job);
      }
    } catch (err) {
      // silent polling catch
    }
  }, 3000);
}

async function startAgentEngine(config) {
  currentConfig = config;
  hardwareInfo = getHardwareFingerprint();

  console.log(`\n========================================================`);
  console.log(`🚀 AutoPrint Windows Agent Engine v1.0.0 Started`);
  console.log(`💻 Hardware Device ID: ${hardwareInfo.deviceId}`);
  console.log(`📡 Backend URL: ${config.backendUrl}`);
  console.log(`🖨️ Selected Printer: ${config.selectedPrinter || 'Windows Default Printer'}`);
  console.log(`========================================================\n`);

  // Enable Windows auto-start on boot
  enableAutoStart();

  // Connect via Socket.IO WebSocket
  socket = io(config.backendUrl, {
    transports: ['websocket', 'polling'],
    query: {
      agentToken: config.agentToken,
      deviceId: hardwareInfo.deviceId,
      hardwareHash: hardwareInfo.hardwareHash,
    },
    reconnection: true,
    reconnectionDelay: 2000,
  });

  socket.on('connect', async () => {
    console.log(`[Socket.IO] Connected to backend! Registering printers...`);

    const printers = await getAvailablePrinters();
    socket.emit('agent:printers', {
      printers,
      selectedPrinter: config.selectedPrinter,
    });
    socket.emit('agent:heartbeat', { selectedPrinter: config.selectedPrinter });
  });

  // 15-Second Heartbeat loop to keep device ONLINE 24/7 without flickering
  setInterval(() => {
    if (socket && socket.connected) {
      socket.emit('agent:heartbeat', {
        selectedPrinter: config.selectedPrinter,
      });
    }
  }, 15000);

  socket.on('job:new_print', (data) => {
    console.log(`[Job Dispatch Event Received] Job ID: ${data.jobId}`);
    processPrintJob(data);
  });

  socket.on('disconnect', () => {
    console.warn(`[Socket.IO] Disconnected from backend. Reconnecting / HTTP polling fallback active.`);
  });

  let guiOpenedOnErr = false;
  socket.on('connect_error', (err) => {
    console.warn('[Socket.IO Connection Error]:', err.message);
    if (err.message.includes('Invalid or inactive tenant') && !guiOpenedOnErr) {
      guiOpenedOnErr = true;
      console.log('[Setup] Token invalid or expired. Launching configuration GUI window...');
      showDesktopNotification('Agent Setup Needed', 'Invalid Token. Please enter your new Agent Token.');
      startConfigGui((newConfig) => {
        guiOpenedOnErr = false;
        if (socket) socket.close();
        startAgentEngine(newConfig);
      });
    }
  });

  // Start HTTP Long-Polling Fallback
  startPollingFallback();
}

function init() {
  const config = loadConfig();
  const isForceConfig = process.argv.includes('--configure');

  if (isForceConfig || !config.isConfigured || !config.agentToken) {
    console.log('[Setup] Launching configuration GUI window...');
    startConfigGui((newConfig) => {
      startAgentEngine(newConfig);
    });
  } else {
    startAgentEngine(config);
  }
}

init();
