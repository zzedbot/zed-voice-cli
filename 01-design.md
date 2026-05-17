# Zed Voice CLI 设计文档

## 目标

为 OpenClaw 构建一个跨平台 Node.js CLI 语音交互前端，支持三种交互模式，实现类似打电话的语音通话体验。

## 架构概述

```
用户语音 → ffmpeg 录音 → whisper-stt.py (本地 STT, Python API) → OpenClaw Gateway (WebSocket RPC) → openclaw AI → TTS (DashScope/edge-tts/piper) → ffplay 播放
```

**通信方式：** 通过 OpenClaw Gateway 的 WebSocket RPC 接口进行对话交互，支持 Ed25519 设备认证或 Bearer Token 兜底。

**技术栈：**
- Node.js + 核心模块（child_process, readline, crypto）
- openai-whisper（STT，本地 small 模型，通过 Python API 调用）
- ffmpeg（跨平台录音：Windows dshow / Linux ALSA）
- ffplay（跨平台播放）
- OpenClaw Gateway WebSocket RPC（对话）
- blessed（终端 UI）
- 多引擎 TTS：DashScope API / edge-tts / piper-tts

## 交互模式

### 1. Push-to-Talk (PTT) — 对讲机模式
- 按 Enter 开始录音，再按 Enter 结束
- 等待 AI 回复后播放
- 适合安静环境，精确控制

### 2. VAD (Voice Activity Detection) — 自动检测
- 自动检测语音结束，发送后等待回复
- 使用 ffmpeg 的 `silencedetect` 音频滤镜（阈值 -40dB，持续时间 1.5 秒）
- 适合自然对话体验

### 3. Full Duplex — 全双工
- 像打电话，可随时打断 AI 回复
- 播放 AI 回复时并行监听用户语音
- 检测到有效语音输入（>200ms，>2KB）即打断当前播放，将打断内容作为新消息发送
- 最接近真人对话

## 项目结构

```
zed-voice-cli/
├── src/
│   ├── index.js           # 入口、参数解析 (commander)、依赖验证、模式路由、TUI 支持
│   ├── config.js          # 分层配置加载
│   ├── setup.js           # 首次运行安装向导
│   ├── debug.js           # 按模块启用的调试日志
│   ├── platform.js        # 跨平台工具（isWindows）
│   ├── constants.js       # 共享常量（退出命令、系统提示词、默认模型）
│   ├── conversation.js    # 共享对话管道（STT→Gateway→TTS→Play）
│   ├── audio-devices.js   # 跨平台麦克风检测与选择
│   ├── recorder.js        # 录音模块 (ffmpeg, 跨平台)
│   ├── player.js          # 播放模块 (ffplay, 支持可中断)
│   ├── stt.js             # STT 调用入口
│   ├── whisper-stt.py     # Python STT wrapper (openai-whisper API)
│   ├── tts.js             # 多引擎 TTS 路由器
│   ├── tts-edge-tts.py    # Python edge-tts wrapper
│   ├── tts-piper.py       # Python piper-tts wrapper
│   ├── gateway.js         # WebSocket RPC 与 OpenClaw Gateway 通信
│   ├── tui.js             # blessed 终端 UI
│   └── modes/
│       ├── ptt.js         # Push-to-Talk 模式
│       ├── vad.js         # VAD 自动检测模式
│       └── duplex.js      # 全双工模式（可打断）
├── package.json
├── .gitignore
├── .zed-voice-setup-done  # 首次安装完成标记
├── README.md
└── CLAUDE.md
```

## 关键设计决策

### 跨平台音频

- 统一使用 ffmpeg 录音、ffplay 播放
- Windows 使用 dshow 后端（`-f dshow -i audio=<设备名>`），Linux 使用 ALSA（`-f alsa -i hw:X,Y`）
- 麦克风检测：Windows 通过 ffmpeg `-list_devices` 解析，Linux 通过 `arecord -l` 解析
- 启动时自动检测并让用户选择麦克风（多设备场景）
- 录音停止时先发送 `q` 到 ffmpeg stdin 实现优雅关闭，超时后 fallback 到进程 kill

### STT

- 使用 `whisper-stt.py` Python wrapper 直接调用 openai-whisper API（`whisper.load_model()` + `model.transcribe()`）
- 不再使用 whisper-cli（其 CLI 在 Python 3.11 上有 bug）
- 录音格式：16kHz mono WAV（whisper 推荐格式）
- ARM 架构（Raspberry Pi）自动禁用 FP16
- 文件 <1KB 自动跳过（噪音/误触）
- Python 脚本接收参数：`<audio_file> --model <model> --language <lang>`

### TTS

- 多引擎路由器，按优先级自动切换：
  1. **DashScope**：直接 HTTPS 调用 Sambert TTS API（同步模式，`X-DashScope-Async: disable`），响应体直接是音频二进制
  2. **edge-tts**：通过 `tts-edge-tts.py` 调用 Python edge_tts 库（免费云端，无需 API Key）
  3. **piper-tts**：通过 `tts-piper.py` 调用本地离线 TTS
