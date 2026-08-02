const { io } = require('socket.io-client');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const os = require('os');
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
    const urlToUse = downloadUrl || pdfUrl;
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

    // Print PDF silently
    await printPdfSilent(tempFilePath, {
      printerName: currentConfig.selectedPrinter,
      pages: pagesToPrint,
      copies: copies || 1,
      colorMode: colorMode || 'BW',
    });

    // Report success
    reportJobStatus(jobId, 'COMPLETED');
    showDesktopNotification('Print Completed Successfully!', `Printed on ${currentConfig.selectedPrinter || 'Default Printer'}`);

  } catch (err) {
    console.error('[Job Execution Error]:', err.message);

    const isOffline = err.message.includes('PRINTER_OFFLINE');
    const statusToReport = isOffline ? 'PRINTER_OFFLINE' : 'FAILED';

    reportJobStatus(jobId, statusToReport, err.message);
    showDesktopNotification('Print Failed', err.message);
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
  });

  socket.on('job:new_print', (data) => {
    processPrintJob(data);
  });

  socket.on('disconnect', () => {
    console.warn(`[Socket.IO] Disconnected from backend. Reconnecting / HTTP polling fallback active.`);
  });

  socket.on('connect_error', (err) => {
    console.warn('[Socket.IO Connection Error]:', err.message);
  });

  // Start HTTP Long-Polling Fallback
  startPollingFallback();
}

function init() {
  const config = loadConfig();

  // Check if force reconfiguration flag or unconfigured
  const isSilentRun = process.argv.includes('--silent');
  const isForceConfig = process.argv.includes('--configure');

  if (isForceConfig || !config.isConfigured || !config.agentToken) {
    console.log('[Setup] Launching initial configuration GUI window...');
    startConfigGui((newConfig) => {
      startAgentEngine(newConfig);
    });
  } else {
    startAgentEngine(config);
  }
}

init();
