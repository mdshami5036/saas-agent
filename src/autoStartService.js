const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

function enableAutoStart() {
  if (process.platform !== 'win32') return;

  try {
    const configDir = path.join(os.homedir(), 'AppData', 'Roaming', 'AutoPrintAgent');

    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }

    const vbsPath = path.join(configDir, 'launch_background.vbs');

    // Check whether running from Node.js or packaged PrintAgent.exe
    let runCommand = '';
    if (process.execPath.toLowerCase().endsWith('node.exe')) {
      const agentJsPath = path.join(__dirname, 'agent.js');
      runCommand = `node.exe ""${agentJsPath}"" --background`;
    } else {
      runCommand = `""${process.execPath}"" --background`;
    }

    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")\nWshShell.Run "${runCommand}", 0, False\n`;
    fs.writeFileSync(vbsPath, vbsContent, 'utf-8');

    // 100% Fail-Proof: Also copy directly to Windows User Startup Folder
    try {
      const startupFolder = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
      if (fs.existsSync(startupFolder)) {
        fs.writeFileSync(path.join(startupFolder, 'AutoPrint_Boot.vbs'), vbsContent, 'utf-8');
      }
    } catch (e) {
      // silent
    }

    // Register in HKCU Startup Registry Key
    const keyName = 'AutoPrintAgent';
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

  try {
    const startupFolder = path.join(os.homedir(), 'AppData', 'Roaming', 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup');
    const bootFile = path.join(startupFolder, 'AutoPrint_Boot.vbs');
    if (fs.existsSync(bootFile)) fs.unlinkSync(bootFile);
  } catch (e) {
    // silent
  }
}

module.exports = {
  enableAutoStart,
  disableAutoStart,
};
