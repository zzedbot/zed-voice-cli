const path = require('path');
const fs = require('fs');
const { transcribe } = require('./stt');
const { sendMessage } = require('./gateway');
const { synthesize } = require('./tts');
const { playAudio } = require('./player');
const { EXIT_COMMANDS } = require('./constants');
const debug = require('./debug');

const log = debug.createLogger('conversation');

/**
 * Process a complete conversation turn: STT → Gateway → TTS → Play.
 *
 * @param {Object} config
 * @param {string} audioPath - Path to the recorded audio file
 * @param {Object} [tui] - Optional TUI instance for terminal UI updates
 * @returns {{ text: string, reply: string }} or null if no speech detected
 */
async function processTurn(config, audioPath, tui = null) {
  // STT
  log('Transcribing: %s', audioPath);
  tui?.setStatus('PROCESSING');
  tui?.setCurrentAction('🧠 识别中...');
  if (!tui) console.log('🧠 识别中...');
  const text = await transcribe(config, audioPath);

  if (!text || text.trim().length === 0) {
    tui?.setCurrentAction('⚠️  未检测到语音内容');
    if (!tui) console.log('⚠️  未检测到语音内容');
    return null;
  }
  tui?.addUserMessage(text);
  if (!tui) console.log(`📝 你说: ${text}`);

  // Check for exit commands
  if (EXIT_COMMANDS.some(cmd => text.toLowerCase().includes(cmd))) {
    tui?.setCurrentAction('👋 再见');
    if (!tui) console.log('👋 再见');
    process.exit(0);
  }

  // Gateway
  tui?.setStatus('THINKING');
  tui?.setCurrentAction('💭 思考中...');
  if (!tui) console.log('💭 思考中...');
  const reply = await sendMessage(config, text);
  tui?.addAiMessage(reply);
  if (!tui) console.log(`🤖 Zed: ${reply}`);

  // TTS
  tui?.setCurrentAction('🔊 生成语音...');
  if (!tui) console.log('🔊 生成语音...');
  const ttsPath = path.join(config.tmpDir, `tts-${Date.now()}.wav`);
  await synthesize(config, reply, ttsPath);

  // Play (handled by caller in duplex mode)
  if (!tui) {
    console.log('🔊 播放中...');
    await playAudio(ttsPath, { sampleRate: config.tts.sampleRate });
    console.log('✅ 播放完成');
    console.log('');
  }

  // Cleanup temp files
  cleanupFile(audioPath);
  cleanupFile(ttsPath);

  return { text, reply };
}

/**
 * Safely delete a temp file if it exists.
 */
function cleanupFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      log('Cleaned up: %s', filePath);
    }
  } catch (err) {
    log.warn('Failed to cleanup %s: %s', filePath, err.message);
  }
}

module.exports = {
  processTurn,
  cleanupFile,
};
