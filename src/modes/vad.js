const path = require('path');
const { recordWithSilenceDetection } = require('../recorder');
const { processTurn } = require('../conversation');
const { createConnection } = require('../gateway');
const { stopWhisperService } = require('../stt');

/**
 * Start VAD (Voice Activity Detection) mode.
 * @param {Object} config
 * @param {import('../tui')} [tui] - Optional TUI instance
 * @param {AbortSignal} [abortSignal] - Signal to abort the mode (TUI mode switch)
 */
async function startVad(config, tui = null, abortSignal = null) {
  // Create persistent gateway connection
  const gwConn = createConnection(config);
  config._gwConn = gwConn;

  // Handle connection failure
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
    tui.setCurrentAction('请说话，自动检测说话结束');
    tui.render();
  } else {
    console.log('🎙️  VAD 模式（自动语音检测）');
    console.log('直接说话，自动检测说话结束');
    console.log('按 Ctrl+C 退出');
    console.log('');
  }

  // Handle Ctrl+C
  process.on('SIGINT', () => {
    if (tui) tui.destroy();
    gwConn.close();
    delete config._gwConn;
    console.log('\n👋 再见');
    process.exit(0);
  });

  // Handle abort signal
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      gwConn.close();
      delete config._gwConn;
      stopWhisperService();
    });
  }

  // Main conversation loop
  while (true) {
    if (abortSignal && abortSignal.aborted) {
      gwConn.close();
      delete config._gwConn;
      throw new DOMException('Mode switched', 'AbortError');
    }
    try {
      await vadConversationLoop(config, tui, abortSignal);
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (abortSignal && abortSignal.aborted) {
        throw new DOMException('Mode switched', 'AbortError');
      }
      const msg = `错误: ${err.message}`;
      if (tui) {
        tui.setError(msg);
        tui.setStatus('IDLE');
        tui.setCurrentAction('等待 2 秒后重试...');
      } else {
        console.error('❌ 错误:', err.message);
        console.log('等待 2 秒后重试...');
      }
      await sleep(2000);
    }
  }
}

/**
 * Single conversation loop iteration for VAD mode.
 */
async function vadConversationLoop(config, tui = null, abortSignal = null) {
  if (abortSignal && abortSignal.aborted) {
    throw new DOMException('Mode switched', 'AbortError');
  }
  if (!tui) console.log('🎙️  请说话...');

  const audioPath = path.join(config.tmpDir, `vad-${Date.now()}.wav`);
  let recorder = null;

  try {
    // Record with silence detection
    if (tui) {
      tui.setStatus('RECORDING');
      tui.setCurrentAction('🎙️  请说话...');
    }

    // Abort handler: stop recording when mode is switched
    const onAbort = () => {
      if (recorder && recorder.process && !recorder.process.killed) {
        recorder.process.forceStop();
      }
    };
    if (abortSignal) abortSignal.addEventListener('abort', onAbort, { once: true });

    recorder = recordWithSilenceDetection(config, audioPath);
    const recordedPath = await recorder.promise;

    if (abortSignal) abortSignal.removeEventListener('abort', onAbort);
    if (abortSignal && abortSignal.aborted) {
      throw new DOMException('Mode switched', 'AbortError');
    }

    // Use shared conversation pipeline
    await processTurn(config, recordedPath, tui);

    if (tui) {
      tui.setStatus('IDLE');
      tui.setCurrentAction('请说话...');
    }
  } catch (err) {
    if (abortSignal && abortSignal.aborted) {
      throw new DOMException('Mode switched', 'AbortError');
    }
    if (err.message && err.message.includes('too small')) {
      if (!tui) console.log('⚠️  录音太短，继续监听...');
    } else {
      throw err;
    }
  } finally {
    if (abortSignal) {
      // Listener already set to { once: true }, safe to remove
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startVad,
};
