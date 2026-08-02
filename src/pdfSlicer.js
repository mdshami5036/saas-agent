const { PDFDocument } = require('pdf-lib');

/**
 * Extracts specified pages from a PDF buffer according to pagesToPrint expression.
 * @param {Buffer} pdfBuffer - Original PDF file buffer
 * @param {string} pagesToPrint - Range string e.g. "1", "1-3", "1,3,5", "ALL"
 * @returns {Promise<Buffer>} - Sliced PDF buffer containing only selected pages
 */
async function extractSelectedPages(pdfBuffer, pagesToPrint) {
  if (!pagesToPrint || pagesToPrint.toUpperCase() === 'ALL') {
    return pdfBuffer;
  }

  try {
    const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    const totalPagesCount = srcDoc.getPageCount();

    const pageIndices = [];
    const parts = String(pagesToPrint).split(',');

    for (const part of parts) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [startStr, endStr] = trimmed.split('-');
        const start = parseInt(startStr, 10);
        const end = parseInt(endStr, 10);
        if (!isNaN(start) && !isNaN(end)) {
          for (let i = Math.max(1, start); i <= Math.min(totalPagesCount, end); i++) {
            pageIndices.push(i - 1); // 0-indexed for pdf-lib
          }
        }
      } else {
        const pageNum = parseInt(trimmed, 10);
        if (!isNaN(pageNum) && pageNum >= 1 && pageNum <= totalPagesCount) {
          pageIndices.push(pageNum - 1);
        }
      }
    }

    if (pageIndices.length === 0) {
      return pdfBuffer;
    }

    // Deduplicate indices while preserving order
    const uniqueIndices = [...new Set(pageIndices)];

    const dstDoc = await PDFDocument.create();
    const copiedPages = await dstDoc.copyPages(srcDoc, uniqueIndices);
    copiedPages.forEach((page) => dstDoc.addPage(page));

    const slicedPdfBytes = await dstDoc.save();
    console.log(`[PDF Slicer] Extracted ${uniqueIndices.length} page(s) (${pagesToPrint}) out of ${totalPagesCount} total pages.`);
    return Buffer.from(slicedPdfBytes);
  } catch (err) {
    console.warn('[PDF Slicer Warning] Failed to slice PDF pages, using original:', err.message);
    return pdfBuffer;
  }
}

module.exports = {
  extractSelectedPages,
};
