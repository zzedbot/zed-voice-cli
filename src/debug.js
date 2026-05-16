const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

/**
 * Simple debug logger that can be enabled/disabled per module.
 * 
 * Usage:
 *   const debug = require('./debug')('gateway');
 *   debug('Request sent to %s', url);
 *   debug.raw('Raw data:', data);
 */
let debugEnabled = false;

/**
 * Enable or disable debug logging globally.
 * @param {boolean} enabled
 */
function enable(enabled) {
  debugEnabled = enabled;
}

function isEnabled() {
  return debugEnabled;
}

/**
 * Create a debug logger for a specific module.
 * @param {string} module - Module name
 * @returns {Function} Debug function
 */
function createLogger(module) {
  const prefix = `  [${module}]`;
  
  const log = (msg, ...args) => {
    if (!debugEnabled) return;
    const timestamp = new Date().toISOString().slice(11, 23);
    console.log(`${prefix} ${timestamp} ${msg}`, ...args);
  };

  // Always log errors
  log.error = (msg, ...args) => {
    console.error(`❌ ${prefix} ${msg}`, ...args);
  };

  log.warn = (msg, ...args) => {
    console.warn(`⚠️  ${prefix} ${msg}`, ...args);
  };

  // Raw output (e.g., for dumping JSON or binary info)
  log.raw = (...args) => {
    if (!debugEnabled) return;
    console.log(prefix, ...args);
  };

  return log;
}

module.exports = {
  enable,
  isEnabled,
  createLogger,
};
