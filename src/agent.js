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

const jobQueue = [];
let isProcessingQueue = false;

function execAsync(command, options = {}) {
  return new Promise((resolve) => {
    exec(command, options, (error, stdout, stderr) => {
      resolve({ error, stdout: stdout ? stdout.trim() : '', stderr });
    });
  });
}

function enqueuePrintJob(jobData) {
  if (!jobData || !jobData.jobId) return;
  console.log(`[Queue] Received job #${jobData.jobId}. Adding to queue (Total queued: ${jobQueue.length + 1})...`);
  jobQueue.push(jobData);
  processNextJobInQueue();
}

async function processNextJobInQueue() {
  if (isProcessingQueue) return;
  if (jobQueue.length === 0) return;

  isProcessingQueue = true;
  const currentJob = jobQueue.shift();

  try {
    await processPrintJob(currentJob);
  } catch (err) {
    console.error(`[Queue Processing Error] Job #${currentJob.jobId}:`, err.message);
  } finally {
    isProcessingQueue = false;
    setTimeout(processNextJobInQueue, 300);
  }
}

async function processPrintJob(jobData) {
  const { jobId, downloadUrl, pdfUrl, pdfBase64, pagesToPrint, copies, colorMode, customerName } = jobData;

  console.log(`\n========================================================`);
  console.log(`[Job Dispatch] Received Print Job #${jobId} for ${customerName || 'Customer'}`);
  console.log(`[Options] Pages: ${pagesToPrint}, Copies: ${copies}, Mode: ${colorMode}`);

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

    if (!rawBuffer || rawBuffer.length === 0) {
      throw new Error('PDF Buffer is empty');
    }

    // Extract exact pages requested by customer (e.g., page 1 of 6) with fallback to rawBuffer
    let finalPdfBuffer = rawBuffer;
    try {
      finalPdfBuffer = await extractSelectedPages(rawBuffer, pagesToPrint);
    } catch (sliceErr) {
      console.warn(`[PDF Slicer Warning] Page extraction fallback to full PDF: ${sliceErr.message}`);
      finalPdfBuffer = rawBuffer;
    }

    fs.writeFileSync(tempFilePath, finalPdfBuffer || rawBuffer);
    console.log(`[Download] Processed PDF saved to temporary path: ${tempFilePath}`);

    // Update status to PRINTING
    reportJobStatus(jobId, 'PRINTING');

    // Directly send Silent Print Command to Windows Printer (No checking or filtering)
    const targetPrinter = currentConfig ? currentConfig.selectedPrinter : null;

    console.log(`[Direct Silent Print] Sending print command for Job #${jobId} (${colorMode === 'COLOR' ? 'COLOR' : 'B&W'}, A4, Copies: ${copies || 1})...`);

    await printPdfSilent(tempFilePath, {
      printerName: targetPrinter,
      pages: pagesToPrint,
      copies: copies || 1,
      colorMode: colorMode || 'BW',
    });

    reportJobStatus(jobId, 'COMPLETED');
    showDesktopNotification('Print Ho Gaya! ✅', `Command Sent (${colorMode === 'COLOR' ? 'COLOR' : 'B&W'}, A4)`);

  } catch (err) {
    console.error('[Job Execution Error]:', err.message);

    // Ultimate Fallback: Save to Desktop\AutoPrint_SavedJobs if physical print or slicer failed
    let savedFallback = false;
    try {
      const safeCustomer = (customerName || 'Customer').replace(/[^a-z0-9]/gi, '_');
      const desktopJobsDir = path.join(os.homedir(), 'Desktop', 'AutoPrint_SavedJobs');
      if (!fs.existsSync(desktopJobsDir)) {
        fs.mkdirSync(desktopJobsDir, { recursive: true });
      }
      const fallbackPath = path.join(desktopJobsDir, `PrintJob_${safeCustomer}_${jobId.substring(0, 8)}.pdf`);

      if (fs.existsSync(tempFilePath)) {
        fs.copyFileSync(tempFilePath, fallbackPath);
        savedFallback = true;
      }

      if (savedFallback) {
        console.log(`[PDF Saved to Desktop Fallback] Saved: ${fallbackPath}`);
        execAsync(`explorer.exe /select,"${fallbackPath}"`).catch(() => {});
        showDesktopNotification('PDF Saved to Laptop! ✅', `Location: ${path.basename(fallbackPath)}`);
        reportJobStatus(jobId, 'COMPLETED');
      }
    } catch (fbErr) {
      console.error('[PDF Fallback Error]:', fbErr.message);
    }

    if (!savedFallback) {
      const isOffline = err.message.includes('PRINTER_OFFLINE') || err.message.includes('ECONNREFUSED');
      const statusToReport = isOffline ? 'PRINTER_OFFLINE' : 'FAILED';
      reportJobStatus(jobId, statusToReport, err.message);
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
        enqueuePrintJob(res.data.job);
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
    enqueuePrintJob(data);
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
