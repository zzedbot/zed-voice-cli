const path = require('path');
const { processTurn } = require('../conversation');
const { recordUntilStopped } = require('../recorder');
const { createConnection } = require('../gateway');
const debug = require('../debug');

const log = debug.createLogger('ptt');

/**
 * Start Push-to-Talk mode.
 * @param {Object} config
 * @param {import('../tui')} [tui] - Optional TUI instance
 * @param {AbortSignal} [abortSignal] - Signal to abort the mode (TUI mode switch)
 */
async function startPtt(config, tui = null, abortSignal = null) {
  // Create persistent gateway connection
  const gwConn = createConnection(config);
  config._gwConn = gwConn;

  try {
    await Promise.race([
      gwConn.connectPromise,
      new Promise((_, rej) => setTimeout(() => rej(new Error('Gateway 连接超时')), 20000)),
    ]);
  } catch (err) {
    const msg = `Gateway 连接失败: ${err.message}`;
    if (tui) tui.setError(msg);
    else console.error('❌', msg);
    gwConn.close();
    delete config._gwConn;
    throw new Error(msg);
  }

  if (tui) {
    tui.setStatus('IDLE');
    tui.setCurrentAction('按 Enter 开始录音，再按 Enter 结束');
    tui.render();

    // TUI already handles Enter key
    tui.onEnter = async () => {
      await handlePttAction(config, tui);
    };

    // Handle abort signal for mode switching
    if (abortSignal) {
      abortSignal.addEventListener('abort', () => {
        // Stop any active recording
        if (tui._pttState && tui._pttState.recorder) {
          try { tui._pttState.recorder.stop(); } catch {}
          try { if (!tui._pttState.recorder.process.killed) tui._pttState.recorder.process.kill('SIGKILL'); } catch {}
        }
        gwConn.close();
        delete config._gwConn;
        tui._pttState = null;
        tui.onEnter = null;
      });
    }

    // PTT is event-driven, wait for abort
    if (abortSignal) {
      return new Promise((resolve, reject) => {
        abortSignal.addEventListener('abort', () => {
          gwConn.close();
          delete config._gwConn;
          tui._pttState = null;
          tui.onEnter = null;
          reject(new DOMException('Mode switched', 'AbortError'));
        });
      });
    }
    // Without abort signal, just return (keep running via events)
    return;
  }

  // Console mode (original behavior)
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  console.log('🎙️  Push-to-Talk 模式');
  console.log('按 Enter 开始录音，再按 Enter 结束');
  console.log('按 Ctrl+C 退出');
  console.log('');

  process.stdin.setRawMode(true);
  process.stdin.resume();

  let recording = false;
  let recorder = null;
  let processing = false;

  process.stdin.on('data', async (data) => {
    if (data.toString() === '\r' || data.toString() === '\n') {
      if (processing) {
        log('Ignoring Enter while processing');
        return;
      }

      if (!recording) {
        recording = true;
        const audioPath = path.join(config.tmpDir, `ptt-${Date.now()}.wav`);
        console.log('\n🔴 录音中... (按 Enter 结束)');
        log('Recording started, file: %s', audioPath);

        try {
          recorder = recordUntilStopped(config, audioPath);
        } catch (err) {
          console.error('❌ 录音失败:', err.message);
          recording = false;
          recorder = null;
        }
      } else {
        recording = false;
        processing = true;
        console.log('⏹️  录音结束，处理中...');
        log('Recording stopped');

        if (recorder) {
          recorder.stop();
          try {
            const audioPath = await recorder.promise;
            log('Recording file: %s', audioPath);
            await processTurn(config, audioPath);
          } catch (err) {
            console.error('❌ 处理失败:', err.message);
            log.error('Processing error: %s', err.message);
          }
          recorder = null;
        }

        processing = false;
        console.log('');
        console.log('按 Enter 开始下一次对话');
      }
    }
  });

  process.on('SIGINT', () => {
    gwConn.close();
    delete config._gwConn;
    console.log('\n👋 再见');
    if (recorder) recorder.stop();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    rl.close();
    process.exit(0);
  });
}

/**
 * Handle PTT Enter key press in TUI mode.
 */
async function handlePttAction(config, tui) {
  if (!tui._pttState) {
    tui._pttState = { recording: false, recorder: null, processing: false };
  }
  const state = tui._pttState;

  if (state.processing) {
    log('Ignoring Enter while processing');
    return;
  }

  if (!state.recording) {
    state.recording = true;
    const audioPath = path.join(config.tmpDir, `ptt-${Date.now()}.wav`);
    tui.setStatus('RECORDING');
    tui.setCurrentAction('🔴 录音中...');
    log('Recording started, file: %s', audioPath);
    state.audioPath = audioPath;

    try {
      state.recorder = recordUntilStopped(config, audioPath);
    } catch (err) {
      tui.setError(`录音失败: ${err.message}`);
      state.recording = false;
      state.recorder = null;
    }
  } else {
    state.recording = false;
    state.processing = true;
    tui.setStatus('PROCESSING');
    tui.setCurrentAction('⏹️  录音结束，处理中...');
    log('Recording stopped');

    if (state.recorder) {
      state.recorder.stop();
      try {
        const audioPath = await state.recorder.promise;
        log('Recording file: %s', audioPath);
        await processTurn(config, audioPath, tui);
      } catch (err) {
        tui.setError(`处理失败: ${err.message}`);
        log.error('Processing error: %s', err.message);
      }
      state.recorder = null;
    }

    state.processing = false;
    tui.setStatus('IDLE');
    tui.setCurrentAction('按 Enter 开始下一次对话');
  }
}

module.exports = {
  startPtt,
};
