const os = require('os');

module.exports = {
  isWindows: os.platform() === 'win32',
};
