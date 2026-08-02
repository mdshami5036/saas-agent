const os = require('os');
const crypto = require('crypto');

function getHardwareFingerprint() {
  const hostname = os.hostname();
  const cpus = os.cpus().map((c) => c.model).join('|');
  const networkInterfaces = os.networkInterfaces();
  
  let macAddresses = [];
  for (const name of Object.keys(networkInterfaces)) {
    for (const net of networkInterfaces[name]) {
      if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
        macAddresses.push(net.mac);
      }
    }
  }
  
  macAddresses.sort();
  const rawFingerprint = `${hostname}#${cpus}#${macAddresses.join(',')}`;
  
  const hash = crypto.createHash('sha256').update(rawFingerprint).digest('hex');
  
  return {
    deviceId: `win_${hash.substring(0, 16)}`,
    hardwareHash: hash,
    hostname,
    platform: os.platform(),
    arch: os.arch(),
  };
}

module.exports = {
  getHardwareFingerprint,
};
