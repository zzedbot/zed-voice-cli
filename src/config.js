const { DEFAULT_MODEL } = require('./constants');

const fs = require('fs');
const path = require('path');
const os = require('os');
const { isWindows } = require('./platform');

/**
 * Load configuration from file system and environment variables.
 * Priority: CLI args > env vars > openclaw.json defaults > hardcoded defaults
 */
function loadConfig(cliOpts = {}) {
  const openclawConfig = loadOpenclawConfig();

  // Resolve gateway URL first so wsUrl can derive from it
  const gatewayUrl = cliOpts.gateway || process.env.ZED_VOICE_GATEWAY || openclawConfig?.gateway?.url || 'https://zedbot.kingdee.space/';

  return {
    // Gateway settings
    gateway: {
      url: gatewayUrl,
      wsUrl: cliOpts.gatewayWs || process.env.ZED_VOICE_GATEWAY_WS || deriveWsUrl(gatewayUrl),
      token: cliOpts.token || process.env.ZED_VOICE_TOKEN || openclawConfig?.gateway?.auth?.token || '',
      model: cliOpts.gatewayModel || process.env.ZED_VOICE_GATEWAY_MODEL || DEFAULT_MODEL,
    },
    // STT settings
    // Uses local whisper via Python API (bypasses broken whisper-cli)
    stt: {
      command: cliOpts.sttCommand || process.env.ZED_VOICE_STT_COMMAND || 'python',
      script: path.join(__dirname, 'whisper-stt.py'),
      model: cliOpts.sttModel || process.env.ZED_VOICE_STT_MODEL || 'small',
      language: cliOpts.language || process.env.ZED_VOICE_LANGUAGE || 'zh',
    },
    // TTS settings
    tts: {
      command: cliOpts.sttCommand || process.env.ZED_VOICE_STT_COMMAND || 'python',
      engine: cliOpts.ttsEngine || process.env.ZED_VOICE_TTS_ENGINE || null,
      apiKey: cliOpts.ttsApiKey || process.env.DASHSCOPE_API_KEY || extractBailianApiKey(openclawConfig),
      model: cliOpts.ttsModel || process.env.ZED_VOICE_TTS_MODEL || 'sambert-zhichu-v1',
      piperModel: cliOpts.ttsPiperModel || process.env.ZED_VOICE_TTS_PIPER_MODEL || 'zh_CN-huayan-medium',
      edgeVoice: cliOpts.ttsEdgeVoice || process.env.ZED_VOICE_TTS_EDGE_VOICE || 'zh-CN-XiaoxiaoNeural',
      edgeRate: cliOpts.ttsEdgeRate || process.env.ZED_VOICE_TTS_EDGE_RATE || '+0%',
      sampleRate: 16000,
    },
    // Audio settings
    audio: {
      recordDevice: cliOpts.recordDevice || process.env.ZED_VOICE_RECORD_DEVICE || (isWindows ? 'Microphone' : 'plughw:0,0'),
      sampleRate: 16000,
      channels: 1,
      format: 'S16_LE',
    },
    // Mode
    mode: cliOpts.mode || 'vad',
    // TUI
    tui: cliOpts.tui !== false && (cliOpts.tui === true || process.env.ZED_VOICE_TUI === '1') && !cliOpts.debug,
    // Debug
    debug: cliOpts.debug !== false && (cliOpts.debug === true || process.env.ZED_VOICE_DEBUG === '1') || false,
    // Paths
    tmpDir: path.join(os.tmpdir(), 'zed-voice'),
  };
}

function loadOpenclawConfig() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = fs.readFileSync(configPath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function extractBailianApiKey(openclawConfig) {
  if (!openclawConfig) return '';
  const providers = openclawConfig?.models?.providers;
  if (providers?.bailian?.apiKey) {
    return providers.bailian.apiKey;
  }
  return '';
}

function deriveWsUrl(httpUrl) {
  return httpUrl.replace(/^https/, 'wss').replace(/^http/, 'ws').replace(/\/$/, '') + '/ws';
}

function ensureTmpDir(config) {
  if (!fs.existsSync(config.tmpDir)) {
    fs.mkdirSync(config.tmpDir, { recursive: true });
  }
  return config.tmpDir;
}

module.exports = { loadConfig, ensureTmpDir };
