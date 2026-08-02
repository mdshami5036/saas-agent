const express = require('express');
const open = require('open');
const { loadConfig, saveConfig } = require('./configManager');
const { getAvailablePrinters } = require('./printerService');

let guiServer = null;

async function startConfigGui(onSaveCallback) {
  const app = express();
  app.use(express.json());

  app.get('/', async (req, res) => {
    const config = loadConfig();
    const printers = await getAvailablePrinters();

    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>AutoPrint Agent Setup</title>
        <meta charset="UTF-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #f8fafc; margin: 0; padding: 40px; display: flex; justify-content: center; align-items: center; min-height: 80vh; }
          .card { background: #1e293b; border: 1px solid #334155; border-radius: 16px; padding: 32px; width: 100%; max-width: 440px; box-shadow: 0 20px 25px -5px rgba(0,0,0,0.5); }
          h2 { font-size: 24px; font-weight: 800; margin-top: 0; color: #38bdf8; text-align: center; }
          p { color: #94a3b8; font-size: 13px; text-align: center; margin-bottom: 24px; }
          label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: #cbd5e1; }
          input, select { width: 100%; padding: 10px 12px; background: #0f172a; border: 1px solid #475569; border-radius: 8px; color: white; font-size: 14px; box-sizing: border-box; margin-bottom: 16px; }
          button { width: 100%; padding: 12px; background: linear-gradient(135deg, #0284c7, #2563eb); border: none; border-radius: 8px; color: white; font-size: 14px; font-weight: 700; cursor: pointer; transition: opacity 0.2s; }
          button:hover { opacity: 0.9; }
          .badge { display: inline-block; background: rgba(56,189,248,0.1); color: #38bdf8; padding: 4px 12px; border-radius: 99px; font-size: 11px; font-weight: 700; text-align: center; margin-bottom: 12px; }
          .center { text-align: center; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="center">
            <span class="badge">Windows Print Agent</span>
            <h2>${config.cafeName ? `Hello, ${config.cafeName}!` : 'AutoPrint Setup'}</h2>
            <p>Select your Windows printer & save setup to begin silent auto-printing.</p>
          </div>
          <form id="setupForm">
            <label>Backend API URL</label>
            <input type="text" id="backendUrl" value="${config.backendUrl || 'http://localhost:5000'}" required />

            <label>Agent Token (ag_...)</label>
            <input type="text" id="agentToken" value="${config.agentToken || ''}" required placeholder="ag_xxxxxxxx" />

            <label>Select Saved Windows Printer</label>
            <select id="selectedPrinter">
              ${printers
                .map(
                  (p) =>
                    `<option value="${p.name}" ${p.name === config.selectedPrinter || p.isDefault ? 'selected' : ''}>${p.name} ${p.isDefault ? '(Default)' : ''}</option>`
                )
                .join('')}
            </select>

            <button type="submit">Save & Run Silent Agent</button>
          </form>
          <script>
            document.getElementById('setupForm').onsubmit = async (e) => {
              e.preventDefault();
              const payload = {
                backendUrl: document.getElementById('backendUrl').value,
                agentToken: document.getElementById('agentToken').value,
                selectedPrinter: document.getElementById('selectedPrinter').value,
              };
              const res = await fetch('/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
              });
              if (res.ok) {
                document.body.innerHTML = '<div class="card" style="text-align:center"><h2 style="color:#4ade80">Connected Successfully!</h2><p>PrintAgent is now running silently in your Windows System Tray.</p></div>';
                setTimeout(() => window.close(), 3000);
              } else {
                alert('Save failed');
              }
            };
          </script>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  });

  app.post('/save', (req, res) => {
    try {
      const updatedConfig = saveConfig(req.body);
      res.json({ success: true });
      if (onSaveCallback) onSaveCallback(updatedConfig);
      if (guiServer) {
        setTimeout(() => guiServer.close(), 2000);
      }
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  guiServer = app.listen(49152, () => {
    console.log('[GUI] Setup screen running on http://localhost:49152');
    open('http://localhost:49152').catch(() => {});
  });
}

module.exports = {
  startConfigGui,
};
