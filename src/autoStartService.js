const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function enableAutoStart() {
  if (process.platform !== 'win32') return;

  try {
    const exePath = process.execPath; // Absolute path to PrintAgent.exe
    const configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'AutoPrintAgent');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    // Create a VBS script that launches PrintAgent.exe completely hidden (style 0 = no console window)
    const vbsPath = path.join(configDir, 'launch_background.vbs');
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run """${exePath}"" --background", 0, False\n`;

    fs.writeFileSync(vbsPath, vbsContent, 'utf-8');

    const keyName = 'AutoPrintAgent';
    // Register VBS script in Windows Startup registry key
    const command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /t REG_SZ /d "wscript.exe \\"${vbsPath}\\"" /f`;

    exec(command, (error) => {
      if (error) {
        console.warn('[AutoStart] Registry set warning:', error.message);
      } else {
        console.log('[AutoStart] Successfully registered Windows hidden boot auto-start service');
      }
    });
  } catch (err) {
    console.error('[AutoStart] Error setting up silent startup service:', err.message);
  }
}

function disableAutoStart() {
  if (process.platform !== 'win32') return;

  const keyName = 'AutoPrintAgent';
  const command = `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /f`;

  exec(command, (error) => {
    if (!error) console.log('[AutoStart] Removed Windows startup registry key');
  });
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
};
