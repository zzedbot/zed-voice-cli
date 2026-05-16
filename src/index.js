#!/usr/bin/env node

const { Command } = require('commander');
const readline = require('readline');
const { loadConfig, ensureTmpDir } = require('./config');
const { listAudioDevices, selectAudioDevice, getFfmpegDeviceName } = require('./audio-devices');
const { isWindows } = require('./platform');
const debug = require('./debug');
const { isSetupDone, isGatewayMissing, runSetup } = require('./setup');
const pkg = require('../package.json');

const program = new Command();

program
  .name('zed-voice')
  .description('Voice interaction CLI for OpenClaw')
  .version(pkg.version)
  .option('-m, --mode <mode>', 'interaction mode: ptt, vad, duplex', 'vad')
  .option('-g, --gateway <url>', 'OpenClaw Gateway HTTP URL')
  .option('--gateway-ws <url>', 'OpenClaw Gateway WebSocket URL')
  .option('-t, --token <token>', 'Gateway auth token')
  .option('--stt-model <model>', 'whisper model name', 'small')
  .option('--language <lang>', 'STT language code', 'zh')
  .option('--record-device <dev>', 'Audio record device name (skip auto-detection)')
  .option('--list-devices', 'List available audio devices and exit')
  .option('--tts-api-key <key>', 'DashScope TTS API key')
  .option('--tts-model <model>', 'DashScope TTS model', 'sambert-zhichu-v1')
  .option('-d, --debug', 'Enable verbose debug logging')
  .option('--setup', 'Run the first-time setup wizard')
  .option('--tui', 'Enable terminal UI mode (blessed)')
  .action(async (opts) => {
    // If --setup flag, just run setup and exit
    if (opts.setup) {
      await runSetup();
      process.exit(0);
    }

    const config = loadConfig(opts);
    ensureTmpDir(config);

    // First-run setup check, or gateway not yet configured
    const needsSetup = !isSetupDone() || isGatewayMissing();
    if (needsSetup) {
      if (!isSetupDone()) {
        console.log('🔧 首次使用，运行安装向导...');
      } else {
        console.log('🔧 检测到未配置 Gateway Token，运行设置向导...');
      }
      console.log('');
      await runSetup({ gatewayOnly: isSetupDone() && isGatewayMissing() });
      // Reload config after setup (paths may have changed)
      Object.assign(config, loadConfig(opts));
      return;
    }

    // Enable debug logging
    debug.enable(config.debug);
    const log = debug.createLogger('main');

    if (config.debug) {
      log('Debug mode enabled');
      log('Config: %O', config);
    }

    // If just listing devices, do that and exit
    if (opts.listDevices) {
      console.log('🎤 Available audio input devices:\n');
      const devices = listAudioDevices();
      if (devices.length === 0) {
        console.log('  No devices found.');
      } else {
        devices.forEach((d, i) => {
          console.log(`  ${i + 1}. ${d}`);
        });
      }
      process.exit(0);
    }

    // Auto-detect microphone if not specified
    if (!opts.recordDevice && !process.env.ZED_VOICE_RECORD_DEVICE) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const devices = listAudioDevices();
      if (devices.length > 0) {
        const selected = await selectAudioDevice(devices, rl);
        if (selected) {
          config.audio.recordDevice = getFfmpegDeviceName(selected);
          console.log(`✅ Using: ${selected}`);
        }
      } else {
        console.log('⚠️  No microphones detected. Specify with --record-device');
        rl.close();
        process.exit(1);
      }
      rl.close();
    }

    // Validate dependencies
    await validateDependencies(config);

    // Start the voice session in TUI or console mode
    let currentMode = config.mode.toLowerCase();
    let abortController = null;
    let wsConnection = null;

    /**
     * Switch to a new mode in TUI.
     * Aborts the current mode loop and starts the new one.
     */
    async function switchMode(newMode, tuiInstance) {
      if (abortController) {
        abortController.abort();
        abortController = null;
      }
      if (wsConnection) {
        wsConnection.close();
        wsConnection = null;
      }
      if (config._gwConn) {
        config._gwConn.close();
        delete config._gwConn;
      }

      currentMode = newMode;
      tuiInstance.setMode(newMode);
      tuiInstance.setStatus('IDLE');
      tuiInstance.setCurrentAction(`已切换到 ${newMode.toUpperCase()} 模式`);

      // Small delay to let user see the switch
      await new Promise(r => setTimeout(r, 800));

      // Start the new mode with a fresh abort controller
      abortController = new AbortController();
      config.mode = newMode;
      tuiInstance.mode = newMode;

      try {
        if (newMode === 'ptt') {
          const { startPtt } = require('./modes/ptt');
          await startPtt(config, tuiInstance, abortController.signal);
        } else if (newMode === 'vad') {
          const { startVad } = require('./modes/vad');
          await startVad(config, tuiInstance, abortController.signal);
        } else if (newMode === 'duplex') {
          const { startDuplex } = require('./modes/duplex');
          const result = await startDuplex(config, tuiInstance, abortController.signal);
          if (result && result.ws) wsConnection = result.ws;
        }
      } catch (err) {
        if (err.name === 'AbortError') return; // Expected on mode switch
        tuiInstance.setError(`模式切换失败: ${err.message}`);
      }
    }

    // Initialize TUI if enabled
    let tui = null;
    if (config.tui) {
      const TUI = require('./tui');
      tui = new TUI(config);
      tui.setMode(currentMode);
      tui.render();
    } else {
      console.log(`\n🎙️  Zed Voice CLI v${pkg.version}`);
      console.log(`📡 Gateway: ${config.gateway.url}`);
      console.log(`🎤 Device: ${config.audio.recordDevice}`);
      console.log(`🧠 STT: whisper (${config.stt.model})`);
      console.log(`🔊 TTS: ${config.tts.engine || 'edge-tts'} (${config.tts.model})`);
      console.log(`🎯 Mode: ${currentMode}`);
      console.log(`🐛 Debug: ${config.debug ? 'ON' : 'OFF'}`);
      console.log('');
    }

    // Register mode switch callback on TUI
    if (tui) {
      tui.onModeSwitch = async (newMode) => switchMode(newMode, tui);
    }

    // Import and start the selected mode
    if (config.tui) {
      abortController = new AbortController();
      try {
        if (currentMode === 'ptt') {
          const { startPtt } = require('./modes/ptt');
          await startPtt(config, tui, abortController.signal);
        } else if (currentMode === 'vad') {
          const { startVad } = require('./modes/vad');
          await startVad(config, tui, abortController.signal);
        } else if (currentMode === 'duplex') {
          const { startDuplex } = require('./modes/duplex');
          const result = await startDuplex(config, tui, abortController.signal);
          if (result && result.ws) wsConnection = result.ws;
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        throw err;
      }
    } else {
      // Console mode (original)
      if (currentMode === 'ptt') {
        const { startPtt } = require('./modes/ptt');
        await startPtt(config);
      } else if (currentMode === 'vad') {
        const { startVad } = require('./modes/vad');
        await startVad(config);
      } else if (currentMode === 'duplex') {
        const { startDuplex } = require('./modes/duplex');
        await startDuplex(config);
      } else {
        console.error(`❌ Unknown mode: ${currentMode}. Use ptt, vad, or duplex.`);
        process.exit(1);
      }
    }
  });

async function validateDependencies(config) {
  const { execSync } = require('child_process');
  const log = debug.createLogger('deps');
  const deps = [
    { name: 'ffmpeg', install: 'Run: zed-voice --setup' },
    { name: 'ffplay', install: 'Included with ffmpeg' },
    { name: 'python', install: 'Run: zed-voice --setup' },
  ];

  for (const dep of deps) {
    try {
      const cmd = isWindows ? `where ${dep.name}` : `which ${dep.name}`;
      const result = execSync(cmd, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      log('Found %s at: %s', dep.name, result.trim());
    } catch (err) {
      console.error(`❌ Missing dependency: ${dep.name}`);
      console.error(`   Install with: ${dep.install}`);
      console.error(`   Or run the setup wizard: zed-voice --setup`);
      process.exit(1);
    }
  }

  // Also check whisper Python module
  try {
    const python = isWindows ? 'python' : 'python3';
    execSync(`${python} -c "import whisper"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    log('Python whisper module found');
  } catch {
    console.error('❌ Python openai-whisper module not installed');
    console.error('   Install with: zed-voice --setup');
    console.error('   Or manually: pip3 install openai-whisper');
    process.exit(1);
  }

  console.log('✅ All dependencies available');
}

program.parse();
