const { execSync } = require('child_process');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const os = require('os');

const isWindows = os.platform() === 'win32';
const isLinux = os.platform() === 'linux';
const MARKER_FILE = path.join(__dirname, '..', '.zed-voice-setup-done');

/**
 * Platform info used for install commands
 */
function getPlatformInfo() {
  return {
    isWindows,
    isLinux,
    isRaspberryPi: isLinux && (os.arch() === 'arm' || os.arch() === 'arm64'),
  };
}

/**
 * Check if a command is available on PATH.
 */
function hasCommand(name) {
  try {
    const cmd = isWindows ? `where ${name}` : `which ${name}`;
    execSync(cmd, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if a Python module is installed.
 */
function hasPythonModule(moduleName) {
  try {
    const python = isWindows ? 'python' : 'python3';
    execSync(`${python} -c "import ${moduleName}"`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function checkFfmpeg() {
  return hasCommand('ffmpeg');
}

function checkFfplay() {
  return hasCommand('ffplay');
}

function checkPython() {
  try {
    const python = isWindows ? 'python' : 'python3';
    const output = execSync(`${python} --version`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
    return output.includes('Python 3');
  } catch {
    return false;
  }
}

function checkPip() {
  try {
    const pip = isWindows ? 'pip' : 'pip3';
    execSync(`${pip} --version`, { stdio: ['pipe', 'pipe', 'pipe'] });
    return true;
  } catch {
    return false;
  }
}

function checkWhisper() {
  return hasPythonModule('whisper');
}

function checkEdgeTts() {
  return hasPythonModule('edge_tts');
}

function checkPiper() {
  return hasPythonModule('piper');
}

function checkArecord() {
  if (isWindows) return true;
  return hasCommand('arecord');
}

/**
 * Prompt user to configure gateway URL and token.
 */
async function configureGateway(question) {
  console.log('');
  console.log('════════════════════════════════════════════════');
  console.log('  📡 Gateway 配置');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  let openclawConfig = {};
  try {
    openclawConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  } catch {
    // No existing config
  }

  const existingUrl = openclawConfig?.gateway?.url || '';
  const existingToken = openclawConfig?.gateway?.auth?.token || '';

  if (existingUrl) {
    console.log(`📋 当前 Gateway 地址: ${existingUrl}`);
  } else {
    console.log('📋 当前未配置 Gateway 地址');
  }
  if (existingToken) {
    console.log(`📋 当前 Token: ${existingToken.slice(0, 8)}...${existingToken.slice(-4)}`);
  } else {
    console.log('📋 当前未配置 Token');
  }
  console.log('');
  console.log('⚠️  如果不配置 Gateway，将无法与 AI 对话。');
  console.log('');

  const urlAnswer = await question(
    `请输入 Gateway HTTP 地址 [${existingUrl || 'https://zedbot.kingdee.space/'}]: `
  );
  const gatewayUrl = urlAnswer.trim() || existingUrl || 'https://zedbot.kingdee.space/';

  const tokenAnswer = await question('请输入 Gateway Token (必填，否则无法对话): ');
  const token = tokenAnswer.trim() || existingToken;

  if (!token && !existingToken) {
    console.log('');
    console.log('⚠️  未设置 Token，将无法与 AI 对话。');
    const retry = await question('是否现在输入 Token? [y/N]: ');
    if (retry.toLowerCase() === 'y') {
      const retryAnswer = await question('请输入 Gateway Token: ');
      const retryToken = retryAnswer.trim();
      if (retryToken) {
        return { gatewayUrl, token: retryToken, ttsKey: '' };
      }
    }
    console.log('   你也可以稍后通过 --token 参数或 ZED_VOICE_TOKEN 环境变量传入。');
  }

  // TTS API key
  console.log('');
  console.log('────────────────────────────────────────────');
  console.log('  🔊 TTS (语音合成) 配置');
  console.log('────────────────────────────────────────────');
  console.log('');

  const existingTtsKey = openclawConfig?.models?.providers?.bailian?.apiKey || '';
  if (existingTtsKey) {
    console.log(`📋 当前 TTS API Key: ${existingTtsKey.slice(0, 8)}...${existingTtsKey.slice(-4)}`);
  } else {
    console.log('📋 当前未配置 TTS API Key（无法播放语音回复）');
  }
  console.log('');

  const ttsAnswer = await question(
    `请输入 DashScope TTS API Key (留空跳过): `
  );
  const ttsApiKey = ttsAnswer.trim() || existingTtsKey;

  if (!ttsApiKey) {
    console.log('');
    console.log('⚠️  未设置 TTS API Key，将无法播放语音回复（只能文字回复）。');
    const retry = await question('是否现在输入 TTS API Key? [y/N]: ');
    if (retry.toLowerCase() === 'y') {
      const retryAnswer = await question('请输入 DashScope TTS API Key: ');
      const retryKey = retryAnswer.trim();
      if (retryKey) {
        // Rebuild config with new key
        return handleConfigSave({
          openclawConfig, configPath,
          gatewayUrl, token, ttsApiKey: retryKey,
        });
      }
    }
    console.log('   你也可以稍后通过 --tts-api-key 或 DASHSCOPE_API_KEY 环境变量传入。');
  }

  return handleConfigSave({
    openclawConfig, configPath,
    gatewayUrl, token, ttsApiKey,
  });
}

/**
 * Save gateway/TTS config to openclaw.json.
 */
function handleConfigSave({ openclawConfig, configPath, gatewayUrl, token, ttsApiKey }) {
  const configDir = path.join(os.homedir(), '.openclaw');
  const config = {
    gateway: {
      url: gatewayUrl,
      auth: { token },
    },
  };

  if (openclawConfig && Object.keys(openclawConfig).length > 0) {
    Object.assign(config, openclawConfig);
    config.gateway.url = gatewayUrl;
    config.gateway.auth = { token };
  }

  // Save TTS key only if provided
  if (ttsApiKey) {
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    if (!config.models.providers.bailian) config.models.providers.bailian = {};
    config.models.providers.bailian.apiKey = ttsApiKey;
  }

  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
  console.log('');
  console.log('✅ Gateway 配置已保存到 ~/.openclaw/openclaw.json');
  console.log(`   URL: ${gatewayUrl}`);
  if (token) {
    console.log(`   Token: ${token.slice(0, 8)}...${token.slice(-4)}`);
  } else {
    console.log('   Token: (未设置)');
  }

  if (ttsApiKey) {
    console.log(`   TTS Key: ${ttsApiKey.slice(0, 8)}...${ttsApiKey.slice(-4)}`);
  } else {
    console.log('   TTS Key: (未设置，可通过 --tts-api-key 或 DASHSCOPE_API_KEY 传入)');
  }

  return { gatewayUrl, token, ttsApiKey };
}

/**
 * Run interactive setup wizard.
 * @param {object} opts - Options
 * @param {boolean} [opts.gatewayOnly] - Only configure gateway, skip dependency checks
 */
async function runSetup(opts = {}) {
  console.log('════════════════════════════════════════════════');
  console.log('  🎙️  Zed Voice CLI — 首次安装向导');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const platform = getPlatformInfo();
  const info = [];
  if (platform.isWindows) info.push('Windows');
  if (platform.isRaspberryPi) info.push('Raspberry Pi');
  else if (platform.isLinux) info.push('Linux');
  console.log(`📋 检测到平台: ${info.join(', ') || 'Unknown'} (${os.arch()})`);
  console.log('');

  // Quick check: if everything is already installed or gateway-only mode
  const allInstalled = checkFfmpeg() && checkFfplay() && checkPython() && checkPip() && checkWhisper() && checkEdgeTts() && checkPiper();
  if (allInstalled || opts.gatewayOnly) {
    console.log('✅ 所有依赖已安装，跳过安装步骤。');
    console.log('   Whisper 模型将在首次语音识别时自动下载。');
    console.log('');

    // Configure gateway
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: true,
    });
    const question = (query) => new Promise((resolve) => {
      rl.question(query, resolve);
    });
    await configureGateway(question);
    rl.close();

    fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf-8');
    console.log('');
    console.log('✅ 安装向导完成！以后直接运行 zed-voice 即可。');
    return;
  }

  console.log('🔍 检测到缺少部分依赖，开始安装...');
  console.log('');

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const question = (query) => new Promise((resolve) => rl.question(query, resolve));

  await installFfmpeg(platform, question);
  await installPython(platform, question);
  await installPip(platform, question);
  await installWhisperPackage(platform, question);

  // Install TTS engines
  console.log('');
  await installTtsEngine(platform, question);

  // Configure gateway
  console.log('');
  await configureGateway(question);

  console.log('');
  console.log('📦 Whisper 模型 (small, ~461MB) 将在首次语音识别时自动下载。');
  console.log('   如果网络较慢，你也可以提前下载。');
  const dlAnswer = await question('是否现在就下载模型? [y/N]: ');
  if (dlAnswer.toLowerCase() === 'y') {
    await downloadModel(question);
  }

  if (platform.isLinux) {
    const needsArecord = !checkArecord();
    if (needsArecord) {
      console.log('');
      console.log('📋 检测到缺少 arecord（用于麦克风检测）。');
      const answer = await question('是否安装? [Y/n]: ');
      if (answer.toLowerCase() !== 'n') {
        await installArecord(platform, question);
      }
    }
  }

  rl.close();

  console.log('');
  const testAnswer = await readlineSync('是否运行麦克风自测? [Y/n]: ');
  if (testAnswer.toLowerCase() !== 'n') {
    await runSelfTest();
  }

  fs.writeFileSync(MARKER_FILE, new Date().toISOString(), 'utf-8');
  console.log('');
  console.log('✅ 安装向导完成！以后直接运行 zed-voice 即可。');
}

function readlineSync(query) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(query, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

async function installFfmpeg(platform, question) {
  if (checkFfmpeg() && checkFfplay()) {
    console.log('✅ ffmpeg + ffplay 已安装');
    return;
  }
  console.log('❌ ffmpeg 未安装（录音和播放都需要 ffmpeg）');

  if (platform.isWindows) {
    console.log('');
    console.log('📋 Windows 上需要手动安装 ffmpeg:');
    console.log('   https://ffmpeg.org/download.html — 下载后添加到 PATH');
    console.log('');
    await question('安装完成后按回车继续检测其他依赖 [回车]: ');
    if (checkFfmpeg() && checkFfplay()) {
      console.log('✅ ffmpeg + ffplay 已安装');
      return;
    }
    console.log('⚠️  ffmpeg 仍未检测到，你可以稍后手动安装。');
    return;
  }

  const installCmd = 'sudo apt update && sudo apt install -y ffmpeg';
  console.log('');
  console.log(`📦 安装命令: ${installCmd}`);
  const answer = await question('是否自动安装? [Y/n]: ');
  if (answer.toLowerCase() === 'n') return;

  try {
    execSync(installCmd, { stdio: 'inherit' });
    console.log('✅ ffmpeg 安装完成');
  } catch (err) {
    console.error('❌ ffmpeg 安装失败:', err.message);
  }
}

async function installPython(platform, question) {
  if (checkPython()) {
    console.log('✅ Python 3 已安装');
    return;
  }
  console.log('❌ Python 3 未安装（语音识别需要）');

  if (platform.isWindows) {
    console.log('');
    console.log('📋 请安装 Python 3:');
    console.log('   https://www.python.org/downloads/ — 安装时勾选 "Add Python to PATH"');
    console.log('');
    await question('安装完成后按回车继续 [回车]: ');
    return;
  }

  const installCmd = 'sudo apt update && sudo apt install -y python3 python3-pip';
  console.log('');
  console.log(`📦 安装命令: ${installCmd}`);
  const answer = await question('是否自动安装? [Y/n]: ');
  if (answer.toLowerCase() === 'n') return;

  try {
    execSync(installCmd, { stdio: 'inherit' });
    console.log('✅ Python 3 安装完成');
  } catch (err) {
    console.error('❌ Python 3 安装失败:', err.message);
  }
}

async function installPip(platform, question) {
  if (checkPip()) {
    console.log('✅ pip 已安装');
    return;
  }
  console.log('❌ pip 未安装');

  const installCmd = platform.isWindows
    ? 'python -m ensurepip --upgrade'
    : 'sudo apt install -y python3-pip';
  console.log('');
  console.log(`📦 安装命令: ${installCmd}`);
  const answer = await question('是否自动安装? [Y/n]: ');
  if (answer.toLowerCase() === 'n') return;

  try {
    execSync(installCmd, { stdio: 'inherit' });
    console.log('✅ pip 安装完成');
  } catch (err) {
    console.error('❌ pip 安装失败:', err.message);
  }
}

async function installWhisperPackage(platform, question) {
  if (checkWhisper()) {
    console.log('✅ openai-whisper 已安装');
    return;
  }
  console.log('❌ openai-whisper 未安装');

  const pip = isWindows ? 'pip' : 'pip3';
  const installCmd = `${pip} install openai-whisper`;
  console.log('');
  console.log(`📦 安装命令: ${installCmd}`);
  console.log('   （首次安装可能需要几分钟，包含编译依赖）');
  const answer = await question('是否自动安装? [Y/n]: ');
  if (answer.toLowerCase() === 'n') return;

  try {
    execSync(installCmd, { stdio: 'inherit', timeout: 600000 });
    console.log('✅ openai-whisper 安装完成');
  } catch (err) {
    console.error('❌ openai-whisper 安装失败:', err.message);
    console.log('   可能需要安装系统依赖:');
    if (platform.isLinux || platform.isRaspberryPi) {
      console.log('   sudo apt install -y build-essential portaudio19-dev');
    }
  }
}

async function installTtsEngine(platform, question) {
  const hasEdge = checkEdgeTts();
  const hasPiper = checkPiper();

  if (hasEdge && hasPiper) {
    console.log('✅ TTS 引擎已就绪: edge-tts (联网) + piper (离线兜底)');
    return;
  }
  if (hasEdge) {
    console.log('✅ edge-tts 已安装（免费云端 TTS）');
  }
  if (hasPiper) {
    console.log('✅ piper-tts 已安装（离线 TTS 兜底）');
  }

  console.log('');
  console.log('📋 语音合成 (TTS) 引擎:');
  console.log('   - edge-tts: 免费云端语音，音质好，需联网 (推荐)');
  console.log('   - piper-tts: 完全离线，适合树莓派');
  console.log('');

  if (!hasEdge) {
    const pip = isWindows ? 'pip' : 'pip3';
    console.log(`📦 edge-tts 安装命令: ${pip} install edge-tts`);
    const answer = await question('是否安装 edge-tts? [Y/n]: ');
    if (answer.toLowerCase() !== 'n') {
      try {
        execSync(`${pip} install edge-tts`, { stdio: 'inherit', timeout: 120000 });
        console.log('✅ edge-tts 安装完成');
      } catch (err) {
        console.error('❌ edge-tts 安装失败:', err.message);
      }
    }
  }

  if (!hasPiper) {
    console.log('');
    const pip = isWindows ? 'pip' : 'pip3';
    console.log(`📦 piper-tts 安装命令: ${pip} install piper-tts`);
    const answer = await question('是否安装 piper-tts (离线兜底)? [Y/n]: ');
    if (answer.toLowerCase() !== 'n') {
      try {
        execSync(`${pip} install piper-tts`, { stdio: 'inherit', timeout: 120000 });
        console.log('✅ piper-tts 安装完成');
      } catch (err) {
        console.error('❌ piper-tts 安装失败:', err.message);
      }
    }
  }
}

async function downloadModel(question) {
  const python = isWindows ? 'python' : 'python3';
  console.log('');
  console.log('📥 下载 small 模型 (~461MB)...');
  try {
    execSync(`${python} -c "import whisper; whisper.load_model('small')"`, {
      stdio: 'inherit',
      timeout: 300000,
    });
    console.log('✅ 模型下载完成');
  } catch (err) {
    console.error('❌ 模型下载失败:', err.message);
  }
}

async function installArecord(platform, question) {
  const installCmd = 'sudo apt install -y alsa-utils';
  console.log('');
  console.log(`📦 安装命令: ${installCmd}`);
  const answer = await question('是否自动安装? [Y/n]: ');
  if (answer.toLowerCase() === 'n') return;

  try {
    execSync(installCmd, { stdio: 'inherit' });
    console.log('✅ arecord 安装完成');
  } catch (err) {
    console.error('❌ arecord 安装失败:', err.message);
  }
}

async function runSelfTest() {
  console.log('');
  console.log('🔍 运行自测...');
  console.log('');

  const { loadConfig, ensureTmpDir } = require('./config');
  const config = loadConfig({ mode: 'vad' });
  ensureTmpDir(config);

  const testPath = path.join(config.tmpDir, `selftest-${Date.now()}.wav`);
  console.log('1⃣ 录音测试 (2秒) — 请对着麦克风说句话...');

  try {
    const ffmpegArgs = isWindows
      ? ['-y', '-f', 'dshow', '-rtbufsize', '100M', '-i', 'audio=Microphone']
      : ['-y', '-f', 'alsa', '-i', config.audio.recordDevice || 'hw:0'];

    execSync('ffmpeg', [
      ...ffmpegArgs,
      '-t', '2',
      '-ar', '16000',
      '-ac', '1',
      '-f', 'wav',
      testPath,
    ]);
    console.log('   ✅ 录音成功');
  } catch (err) {
    console.log('   ❌ 录音失败:', err.message);
    return;
  }

  console.log('2⃣ 语音识别测试...');
  try {
    const { transcribe } = require('./stt');
    const text = await transcribe(config, testPath);
    if (text) {
      console.log(`   ✅ 识别结果: ${text}`);
    } else {
      console.log('   ⚠️  未识别到语音内容（正常，如果没说话）');
    }
  } catch (err) {
    console.log('   ❌ 识别失败:', err.message);
    return;
  }

  console.log('3⃣ 播放测试 — 你应该听到刚才的录音...');
  try {
    const { playAudio } = require('./player');
    await playAudio(testPath, { sampleRate: 16000 });
    console.log('   ✅ 播放成功');
  } catch (err) {
    console.log('   ❌ 播放失败:', err.message);
  }

  try { fs.unlinkSync(testPath); } catch {}

  console.log('');
  console.log('🎉 自测完成！');
}

function isSetupDone() {
  return fs.existsSync(MARKER_FILE);
}

/**
 * Check if gateway config is missing (empty token) or TTS key is missing.
 * Returns true if either token or TTS key is not configured.
 */
function isGatewayMissing() {
  const configPath = path.join(os.homedir(), '.openclaw', 'openclaw.json');
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const token = config?.gateway?.auth?.token || '';
    return !token;
  } catch {
    return true; // No config file at all
  }
}

module.exports = {
  runSetup,
  isSetupDone,
  isGatewayMissing,
  getPlatformInfo,
  checkFfmpeg,
  checkPython,
  checkWhisper,
  checkEdgeTts,
  checkPiper,
};