- DashScope API Key 优先从 `~/.openclaw/openclaw.json` 的 `models.providers.bailian.apiKey` 读取
- edge-tts 失败时自动 fallback 到 piper
- 输出格式：WAV，16kHz mono

### Gateway 通信

- **WebSocket RPC**（非 HTTP）
- **Ed25519 设备认证**（优先）：
  - 读取 `~/.openclaw/identity/device.json`（含 deviceId、公钥、私钥 PEM）和 `device-auth.json`（含 deviceToken）
  - 连接后接收 `connect.challenge` 事件（含 nonce）
  - 用 Ed25519 私钥签名 v2 格式的 pipe 分隔 payload（含 nonce、deviceId、scopes、deviceToken）
  - 发送 `connect` RPC 请求（`type: req, method: connect`）完成握手
- **Bearer Token 兜底**：无设备身份时，使用 `Authorization: Bearer <token>` 头
- **消息传递**：通过 `agent` RPC 方法发送消息，通过 `agent.wait` RPC 等待 run 完成
- **流式累积**：在等待期间通过 `chat`/`agent` 事件累积流式文本
- **连接复用**：各模式创建持久化 WebSocket 连接并附加到 `config._gwConn`，跨对话轮次复用
- 消息级超时：agent 调用 30 秒，等待 run 完成 120 秒

### 录音与进程管理

- Windows 使用 `taskkill /PID <pid> /T`（先优雅后强制 `/F`）终止进程树
- Linux 使用 `SIGINT` + 延迟 `SIGKILL` 的优雅停止策略
- ffmpeg 停止时先发送 `q\n` 到 stdin 触发优雅关闭，3 秒超时后强制 kill
- 关闭后延迟 200ms 等待 OS 刷新文件句柄和写入数据

### 配置分层

配置优先级：CLI 参数 > 环境变量 > `~/.openclaw/openclaw.json` > 内置默认值

- `~/.openclaw/openclaw.json` 自动读取 gateway URL、token、bailian API key
- WebSocket URL 从 HTTP URL 自动推导（`https://` → `wss://`，追加 `/ws` 路径）
- 临时文件目录：`os.tmpdir()/zed-voice/`，启动时自动创建

### 依赖

- `commander` — CLI 参数解析
- `ws` — WebSocket 客户端
- `blessed` — 终端 UI（可选，仅 --tui 模式需要）
- 音频处理通过系统命令（ffmpeg、ffplay），STT 通过 Python API（openai-whisper）

## 安装方式

```bash
cd zed-voice-cli
npm install
npm link   # 使 zed-voice 命令全局可用
```

## 使用方式

```bash
zed-voice                          # 默认 PTT 模式
zed-voice --mode ptt               # 对讲机模式
zed-voice --mode vad               # VAD 模式
zed-voice --mode duplex            # 全双工模式
zed-voice --tui                    # 终端 UI 模式
zed-voice --tui --mode duplex      # UI + 全双工
zed-voice --gateway http://...     # 自定义 Gateway 地址
zed-voice --list-devices           # 列出麦克风
zed-voice --debug                  # 开启调试日志
zed-voice --setup                  # 首次安装向导
```

## 错误处理

- openai-whisper 未安装：提示 `pip3 install openai-whisper`（`index.js` 检查 `import whisper`）
- 模型未下载：自动下载，首次使用可能较慢（`stt.js` 提示自动下载）
- ffmpeg 缺失：提示运行 `zed-voice --setup`
- 麦克风不可用：提示检查音频设备或使用 `--record-device` 手动指定
- Gateway 不可达：WebSocket 连接失败，显示错误信息
- 录音文件太小：跳过处理，继续下一轮
- 退出命令：检测到"退出/结束/再见/拜拜/exit/quit/bye"自动退出

## Raspberry Pi 部署

本项目主要部署在带 480x320 LCD 屏幕的 Raspberry Pi 上。

### 用户与显示上下文

- **LCD 显示属于 `zedmini` 用户的桌面环境**（openbox 窗口管理器，`DISPLAY=:0`）。
- Node.js 安装在 `/root/.nvm` 下，zed-voice 进程以 root 身份运行。
- 通过 `xhost +local:` 授予 root 对 zedmini X11 会话的访问权限，xterm 窗口渲染在 zedmini 的屏幕上。

### 启动脚本 (`launch.sh`)

- 以 root 身份执行（需 sudo），通过 `xhost +local:` 获取 zedmini 的 X 授权。
- 在 zedmini 的 X 会话中运行 xterm 终端模拟器，zed-voice TUI 在其内渲染。
- 通过 `wmctrl -b add,fullscreen` 强制窗口全屏至 480x320，去除标题栏。
- 后台循环每 10 秒刷新全屏状态。

### 截图说明

- root 身份运行 `scrot`/`import` 读取的 fbdev 层与 zedmini 用户实际显示的不同
- 正确截图：`su - zedmini -c 'DISPLAY=:0 scrot /tmp/screenshot.png'`

### 音频设备

- Linux 默认使用 `plughw:X,Y` 而非 `hw:X,Y`。`plughw` 允许 ALSA 自动进行采样率和声道转换，兼容更多 USB 麦克风。
