const fs = require('fs');
const os = require('os');
const path = require('path');

const log = (msg) => {
  fs.appendFileSync('/tmp/zed-debug-node.log', msg + '\n');
};

log('=== Starting ===');

const { Command } = require('commander');
const { loadConfig, ensureTmpDir } = require('./src/config');
const { isSetupDone, isGatewayMissing } = require('./src/setup');

log(`isSetupDone=${isSetupDone()}, isGatewayMissing=${isGatewayMissing()}`);

const config = loadConfig({
  mode: 'ptt',
  tui: true,
  recordDevice: 'hw:1',
  gateway: 'http://192.168.1.9:18789',
  token: 'a692ec37ab3dafe1f6e9c455d03c7ed6fedbd9a9d383803a',
  language: 'zh',
});
ensureTmpDir(config);

log('Config loaded, mode=' + config.mode);

const TUI = require('./src/tui');
const tui = new TUI(config);
tui.setMode(config.mode);
tui.render();

log('TUI rendered, starting PTT mode');

// Now try to start PTT mode (this is what index.js does)
const { startPtt } = require('./src/modes/ptt');

startPtt(config, tui).catch((err) => {
  log('PTT error: ' + err.message);
  tui.setError(err.message);
});

log('startPtt called');
