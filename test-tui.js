const fs = require('fs');
const path = require('path');
const os = require('os');

const log = (msg) => {
  fs.appendFileSync('/tmp/zed-debug-node.log', msg + '\n');
};

log('Step 1: require index');

try {
  const { Command } = require('commander');
  log('Step 2: commander loaded');

  const { loadConfig, ensureTmpDir } = require('./src/config');
  log('Step 3: config loaded');

  const { isSetupDone, isGatewayMissing } = require('./src/setup');
  log(`Step 4: isSetupDone=${isSetupDone()}, isGatewayMissing=${isGatewayMissing()}`);

  const config = loadConfig({
    mode: 'ptt',
    tui: true,
    recordDevice: 'hw:1',
    gateway: 'http://192.168.1.9:18789',
    token: 'a692ec37ab3dafe1f6e9c455d03c7ed6fedbd9a9d383803a',
    language: 'zh',
  });
  log('Step 5: config loaded');
  log(JSON.stringify(config, null, 2));

  const TUI = require('./src/tui');
  log('Step 6: TUI module loaded');

  const tui = new TUI(config);
  log('Step 7: TUI instance created');

  tui.setMode('ptt');
  tui.render();
  tui.setStatus('IDLE');
  log('Step 8: TUI rendered');

  setTimeout(() => {
    log('Step 9: timeout - TUI still alive');
    tui.destroy();
    process.exit(0);
  }, 10000);

} catch (err) {
  log('ERROR: ' + err.message);
  log(err.stack);
  process.exit(1);
}
