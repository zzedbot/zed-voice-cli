const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const debug = require('./debug');

const log = debug.createLogger('tts');

/**
 * TTS router: dispatches to the appropriate engine.
 * Priority: dashscope (if apiKey) > edge-tts (if installed) > piper (if installed).
 */
async function synthesize(config, text, outputPath) {
  if (!text || text.trim().length === 0) {
    return null;
  }

  const textPreview = text.slice(0, 50) + (text.length > 50 ? '...' : '');
  log('Synthesizing: "%s" (%d chars)', textPreview, text.length);

  const engine = resolveEngine(config);
  if (!engine) {
    throw new Error('No TTS engine available. Install edge-tts (pip install edge-tts) or piper-tts (pip install piper-tts), or set --tts-api-key.');
  }
  log('Using TTS engine: %s', engine);

  switch (engine) {
    case 'dashscope':
      return synthesizeDashScope(config, text, outputPath);
    case 'edge-tts':
      return synthesizeEdgeTts(config, text, outputPath);
    case 'piper':
      return synthesizePiper(config, text, outputPath);
    default:
      throw new Error(`Unknown TTS engine: ${engine}`);
  }
}

/**
 * Resolve which TTS engine to use based on config and availability.
 */
function resolveEngine(config) {
  if (config.tts.engine) {
    return config.tts.engine;
  }

  if (config.tts.apiKey) {
    return 'dashscope';
  }
  if (hasCommand('edge-tts')) {
    return 'edge-tts';
  }
  if (hasPythonModule('piper')) {
    return 'piper';
  }
  return null;
}

function hasCommand(name) {
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function hasPythonModule(moduleName) {
  try {
    const python = process.platform === 'win32' ? 'python' : 'python3';
    execSync(`${python} -c "import ${moduleName}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

// --- DashScope implementation ---

async function synthesizeDashScope(config, text, outputPath) {
  const https = require('https');

  if (!config.tts.apiKey) {
    throw new Error('DashScope API key not configured');
  }

  const requestBody = JSON.stringify({
    model: config.tts.model,
    input: { text },
    parameters: {
      text_type: 'PlainText',
      sample_rate: config.tts.sampleRate,
      format: 'wav',
      volume: 50,
      speech_rate: 0,
      pitch_rate: 0,
    },
  });

  const url = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/generation';
  const startTime = Date.now();

  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.tts.apiKey}`,
        'X-DashScope-Async': 'disable',
      },
    };

    log('POST %s (DashScope)', url);
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const data = Buffer.concat(chunks);
        const elapsed = Date.now() - startTime;

        if (res.statusCode === 200) {
          const contentType = res.headers['content-type'] || '';
          if (contentType.includes('application/json')) {
            try {
              const error = JSON.parse(data.toString());
              if (error.output && error.output.error_code) {
                log.error('TTS API error in %dms: %s', elapsed, JSON.stringify(error.output));
                reject(new Error(`DashScope TTS API error: ${error.output.message || JSON.stringify(error.output)}`));
                return;
              }
            } catch { /* Not valid JSON, proceed */ }
          }
          fs.writeFileSync(outputPath, data);
          log('TTS saved: %s (%d bytes, %dms)', outputPath, fs.statSync(outputPath).size, elapsed);
          resolve(outputPath);
        } else {
          reject(new Error(`DashScope TTS error: ${data.toString().slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('DashScope TTS timeout')); });
    req.setTimeout(30000);
    req.write(requestBody);
    req.end();
  });
}

// --- Edge TTS implementation ---

async function synthesizeEdgeTts(config, text, outputPath) {
  const voice = config.tts.edgeVoice || 'zh-CN-XiaoxiaoNeural';
  const rate = config.tts.edgeRate || '+0%';
  const cmd = config.tts.command || 'python';
  const script = path.join(__dirname, 'tts-edge-tts.py');

  // Escape text for command line
  const escapedText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  const fullCmd = `${cmd} "${script}" "${outputPath}" "${escapedText}" --voice ${voice} --rate ${rate}`;
  log('Running edge-tts');

  const startTime = Date.now();
  try {
    execSync(fullCmd, { encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'] });
    const elapsed = Date.now() - startTime;
    const stats = fs.statSync(outputPath);
    log('TTS saved: %s (%d bytes, %dms)', outputPath, stats.size, elapsed);
    return outputPath;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const stderr = err.stderr || '';
    log.error('Edge TTS failed in %dms: %s', elapsed, stderr.slice(0, 500) || err.message);
    // Fallback to piper if available
    if (hasPythonModule('piper')) {
      log('Falling back to piper TTS');
      return synthesizePiper(config, text, outputPath);
    }
    throw new Error(`edge-tts failed: ${stderr.slice(0, 300) || err.message}`);
  }
}

// --- Piper TTS implementation ---

async function synthesizePiper(config, text, outputPath) {
  const model = config.tts.piperModel || 'zh_CN-huayan-medium';
  const cmd = config.tts.command || 'python';
  const script = path.join(__dirname, 'tts-piper.py');

  // Escape text for command line
  const escapedText = text.replace(/"/g, '\\"').replace(/\\/g, '\\\\');
  const fullCmd = `${cmd} "${script}" "${outputPath}" "${escapedText}" --model ${model}`;
  log('Running piper-tts');

  const startTime = Date.now();
  try {
    execSync(fullCmd, { encoding: 'utf-8', timeout: 60000, stdio: ['pipe', 'pipe', 'pipe'] });
    const elapsed = Date.now() - startTime;
    const stats = fs.statSync(outputPath);
    log('TTS saved: %s (%d bytes, %dms)', outputPath, stats.size, elapsed);
    return outputPath;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    const stderr = err.stderr || '';
    log.error('Piper TTS failed in %dms: %s', elapsed, stderr.slice(0, 500) || err.message);
    throw new Error(`piper-tts failed: ${stderr.slice(0, 300) || err.message}`);
  }
}

module.exports = {
  synthesize,
  resolveEngine,
};
