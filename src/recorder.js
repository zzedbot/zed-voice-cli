const { spawn, execSync } = require('child_process');
const fs = require('fs');
const debug = require('./debug');
const { isWindows } = require('./platform');

const log = debug.createLogger('recorder');

/**
 * Force kill a process tree by PID (cross-platform).
 * On Windows, first tries graceful termination (taskkill without /F),
 * then force-kills with /F if the process is still running after 2s.
 * On Linux, sends SIGINT then SIGKILL as fallback.
 */
function killProcess(pid) {
  if (isWindows) {
    // Try graceful termination first so ffmpeg can finalize the WAV file
    try {
      log('Terminating process tree for PID %d via taskkill (graceful)', pid);
      execSync(`taskkill /PID ${pid} /T 2>&1`, { encoding: 'utf-8' });
    } catch (err) {
      if (err.status === 128 || (err.stderr && err.stderr.includes('not found'))) {
        log('Process %d already exited', pid);
        return;
      }
      log.warn('Graceful taskkill failed, forcing kill for PID %d: %s', pid, err.message);
      try {
        execSync(`taskkill /PID ${pid} /F /T 2>&1`, { encoding: 'utf-8' });
      } catch {
        // Process already exited
      }
    }
  } else {
    try {
      process.kill(pid, 'SIGINT');
    } catch {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {
        // Process already exited
      }
    }
  }
}

/**
 * Get ffmpeg input arguments based on platform.
 */
function getFfmpegInputArgs(config) {
  if (isWindows) {
    return [
      '-f', 'dshow',
      '-rtbufsize', '100M',
      '-i', `audio=${config.audio.recordDevice || 'Microphone'}`,
    ];
  }
  return ['-f', 'alsa', '-i', config.audio.recordDevice || 'hw:0'];
}

/**
 * Start recording audio using ffmpeg (cross-platform).
 * @returns {{ stop: Function, process: import('child_process').ChildProcess, promise: Promise<string> }}
 */
function startRecording(config, outputPath) {
  const args = [
    '-y',
    ...getFfmpegInputArgs(config),
    '-ar', String(config.audio.sampleRate),
    '-ac', String(config.audio.channels),
    '-f', 'wav',
    outputPath,
  ];

  log('Starting recording to %s', outputPath);
  if (debug.isEnabled()) log('ffmpeg args: %O', args);

  const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  let stderrTail = '';
  let stopped = false;

  proc.stderr.on('data', (data) => {
    const text = data.toString();
    // Keep only the last 2KB to prevent unbounded growth
    stderrTail += text;
    if (stderrTail.length > 2048) {
      stderrTail = stderrTail.slice(-2048);
    }
    if (debug.isEnabled() && (text.includes('size=') || text.includes('time=') || text.includes('speed='))) {
      log('ffmpeg: %s', text.trim());
    }
  });

  proc.on('spawn', () => log('ffmpeg process spawned (pid: %d)', proc.pid));

  let resolvePromise, rejectPromise;
  const promise = new Promise((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  proc.on('close', (code) => {
    log('ffmpeg closed (code: %d, stopped: %s)', code, stopped);
    if (debug.isEnabled() && stderrTail.length > 0) {
      log('ffmpeg stderr (tail): %s', stderrTail.slice(-500));
    }
    // Small delay to let OS release file handle and flush pending writes
    setTimeout(() => {
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 100) {
          log('Recording saved: %s (%d bytes)', outputPath, stats.size);
          resolvePromise(outputPath);
        } else {
          log.warn('Recording file too small: %d bytes', stats.size);
          rejectPromise(new Error('Recording file too small'));
        }
      } else {
        rejectPromise(new Error(`ffmpeg exited with code ${code}`));
      }
    }, 200);
  });
  proc.on('error', (err) => {
    log.error('ffmpeg error: %s', err.message);
    rejectPromise(err);
  });

  return {
    stop: () => {
      if (stopped) return;
      stopped = true;
      log('Stopping recording (pid: %d)...', proc.pid);
      // Send 'q' to ffmpeg's stdin first - this triggers graceful shutdown
      // with proper WAV file finalization. Then close stdin.
      try { proc.stdin.write('q\n'); } catch {}
      try { proc.stdin.end(); } catch {}
      log('stdin quit sent, proc.killed=%s, proc.exitCode=%s', proc.killed, proc.exitCode);
      // Fallback: force kill after generous timeout if ffmpeg didn't exit
      setTimeout(() => {
        log('setTimeout fired: proc.killed=%s', proc.killed);
        if (!proc.killed) {
          killProcess(proc.pid);
        } else {
          log('proc.killed is true, skipping killProcess');
        }
      }, 3000);
    },
    process: proc,
    promise,
  };
}

/**
 * Start recording audio until the returned stop() function is called.
 * The caller MUST call stop() and then await the promise.
 * Without calling stop(), the recording continues indefinitely.
 *
 * @returns {{ stop: Function, process: import('child_process').ChildProcess, promise: Promise<string> }}
 */
function recordUntilStopped(config, outputPath) {
  return startRecording(config, outputPath);
}

async function recordFixedDuration(config, outputPath, durationSec) {
  const args = [
    '-y',
    ...getFfmpegInputArgs(config),
    '-t', String(durationSec),
    '-ar', String(config.audio.sampleRate),
    '-ac', String(config.audio.channels),
    '-f', 'wav',
    outputPath,
  ];
  log('Recording %ds to %s', durationSec, outputPath);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    proc.on('close', (code) => {
      log('Fixed duration done (code: %d)', code);
      if (code === 0 && fs.existsSync(outputPath)) resolve(outputPath);
      else reject(new Error(`ffmpeg exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

async function recordWithSilenceDetection(config, outputPath, silenceDuration = 1.5, silenceThreshold = -40) {
  const args = [
    '-y',
    ...getFfmpegInputArgs(config),
    '-ar', String(config.audio.sampleRate),
    '-ac', String(config.audio.channels),
    '-af', `silencedetect=noise=${silenceThreshold}dB:d=${silenceDuration}`,
    '-f', 'wav',
    outputPath,
  ];
  log('VAD recording: threshold=%sdB, duration=%ds', silenceThreshold, silenceDuration);
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    let silenceDetected = false;
    proc.stderr.on('data', (data) => {
      const text = data.toString();
      if (debug.isEnabled() && (text.includes('size=') || text.includes('time='))) {
        log('ffmpeg: %s', text.trim());
      }
      if (text.includes('silence_start')) log('Silence started');
      if (!silenceDetected && text.includes('silence_end')) {
        silenceDetected = true;
        log('Silence ended, stopping...');
        setTimeout(() => killProcess(proc.pid), 500);
      }
    });
    proc.on('close', (code) => {
      log('VAD closed (code: %d, silenceDetected: %s)', code, silenceDetected);
      if (fs.existsSync(outputPath)) {
        const stats = fs.statSync(outputPath);
        if (stats.size > 100) resolve(outputPath);
        else reject(new Error('Recording file too small'));
      } else {
        reject(new Error(`ffmpeg exited with code ${code}`));
      }
    });
    proc.on('error', (err) => {
      log.error('VAD error: %s', err.message);
      reject(err);
    });
    proc.forceStop = () => killProcess(proc.pid);
  });
}

module.exports = {
  startRecording,
  recordUntilStopped,
  recordFixedDuration,
  recordWithSilenceDetection,
  killProcess,
};
