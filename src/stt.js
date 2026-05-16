const { execSync } = require('child_process');
const fs = require('fs');
const debug = require('./debug');

const log = debug.createLogger('stt');

/**
 * Transcribe audio file using openai-whisper Python API.
 * Calls whisper-stt.py wrapper to bypass broken CLI issues.
 */
async function transcribe(config, audioPath) {
  if (!fs.existsSync(audioPath)) {
    throw new Error(`Audio file not found: ${audioPath}`);
  }

  const stats = fs.statSync(audioPath);
  log('Transcribing: %s (%d bytes)', audioPath, stats.size);

  if (stats.size < 1000) {
    log('File too small, skipping transcription');
    return '';
  }

  const cmd = config.stt.command;
  const script = config.stt.script;
  const model = config.stt.model;
  const language = config.stt.language;

  const fullCmd = `${cmd} "${script}" "${audioPath}" --model ${model} --language ${language}`;
  log('Running: %s', fullCmd);

  const startTime = Date.now();

  try {
    const output = execSync(fullCmd, {
      encoding: 'utf-8',
      timeout: 120000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const elapsed = Date.now() - startTime;
    log('Transcription done in %dms', elapsed);
    const text = output.trim();
    log('Result: %s', text.slice(0, 200));
    return text;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const stderr = err.stderr || '';

    if (err.signal === 'SIGTERM' || err.signal === 'SIGKILL') {
      throw new Error('whisper transcription timed out');
    }
    if (stderr.includes('ModuleNotFoundError') && stderr.includes('whisper')) {
      throw new Error(`openai-whisper not installed. Run: pip3 install openai-whisper`);
    }
    if (stderr.includes('file') && stderr.includes('not found')) {
      throw new Error(`Model "${model}" not found. It will be auto-downloaded on first use.`);
    }
    log.error('Transcription failed in %dms: %s', elapsed, err.message);
    throw new Error(`whisper transcription failed: ${stderr.slice(0, 500) || err.message}`);
  }
}

/**
 * Ensure whisper Python module is available.
 */
async function ensureModelDownloaded(config) {
  const cmd = config.stt.command;

  try {
    execSync(`${cmd} -c "import whisper; print('whisper version:', whisper.__version__)"`, {
      stdio: ['pipe', 'pipe', 'ignore'],
      timeout: 5000,
    });
  } catch {
    throw new Error(`openai-whisper not found. Install with: pip3 install openai-whisper`);
  }
}

module.exports = {
  transcribe,
  ensureModelDownloaded,
};
