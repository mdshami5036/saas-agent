const pdfToPrinter = require('pdf-to-printer');
const { exec } = require('child_process');

async function getAvailablePrinters() {
  try {
    const printers = await pdfToPrinter.getPrinters();
    return printers.map((p) => ({
      name: p.name,
      isDefault: p.isDefault || false,
    }));
  } catch (err) {
    console.warn('[Printer] pdf-to-printer enumeration fallback to PowerShell:', err.message);
    return new Promise((resolve) => {
      exec('powershell -Command "Get-Printer | Select-Object Name, IsDefault | ConvertTo-Json"', (error, stdout) => {
        if (error || !stdout) {
          return resolve([{ name: 'Default Windows Printer', isDefault: true }]);
        }
        try {
          const parsed = JSON.parse(stdout);
          const list = Array.isArray(parsed) ? parsed : [parsed];
          resolve(list.map((p) => ({ name: p.Name, isDefault: p.IsDefault })));
        } catch (e) {
          resolve([{ name: 'Default Windows Printer', isDefault: true }]);
        }
      });
    });
  }
}

async function checkPrinterOnlineStatus(printerName) {
  if (process.platform !== 'win32') return true;
  if (!printerName) return true;
  if (printerName.toLowerCase().includes('pdf') || printerName.toLowerCase().includes('xps') || printerName.toLowerCase().includes('onenote')) {
    return true;
  }

  return new Promise((resolve) => {
    const cmd = `powershell -Command "Get-Printer -Name '${printerName}' | Select-Object PrinterStatus, WorkOffline | ConvertTo-Json"`;
    exec(cmd, (error, stdout) => {
      if (error || !stdout) return resolve(true); // fallback to true
      try {
        const parsed = JSON.parse(stdout);
        const target = Array.isArray(parsed) ? parsed[0] : parsed;
        if (target && target.WorkOffline === true) {
          return resolve(false);
        }
        resolve(true);
      } catch (e) {
        resolve(true);
      }
    });
  });
}

async function printPdfSilent(filePath, options = {}) {
  const { printerName, pages, copies = 1, colorMode = 'BW' } = options;

  // Verify printer online status
  const isOnline = await checkPrinterOnlineStatus(printerName);
  if (!isOnline) {
    throw new Error('PRINTER_OFFLINE: Printer is currently offline or unreachable');
  }

  const printOptions = {};
  if (printerName) printOptions.printer = printerName;
  if (copies && copies > 1) printOptions.copies = copies;
  if (pages && pages.toUpperCase() !== 'ALL') printOptions.pages = pages;
  if (colorMode === 'COLOR') printOptions.monochrome = false;
  else if (colorMode === 'BW') printOptions.monochrome = true;

  console.log(`[Printer Engine] Silent printing ${filePath} to printer "${printerName || 'Default'}"`, printOptions);

  try {
    await pdfToPrinter.print(filePath, printOptions);
    console.log('[Printer Engine] Silent print completed successfully!');
    return true;
  } catch (err) {
    console.error('[Printer Engine Error]:', err.message);
    throw err;
  }
}

module.exports = {
  getAvailablePrinters,
  checkPrinterOnlineStatus,
  printPdfSilent,
};
