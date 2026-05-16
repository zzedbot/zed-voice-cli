# Zed Voice CLI 实现计划（已完成）

> 本计划的 9 个 Task 已全部实现。以下为变更记录。

## 实现概览

| Task | 模块 | 文件 | 状态 |
|------|------|------|------|
| 1 | 项目初始化 | `package.json`, `src/index.js`, `src/config.js`, `.gitignore` | ✅ |
| 2 | 录音模块 | `src/recorder.js` | ✅ |
| 3 | 播放模块 | `src/player.js` | ✅ |
| 4 | STT 模块 | `src/stt.js`, `src/whisper-stt.py` | ✅ |
| 5 | TTS 模块 | `src/tts.js`, `src/tts-edge-tts.py`, `src/tts-piper.py` | ✅ |
| 6 | Gateway 通信 | `src/gateway.js` | ✅ |
| 7 | PTT 模式 | `src/modes/ptt.js` | ✅ |
| 8 | VAD 模式 | `src/modes/vad.js` | ✅ |
| 9 | 全双工模式 | `src/modes/duplex.js` | ✅ |

## 偏离原计划的变更

原计划（本文件原始版本）以 Linux + arecord/aplay 为基础设计，实际实现中做了以下调整：

1. **跨平台支持**：录音统一使用 ffmpeg（Windows dshow / Linux ALSA），不再依赖 arecord/aplay
2. **播放统一使用 ffplay**：替代 aplay，Windows/Linux 通用
3. **Gateway 接口**：使用 WebSocket RPC 协议（含 Ed25519 设备认证），替代原计划的 HTTP API
4. **新增 audio-devices.js**：跨平台麦克风检测与交互式选择
5. **新增 debug.js**：按模块启用的调试日志系统
6. **Windows 进程管理**：使用 `taskkill /F /T` 终止 ffmpeg 进程树
7. **新增 src/tui.js**：基于 blessed 的终端 UI 模式（`--tui` 标志）
8. **新增 src/setup.js**：交互式首次安装向导（`--setup` 标志）
9. **新增 src/constants.js**：共享常量模块（退出命令、系统提示词、默认模型）
10. **新增 src/conversation.js**：提取 STT→Gateway→TTS→Play 共享管道，消除模式间代码重复
11. **STT 改用 Python wrapper**：使用 `whisper-stt.py` 直接调用 openai-whisper Python API，替代 whisper-cli
12. **多引擎 TTS 支持**：新增 edge-tts（免费云端）和 piper-tts（离线兜底），替代仅 DashScope
13. **Ed25519 设备认证**：Gateway 支持 `~/.openclaw/identity/` 下的设备身份签名认证
14. **持久化 WebSocket 连接**：各模式复用 `config._gwConn` 跨对话轮次
15. **依赖更新**：新增 `blessed` npm 包用于 TUI 模式

## 后续可优化方向

- 流式 TTS 输出（边生成边播放，减少延迟）
- VAD 参数可调（silence 阈值、持续时间）
- 配置持久化（保存用户上次选择的设备）
