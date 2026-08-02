const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_DIR = path.join(os.homedir(), 'AppData', 'Roaming', 'AutoPrintAgent');
const CONFIG_PATH = path.join(CONFIG_DIR, 'config.json');

const DEFAULT_CLOUD_BACKEND = 'https://saas-backend-production-5c3e.up.railway.app';

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

function loadConfig() {
  try {
    ensureConfigDir();
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8');
      const parsed = JSON.parse(data);
      // Auto-upgrade old localhost or old backend URLs
      if (
        !parsed.backendUrl ||
        parsed.backendUrl.includes('localhost') ||
        parsed.backendUrl.includes('saas-nine-ochre.vercel.app') ||
        parsed.backendUrl.includes('saas-production-531c.up.railway.app')
      ) {
        parsed.backendUrl = DEFAULT_CLOUD_BACKEND;
      }
      return parsed;
    }
  } catch (err) {
    console.warn('[Config] Warning loading config file:', err.message);
  }
  return {
    backendUrl: DEFAULT_CLOUD_BACKEND,
    agentToken: '',
    selectedPrinter: '',
    isConfigured: false,
    autoStart: true,
    minimizeToTray: true,
  };
}

function saveConfig(config) {
  try {
    ensureConfigDir();
    const updated = {
      ...loadConfig(),
      ...config,
      isConfigured: true,
      updatedAt: new Date().toISOString(),
    };
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  } catch (err) {
    console.error('[Config] Failed to save config file:', err.message);
    throw err;
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  CONFIG_PATH,
  DEFAULT_CLOUD_BACKEND,
};
