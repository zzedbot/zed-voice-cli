const { spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const debug = require('./debug');

const log = debug.createLogger('player');

/**
 * Play an audio file using ffplay (cross-platform).
 */
function playAudio(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) {
    return Promise.reject(new Error(`File not found: ${filePath}`));
  }

  const args = ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath];
  log('Playing: %s', filePath);
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const proc = spawn('ffplay', args);
    proc.on('close', (code) => {
      const elapsed = Date.now() - startTime;
      log('Playback done in %dms (code: %d)', elapsed, code);
      if (code === 0) resolve();
      else reject(new Error(`ffplay exited with code ${code}`));
    });
    proc.on('error', (err) => {
      log.error('ffplay error: %s', err.message);
      reject(err);
    });
  });
}

/**
 * Play audio with control (can stop playback early).
 */
function playAudioWithControl(filePath, opts = {}) {
  if (!fs.existsSync(filePath)) {
    return {
      stop: () => {},
      promise: Promise.reject(new Error(`File not found: ${filePath}`)),
      isPlaying: () => false,
    };
  }

  const args = ['-nodisp', '-autoexit', '-loglevel', 'quiet', filePath];
  let playing = true;
  log('Playing with control: %s', filePath);

  const proc = spawn('ffplay', args);

  const promise = new Promise((resolve, reject) => {
    proc.on('close', (code) => {
      playing = false;
      log('Playback finished (code: %d)', code);
      if (code === 0) resolve();
      else reject(new Error(`ffplay exited with code ${code}`));
    });
    proc.on('error', (err) => {
      playing = false;
      log.error('ffplay error: %s', err.message);
      reject(err);
    });
  });

  return {
    stop: () => {
      log('Playback interrupted');
      playing = false;
      proc.kill('SIGINT');
    },
    promise,
    isPlaying: () => playing,
  };
}

module.exports = {
  playAudio,
  playAudioWithControl,
};
