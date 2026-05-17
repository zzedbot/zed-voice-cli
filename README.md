# Zed Voice CLI

通过语音与 OpenClaw AI 助手对话，类似打电话的体验。

## 功能

- **按键说话（PTT）**：按 Enter 开始录音，再按 Enter 结束发送
- **语音活动检测（VAD）**：自动检测说话结束，自然对话体验
- **全双工（Duplex）**：AI 回复时随时打断，类似真实通话
- **终端 UI（TUI）**：`--tui` 启用可视化终端界面，含状态栏、虚拟形象、对话历史

## 首次使用

首次运行时会自动引导你安装依赖，也可以手动运行安装向导：

```bash
zed-voice --setup    # 交互式安装向导
```

也可以直接运行 `zed-voice`，首次启动会自动检测并提示。

## 系统要求

| 依赖 | 用途 | 自动安装 |
|------|------|----------|
| Node.js >= 18 | 运行环境 | 否（需手动安装） |
| ffmpeg (含 ffplay) | 录音 + 播放 | ✅ (Linux/Pi) |
| Python 3 + pip | 语音识别运行环境 | ✅ (Linux/Pi) |
| openai-whisper | 本地 STT 模型 | ✅ |
| alsa-utils (Linux) | 麦克风检测 | ✅ |
| blessed (npm) | TUI 界面 | ✅ (npm install) |

