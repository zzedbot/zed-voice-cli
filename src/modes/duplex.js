const path = require('path');
const fs = require('fs');
const { transcribe } = require('../stt');
const { sendMessage } = require('../gateway');
const { synthesize } = require('../tts');
const { playAudio, playAudioWithControl } = require('../player');
const { recordUntilStopped, recordWithSilenceDetection } = require('../recorder');
const { processTurn, cleanupFile } = require('../conversation');
const debug = require('../debug');
const { stopWhisperService } = require('../stt');

const log = debug.createLogger('duplex');

/**
 * Start Full Duplex mode.
 * @param {Object} config
 * @param {import('../tui')} [tui] - Optional TUI instance
 * @param {AbortSignal} [abortSignal] - Signal to abort the mode (TUI mode switch)
 * @returns {{ ws: Object }} WebSocket connection for cleanup on mode switch
 */
async function startDuplex(config, tui = null, abortSignal = null) {
  if (tui) {
    tui.setStatus('IDLE');
    tui.setCurrentAction('请说话，可随时打断 AI 回复');
    tui.render();
  } else {
    console.log('🎙️  全双工模式（类似打电话）');
    console.log('可以随时打断 AI 回复');
    console.log('按 Ctrl+C 退出');
    console.log('');
  }

  let currentPlayback = null;
  let activeRecorder = null;
  let interruptRecorder = null;

  // Create WebSocket connection
  const ws = require('../gateway').createWsConnection(config);
  config._gwConn = ws;

  // Abort handler: stop any active recording on mode switch
  if (abortSignal) {
    abortSignal.addEventListener('abort', () => {
      if (activeRecorder) {
        if (activeRecorder.stop) try { activeRecorder.stop(); } catch {}
        if (activeRecorder.process && !activeRecorder.process.killed) try { activeRecorder.process.kill('SIGKILL'); } catch {}
      }
      if (interruptRecorder) {
        if (interruptRecorder.stop) try { interruptRecorder.stop(); } catch {}
        if (interruptRecorder.process && !interruptRecorder.process.killed) try { interruptRecorder.process.kill('SIGKILL'); } catch {}
      }
      if (currentPlayback) currentPlayback.stop();
      ws.close();
      delete config._gwConn;
      stopWhisperService();
    });
  }
  process.on('SIGINT', () => {
    if (tui) tui.destroy();
    console.log('\n👋 再见');
    if (currentPlayback) currentPlayback.stop();
    ws.close();
    delete config._gwConn;
    process.exit(0);
  });

  /**
   * Listen for user speech while AI is playing back.
   */
  async function listenForInterruption() {
    const audioPath = path.join(config.tmpDir, `duplex-interrupt-${Date.now()}.wav`);

    try {
      const recorder = recordUntilStopped(config, audioPath);
      interruptRecorder = recorder;

      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('timeout')), 2000);
      });

      await Promise.race([recorder.promise, timeout]);
      recorder.stop();
      interruptRecorder = null;

      if (fs.existsSync(audioPath)) {
        const stats = fs.statSync(audioPath);
        if (stats.size > 2000) {
          const text = await transcribe(config, audioPath);
          if (text && text.trim().length > 0) {
            cleanupFile(audioPath);
            return text;
          }
        }
        cleanupFile(audioPath);
      }
    } catch {
      try { fs.unlinkSync(audioPath); } catch {}
    }
    return null;
  }

  /**
   * Main duplex conversation loop
   */
  while (true) {
    if (abortSignal && abortSignal.aborted) {
      ws.close();
      delete config._gwConn;
      throw new DOMException('Mode switched', 'AbortError');
    }
    try {
      if (!tui) console.log('🎙️  请说话...');
      if (tui) {
        tui.setStatus('IDLE');
        tui.setCurrentAction('🎙️  请说话...');
      }

      const audioPath = path.join(config.tmpDir, `duplex-${Date.now()}.wav`);
      if (tui) tui.setStatus('RECORDING');
      const rec = recordWithSilenceDetection(config, audioPath);
      activeRecorder = rec;
      const recordedPath = await rec.promise;
      activeRecorder = null;

      if (abortSignal && abortSignal.aborted) {
        ws.close();
        throw new DOMException('Mode switched', 'AbortError');
      }

      const result = await processTurn(config, recordedPath, tui);
      if (!result) continue;

      if (abortSignal && abortSignal.aborted) {
        ws.close();
        throw new DOMException('Mode switched', 'AbortError');
      }

      // Play with interruption support
      if (tui) {
        tui.setCurrentAction('🔊 播放中... (可随时打断)');
      } else {
        console.log('🔊 播放中... (可随时打断)');
      }

      const ttsPath = path.join(config.tmpDir, `tts-${Date.now()}.wav`);
      await synthesize(config, result.reply, ttsPath);

      const playback = playAudioWithControl(ttsPath, { sampleRate: config.tts.sampleRate });
      currentPlayback = playback;

      // Simulate playback progress for TUI
      let progressInterval = null;
      if (tui) {
        let pct = 0;
        progressInterval = setInterval(() => {
          pct = Math.min(100, pct + 5);
          tui.setPlaybackProgress(pct);
        }, 500);
      }

      const interruptionPromise = listenForInterruption();

      const [playbackDone, interruption] = await Promise.allSettled([
        playback.promise,
        interruptionPromise,
      ]);

      if (progressInterval) clearInterval(progressInterval);
      currentPlayback = null;

      if (interruption.value) {
        if (tui) {
          tui.setCurrentAction('⚡ 检测到打断');
          tui.addUserMessage(interruption.value);
        } else {
          console.log('\n⚡ 检测到打断');
          console.log(`📝 打断内容: ${interruption.value}`);
        }
        playback.stop();

        const reply2 = await sendMessage(config, interruption.value);
        if (tui) {
          tui.addAiMessage(reply2);
          tui.setCurrentAction('🔊 播放中...');
        } else {
          console.log(`🤖 Zed: ${reply2}`);
        }

        const ttsPath2 = path.join(config.tmpDir, `tts-${Date.now()}.wav`);
        await synthesize(config, reply2, ttsPath2);
        await playAudio(ttsPath2, { sampleRate: config.tts.sampleRate });
        cleanupFile(ttsPath2);
      } else if (playbackDone.status === 'rejected') {
        log.error('Playback failed: %s', playbackDone.reason.message);
      }

      if (tui) {
        tui.setCurrentAction('✅ 播放完成');
      } else {
        console.log('✅ 播放完成');
        console.log('');
      }
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      if (abortSignal && abortSignal.aborted) {
        throw new DOMException('Mode switched', 'AbortError');
      }
      if (currentPlayback) {
        currentPlayback.stop();
        currentPlayback = null;
      }
      const msg = `错误: ${err.message}`;
      if (tui) {
        tui.setError(msg);
        tui.setCurrentAction('等待 2 秒后重试...');
      } else {
        console.error('❌ 错误:', err.message);
        log.error('Duplex loop error: %s', err.message);
        console.log('等待 2 秒后重试...');
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  return { ws };
}

module.exports = {
  startDuplex,
};
