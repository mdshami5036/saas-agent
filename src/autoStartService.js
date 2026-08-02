const { exec } = require('child_process');
const path = require('path');

function enableAutoStart() {
  if (process.platform !== 'win32') return;

  const exePath = process.execPath; // Absolute path to PrintAgent.exe
  const keyName = 'AutoPrintAgent';
  
  // Windows reg command to set startup registry key
  const command = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "${keyName}" /t REG_SZ /d "\\"${exePath}\\" --silent" /f`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.warn('[AutoStart] Failed to set Windows startup registry key:', error.message);
    } else {
      console.log('[AutoStart] Successfully registered Windows boot auto-start key');
    }
  });
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
