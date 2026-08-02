const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { loadConfig, saveConfig } = require('./configManager');
const { getHardwareFingerprint } = require('./hardwareFingerprint');
const { enableAutoStart } = require('./autoStartService');
const { getAvailablePrinters, printPdfSilent } = require('./printerService');
const { startConfigGui } = require('./gui');
const { showDesktopNotification } = require('./systemTray');

let socket = null;
let currentConfig = null;
let hardwareInfo = null;

async function processPrintJob(jobData) {
  const { jobId, downloadUrl, pdfUrl, pagesToPrint, copies, colorMode, customerName, paymentStatus } = jobData;

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

  showDesktopNotification('New Print Job Received!', `Printing ${customerName}'s PDF document...`);

  // Update status to PRINTING
  reportJobStatus(jobId, 'PRINTING');

  const tempFilePath = path.join(os.tmpdir(), `auto_print_${jobId}_${Date.now()}.pdf`);

  try {
    // Download PDF file
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

    fs.writeFileSync(tempFilePath, Buffer.from(response.data));
    console.log(`[Download] PDF saved to temporary path: ${tempFilePath}`);

    // Auto-detect best available printer
    // Priority: 1) Real physical printer 2) Configured printer 3) Windows default
    let printerToUse = currentConfig.selectedPrinter || null;

    const allPrinters = await getAvailablePrinters();
    const VIRTUAL_PRINTERS = ['microsoft print to pdf', 'microsoft xps', 'onenote', 'fax', 'adobe pdf', 'bullzip', 'dopdf', 'cutepdf'];
    const physicalPrinters = allPrinters.filter(p => {
      const name = (p.name || '').toLowerCase();
      return !VIRTUAL_PRINTERS.some(v => name.includes(v));
    });

    if (physicalPrinters.length > 0) {
      // Use default physical printer if available, else first physical printer
      const defaultPhysical = physicalPrinters.find(p => p.isDefault);
      printerToUse = defaultPhysical ? defaultPhysical.name : physicalPrinters[0].name;
      console.log(`[Printer Auto-Detect] Physical printer found: "${printerToUse}"`);
    } else if (!printerToUse) {
      // No physical printer, use system default
      const defaultPrinter = allPrinters.find(p => p.isDefault);
      printerToUse = defaultPrinter ? defaultPrinter.name : null;
      console.log(`[Printer Auto-Detect] Using system default: "${printerToUse}"`);
    } else {
      console.log(`[Printer Auto-Detect] No physical printer found, using configured: "${printerToUse}"`);
    }

    // Print PDF silently
    await printPdfSilent(tempFilePath, {
      printerName: printerToUse,
      pages: pagesToPrint,
      copies: copies || 1,
      colorMode: colorMode || 'BW',
    });

    // Report success
    reportJobStatus(jobId, 'COMPLETED');
    showDesktopNotification('Print Completed Successfully!', `Printed on ${printerToUse || 'Default Printer'}`);

  } catch (err) {
    console.error('[Job Execution Error]:', err.message);

    const isOffline = err.message.includes('PRINTER_OFFLINE') || err.message.includes('ECONNREFUSED');
    const statusToReport = isOffline ? 'PRINTER_OFFLINE' : 'FAILED';
    reportJobStatus(jobId, statusToReport, err.message);

    // === WINDOWS SAVE DIALOG POPUP ===
    // Printer nahi mila → User se puchho PDF kahan save karein
    if (fs.existsSync(tempFilePath)) {
      try {
        const safeCustomer = (customerName || 'Customer').replace(/[^a-z0-9]/gi, '_');
        const suggestedName = `PrintJob_${safeCustomer}_${jobId.substring(0, 8)}.pdf`;
        const dialogScript = path.join(__dirname, '..', 'save_dialog.ps1');

        console.log(`[Save Dialog] Printer not found. Showing save dialog to user...`);
        showDesktopNotification('Printer Nahi Mila!', 'Popup aya hai - PDF save karne ki location choose karein');

        // Run PowerShell Save File Dialog and get user chosen path
        const savePath = execSync(
          `powershell -ExecutionPolicy Bypass -WindowStyle Normal -File "${dialogScript}" -FileName "${suggestedName}" -CustomerName "${safeCustomer}" -JobId "${jobId}"`,
          { encoding: 'utf8', timeout: 120000 }
        ).trim();

        if (savePath && savePath !== 'CANCELLED' && savePath.length > 0) {
          fs.copyFileSync(tempFilePath, savePath);
          console.log(`[PDF Saved] User selected path: ${savePath}`);
          showDesktopNotification('PDF Save Ho Gayi! ✅', `Saved: ${path.basename(savePath)}`);
          reportJobStatus(jobId, 'COMPLETED');
        } else {
          console.log(`[PDF Save] User cancelled the save dialog.`);
          showDesktopNotification('PDF Save Cancel', 'Aapne save dialog cancel kar diya.');
        }
      } catch (dialogErr) {
        console.warn('[Save Dialog Error]:', dialogErr.message);
        // Fallback: auto-save to Desktop
        try {
          const safeCustomer = (customerName || 'Customer').replace(/[^a-z0-9]/gi, '_');
          const fallbackPath = path.join(os.homedir(), 'Desktop', `PrintJob_${safeCustomer}_${jobId.substring(0,8)}.pdf`);
          fs.copyFileSync(tempFilePath, fallbackPath);
          console.log(`[PDF Fallback] Saved to Desktop: ${fallbackPath}`);
          showDesktopNotification('PDF Desktop Pe Saved!', `PrintJob_${safeCustomer}_${jobId.substring(0,8)}.pdf`);
        } catch (fbErr) {
          console.error('[PDF Fallback Error]:', fbErr.message);
        }
      }
    }
  } finally {
    // Delete temp PDF immediately
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

    // Auto-close terminal window and hand over to background hidden process
    const isBackgroundRun = process.argv.includes('--background') || process.argv.includes('--silent');
    if (!isBackgroundRun && process.platform === 'win32') {
      try {
        const exePath = process.execPath;
        const cmd = `powershell -Command "Start-Process '${exePath}' -WindowStyle Hidden -ArgumentList '--background'"`;
        require('child_process').exec(cmd);
        setTimeout(() => {
          process.exit(0);
        }, 500);
      } catch (e) {
        // Fallback
      }
    }
  });

  socket.on('job:new_print', (data) => {
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
  const isBackgroundRun = process.argv.includes('--background') || process.argv.includes('--silent');

  // If launched via double-click or CLI without background flag, instantly detach into hidden wscript background process
  if (!isBackgroundRun && !isForceConfig && process.platform === 'win32') {
    try {
      const exePath = process.execPath;
      const configDir = path.join(require('os').homedir(), 'AppData', 'Roaming', 'AutoPrintAgent');
      if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
      const vbsPath = path.join(configDir, 'launch_hidden.vbs');
      const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${exePath}"" --background", 0, False\n`;
      fs.writeFileSync(vbsPath, vbsContent, 'utf-8');
      
      require('child_process').exec(`wscript.exe "${vbsPath}"`);
      process.exit(0);
    } catch (e) {
      // Fallback if spawn fails
    }
  }

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