> Windows 用户需要手动安装 [ffmpeg](https://ffmpeg.org/download.html) 和 [Python 3](https://www.python.org/downloads/)。

## TTS 引擎

语音合成支持多种引擎，按优先级自动切换：

| 引擎 | 联网 | 音质 | 安装 |
|------|------|------|------|
| DashScope | 需要 | 最好 | 设置 API Key |
| edge-tts | 需要 | 好 | `pip install edge-tts` (免费) |
| piper-tts | 离线 | 中 | `pip install piper-tts` (免费) |

默认优先级：DashScope (有 Key) > edge-tts (默认，免费云端) > piper (离线兜底)

## 安装

```bash
npm install
npm link   # 使 zed-voice 命令全局可用
```

## 快速开始

```bash
# 默认 PTT 模式（推荐）
zed-voice

# 按键说话模式
zed-voice --mode ptt

# 全双工模式（可打断 AI）
zed-voice --mode duplex

# 终端 UI 模式（可视化界面）
zed-voice --tui
zed-voice --tui --mode duplex
```

## 终端 UI 模式

启用 `--tui` 后，CLI 切换为可视化终端界面：

- **顶栏**：显示应用版本、当前模式、状态（空闲/录音中/思考中/播放中）
- **虚拟形象**：左侧显示当前状态的 ASCII 表情
- **对话历史**：右侧可滚动的聊天记录，显示用户输入和 AI 回复
- **底部栏**：显示当前操作提示和快捷键
- **快捷键**：`Q` 退出、`M` 切换模式、`Ctrl+L` 清屏、`Enter` (PTT模式) 录音、`S` (Duplex模式) 静音

> `--debug` 和 `--tui` 互斥，debug 模式优先。

## Gateway 认证

Gateway 使用 WebSocket RPC 协议通信（非 HTTP）。支持两种认证方式：

1. **Ed25519 设备认证**（优先）：读取 `~/.openclaw/identity/device.json` 和 `device-auth.json`，通过 Ed25519 私钥签名服务器 nonce 完成握手
2. **Bearer Token**（兜底）：无设备身份时，使用 `Authorization: Bearer <token>` 头

## 命令行选项

| 选项 | 环境变量 | 默认值 | 说明 |
|------|----------|--------|------|
| `-m, --mode <mode>` | `ZED_VOICE_MODE` | `ptt` | 交互模式：`ptt`、`vad`、`duplex` |
| `-g, --gateway <url>` | `ZED_VOICE_GATEWAY` | `https://zedbot.kingdee.space/` | OpenClaw Gateway 地址 |
| `--gateway-ws <url>` | `ZED_VOICE_GATEWAY_WS` | 自动推导 | Gateway WebSocket 地址 |
| `-t, --token <token>` | `ZED_VOICE_TOKEN` | 从 openclaw.json 读取 | Gateway 认证令牌 |
| `--stt-model <model>` | `ZED_VOICE_STT_MODEL` | `small` | Whisper 模型名称 |
| `--language <lang>` | `ZED_VOICE_LANGUAGE` | `zh` | STT 识别语言代码 |
| `--tts-api-key <key>` | `DASHSCOPE_API_KEY` | 从 openclaw.json 读取 | DashScope TTS API 密钥 |
| `--tts-model <model>` | `ZED_VOICE_TTS_MODEL` | `sambert-zhichu-v1` | DashScope TTS 模型 |
| `--tts-engine <engine>` | `ZED_VOICE_TTS_ENGINE` | 自动检测 | TTS 引擎：`dashscope`、`edge-tts`、`piper` |
| `--tts-edge-voice <voice>` | `ZED_VOICE_TTS_EDGE_VOICE` | `zh-CN-XiaoxiaoNeural` | edge-tts 语音名称 |
| `--tts-edge-rate <rate>` | `ZED_VOICE_TTS_EDGE_RATE` | `+0%` | edge-tts 语速 |
| `--tts-piper-model <model>` | `ZED_VOICE_TTS_PIPER_MODEL` | `zh_CN-huayan-medium` | piper 模型名称 |
| `--record-device <dev>` | `ZED_VOICE_RECORD_DEVICE` | 自动检测 | 录音设备名称（跳过自动检测） |
| `--list-devices` | — | — | 列出可用麦克风并退出 |
| `-d, --debug` | `ZED_VOICE_DEBUG` | `false` | 开启调试日志 |
| `--tui` | `ZED_VOICE_TUI` | `false` | 启用终端 UI 模式 |
| `--setup` | — | — | 运行首次安装向导 |

配置优先级：CLI 参数 > 环境变量 > `~/.openclaw/openclaw.json` > 内置默认值。

## 交互模式详解

### PTT（按键说话）

- 按 Enter 开始录音，再按 Enter 结束
- 适合安静环境，精确控制录音时机
- 处理期间忽略 Enter 输入，防止并发

### VAD（语音活动检测）

- 自动监听，说话后自动检测结束（基于 ffmpeg silencedetect）
- 默认 silence 阈值：-40dB，持续时间：1.5 秒
- 最自然的免手动操作体验

### 全双工（Duplex）

- AI 播放回复时持续监听用户语音
- 检测到有效语音输入（>200ms，>2KB）即打断当前播放
- 打断内容作为新消息发送给 AI

## 架构

```
用户语音 → ffmpeg 录音 → whisper-stt.py (本地 STT) → OpenClaw Gateway (WebSocket RPC) → TTS (DashScope/edge-tts/piper) → ffplay 播放 → 用户
```

### 模块说明

| 模块 | 文件 | 职责 |
|------|------|------|
| 入口 | `src/index.js` | CLI 参数解析、依赖验证、模式路由、首次运行检测、TUI 支持 |
| 配置 | `src/config.js` | 分层配置加载（CLI > env > openclaw.json > 默认值） |
| 安装向导 | `src/setup.js` | 首次运行依赖检测与自动安装 |
| 录音 | `src/recorder.js` | 跨平台录音（Windows dshow / Linux ALSA）|
| STT | `src/stt.js` + `src/whisper-stt.py` | 本地 openai-whisper Python API 调用 |
| TTS | `src/tts.js` + `src/tts-edge-tts.py` + `src/tts-piper.py` | 多引擎 TTS 路由器 (DashScope/edge-tts/piper) |
| 播放 | `src/player.js` | ffplay 播放，支持可中断播放（全双工用） |
| 网关 | `src/gateway.js` | WebSocket RPC 通信（Ed25519 设备认证 + Bearer Token 兜底） |
| 音频设备 | `src/audio-devices.js` | 跨平台麦克风检测与交互式选择 |
| 调试 | `src/debug.js` | 按模块启用的调试日志 |
| 平台 | `src/platform.js` | 跨平台工具函数（isWindows） |
| 常量 | `src/constants.js` | 共享常量（退出命令、系统提示词） |
| 对话管道 | `src/conversation.js` | 共享 STT→Gateway→TTS→播放流程 |
| 终端 UI | `src/tui.js` | blessed 可视化界面（状态栏、虚拟形象、对话历史） |
| PTT 模式 | `src/modes/ptt.js` | 按键说话实现 |
| VAD 模式 | `src/modes/vad.js` | 自动语音检测实现 |
| 全双工模式 | `src/modes/duplex.js` | 可打断对话实现 |

### 跨平台音频

| 平台 | 录音输入 | 设备列举 |
|------|----------|----------|
| Windows | ffmpeg `-f dshow -i audio=<设备名>` | ffmpeg `-list_devices` |
| Linux | ffmpeg `-f alsa -i plughw:X,Y` | `arecord -l` |

> Linux 默认使用 `plughw:X,Y` 而非 `hw:X,Y`，前者允许 ALSA 自动进行采样率和声道转换，兼容更多 USB 麦克风。

## Raspberry Pi 一键全屏启动

本项目主要部署在带 480x320 LCD 屏幕的 Raspberry Pi 上。

### 用户与显示上下文

- **LCD 显示属于 `zedmini` 用户的桌面环境**（openbox 窗口管理器，`DISPLAY=:0`）。
- Node.js 安装在 `/root/.nvm` 下，因此 zed-voice 进程以 root 身份运行。
- 通过 `xhost +local:` 授予 root 对 zedmini X11 会话的访问权限，xterm 窗口渲染在 zedmini 的屏幕上。

### 启动方式

```bash
sudo ./launch.sh              # 默认 PTT 模式
sudo ./launch.sh vad          # VAD 模式
sudo ./launch.sh duplex       # 全双工模式
sudo ./launch.sh vad http://HOST:PORT  # 自定义 Gateway
```

### 窗口管理

- xterm 通过 `wmctrl -b add,fullscreen` 强制全屏至 480x320，去除标题栏。
- Openbox 配置文件 `/home/zedmini/.config/openbox/rpd-rc.xml` 包含针对 `class="zedvoice"` 的无装饰全屏规则。
- 后台循环每 10 秒刷新一次全屏状态，防止窗口被意外移动。

### 截图说明

- **LCD 屏幕属于 zedmini 用户的桌面环境**。root 身份运行截图工具（scrot/import）读取的是 fbdev 驱动的不同层，无法看到 zedmini 实际显示的内容。
- 正确截图方式：`su - zedmini -c 'DISPLAY=:0 scrot /tmp/screenshot.png'`

## 许可证

MIT
