const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const debug = require('./debug');

const log = debug.createLogger('stt');

// Persistent whisper service process (model loaded once, reused across transcriptions)
let whisperService = null;

/**
 * Get or start the persistent whisper service process.
 */
function getWhisperService() {
  if (whisperService && !whisperService.killed) {
    return whisperService;
  }

  const script = path.join(__dirname, 'whisper-stt.py');
  const proc = spawn('python3', [script, '--service'], {
    stdio: ['pipe', 'pipe', 'pipe'],
    shell: false,
  });

  proc.on('error', (err) => {
    log.error('Whisper service error: %s', err.message);
  });

  proc.on('close', (code) => {
    log('Whisper service exited (code: %d)', code);
    if (whisperService === proc) whisperService = null;
  });

  log('Started whisper service (pid: %d)', proc.pid);
  whisperService = proc;
  return proc;
}

/**
 * Transcribe audio file using the persistent whisper service.
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

  const model = config.stt.model;
  const language = config.stt.language;
  const command = `transcribe "${audioPath}" ${model} ${language}`;

  log('Service command: %s', command);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = getWhisperService();
    const timeout = setTimeout(() => {
      reject(new Error('whisper transcription timed out (120s)'));
    }, 120000);

    const onData = (data) => {
      const text = data.toString('utf-8').trim();
      log('Whisper service response: %s', text.slice(0, 200));
      clearTimeout(timeout);
      proc.stdout.removeListener('data', onData);

      if (text.startsWith('OK: ')) {
        const result = text.slice(4);
        const elapsed = Date.now() - startTime;
        log('Transcription done in %dms', elapsed);
        resolve(result);
      } else if (text.startsWith('ERR: ')) {
        const errMsg = text.slice(5);
        if (errMsg.includes('ModuleNotFoundError') || errMsg.includes('No module')) {
          reject(new Error('openai-whisper not installed. Run: pip3 install openai-whisper'));
        } else {
          reject(new Error(`whisper error: ${errMsg}`));
        }
      } else {
        reject(new Error(`Unexpected whisper service response: ${text}`));
      }
    };

    proc.stdout.on('data', onData);
    proc.stdin.write(command + '\n');
  });
}

/**
 * Stop the persistent whisper service.
 */
function stopWhisperService() {
  if (whisperService && !whisperService.killed) {
    try { whisperService.stdin.write('exit\n'); } catch {}
    setTimeout(() => {
      if (!whisperService.killed) {
        try { whisperService.kill('SIGKILL'); } catch {}
      }
      whisperService = null;
    }, 2000);
  }
  whisperService = null;
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
    throw new Error('openai-whisper not found. Install with: pip3 install openai-whisper');
  }
}

module.exports = {
  transcribe,
  ensureModelDownloaded,
  stopWhisperService,
};
