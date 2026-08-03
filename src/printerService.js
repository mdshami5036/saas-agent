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

async function printPdfSilent(filePath, options = {}) {
  const { printerName, pages, copies = 1, colorMode = 'BW' } = options;

  const printOptions = {
    paperSize: 'A4',
  };

  if (printerName) {
    printOptions.printer = printerName;
  }

  if (copies && copies > 1) {
    printOptions.copies = copies;
  }

  if (pages && pages.toUpperCase() !== 'ALL') {
    printOptions.pages = pages;
  }

  // Set B&W vs COLOR strictly based on website command
  if (colorMode === 'COLOR') {
    printOptions.monochrome = false;
  } else {
    printOptions.monochrome = true;
  }

  console.log(`[Printer Engine] Sending Direct Silent Print Command for "${filePath}"...`, printOptions);

  try {
    await pdfToPrinter.print(filePath, printOptions);
    console.log('[Printer Engine] Direct silent print command sent successfully!');
    return true;
  } catch (err) {
    console.error('[Printer Engine Error]:', err.message);
    throw err;
  }
}

module.exports = {
  getAvailablePrinters,
  printPdfSilent,
};
