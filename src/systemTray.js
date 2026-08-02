const notifier = require('node-notifier');
const path = require('path');

function showDesktopNotification(title, message) {
  notifier.notify({
    title: title || 'AutoPrint Agent',
    message: message || 'Print job received',
    sound: true,
    wait: false,
  });
}

module.exports = {
  showDesktopNotification,
};
