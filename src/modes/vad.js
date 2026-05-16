const path = require('path');
const { recordWithSilenceDetection } = require('../recorder');
const { processTurn } = require('../conversation');
const { createConnection } = require('../gateway');

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
      // AbortController.abort() will cause the next await to throw AbortError
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

  try {
    // Record with silence detection
    if (tui) {
      tui.setStatus('RECORDING');
      tui.setCurrentAction('🎙️  请说话...');
    }
    const recordedPath = await recordWithSilenceDetection(config, audioPath);

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
    if (err.message.includes('too small')) {
      if (!tui) console.log('⚠️  录音太短，继续监听...');
    } else {
      throw err;
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = {
  startVad,
};
