# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**zed-voice-cli** is a Node.js CLI that enables voice interaction with an AI assistant (OpenClaw Gateway). Users talk to their AI like a phone call, with three interaction modes:

- **PTT (Push-to-Talk)**: Press Enter to start/stop recording
- **VAD (Voice Activity Detection)**: Auto-detects speech end via silence detection
- **Full Duplex**: Interrupt AI at any time during playback, like a real phone call

## Architecture

The pipeline: `User Voice → ffmpeg (recorder) → whisper-stt.py (local STT) → OpenClaw Gateway (AI, WebSocket RPC) → TTS (DashScope/edge-tts/piper) → ffplay (player) → User`

### Source Structure

```
src/
  index.js          # CLI entry point (commander), mode router, first-run setup check, TUI support
  config.js         # Config loading: CLI args > env vars > ~/.openclaw/openclaw.json > defaults
  setup.js          # First-run interactive setup wizard (ffmpeg, Python, whisper, TTS engines)
  gateway.js        # WebSocket RPC communication with OpenClaw Gateway (Ed25519 device auth + Bearer token fallback)
  recorder.js       # Cross-platform audio recording via ffmpeg (dshow on Windows, ALSA on Linux)
  stt.js            # Speech-to-text via whisper-stt.py Python wrapper (openai-whisper API)
  whisper-stt.py    # Python wrapper for openai-whisper, bypasses CLI issues
  tts.js            # TTS router: dispatches to DashScope, edge-tts, or piper
  tts-edge-tts.py   # Python wrapper for edge-tts (free cloud TTS, no API key)
  tts-piper.py      # Python wrapper for piper-tts (offline TTS)
  player.js         # Audio playback via ffplay (with stop control for duplex interruption)
  audio-devices.js  # Cross-platform microphone detection (ffmpeg dshow / arecord)
  debug.js          # Simple enable/disable debug logger with per-module prefixes
  platform.js       # Cross-platform utility (isWindows)
  constants.js      # Shared constants (exit commands, system prompt, default model)
  conversation.js   # Shared STT → Gateway → TTS → Play pipeline with temp file cleanup
  tui.js            # Terminal UI based on blessed (status bar, avatar, conversation history, shortcuts)
  modes/
    ptt.js          # Push-to-Talk mode implementation
    vad.js          # Voice Activity Detection mode (silence-based auto-stop)
    duplex.js       # Full duplex mode with playback interruption support
```

### Key Design Decisions

- **No external audio libraries**: Uses ffmpeg/ffplay as subprocesses, openai-whisper Python API for STT
- **Cross-platform**: Windows (dshow) and Linux (ALSA/arecord) supported in recorder and audio-devices
- **First-run setup**: `.zed-voice-setup-done` marker file controls whether setup wizard runs
- **Config auto-detection**: Reads `~/.openclaw/openclaw.json` for gateway URL, token, bailian API key, and device auth identity
- **All audio temp files** go to `os.tmpdir()/zed-voice/` and are cleaned up after processing
- **STT uses Python wrapper**: `whisper-stt.py` calls openai-whisper API directly, bypassing broken whisper-cli
- **ARM compatibility**: FP16 disabled on ARM architectures (Raspberry Pi) in whisper-stt.py
- **Multi-engine TTS**: Auto-selects DashScope (if API key) > edge-tts (if installed) > piper (installed as fallback)
- **Gateway WebSocket RPC**: Uses Ed25519 challenge-response device auth when identity files exist, falls back to Bearer token. Protocol: connect.challenge → connect RPC → agent RPC → agent.wait for run completion
- **Persistent WS connection**: Modes attach a reusable WebSocket connection to `config._gwConn` across conversation turns
- **TUI mode**: `--tui` flag enables a blessed-based terminal UI with status bar, virtual avatar, scrollable chat history, and keyboard shortcuts (Q/M/Enter/Ctrl+L/S)

## Raspberry Pi Deployment

The primary deployment target is a Raspberry Pi with a 480x320 LCD screen.

- **Display context**: The LCD shows `zedmini` user's desktop environment (openbox window manager, `DISPLAY=:0`). Node.js resides under `/root/.nvm`, so the app runs as root.
- **X11 access**: Root connects to zedmini's X session via `su - zedmini -c 'xhost +local:'`, then launches xterm with `DISPLAY=:0` so the window appears on zedmini's screen.
- **Launch script**: `sudo ./launch.sh` — kills existing instances, grants X11 access, hides the panel, launches xterm fullscreen, and maintains fullscreen in a background loop.
- **Window management**: Uses `wmctrl -b add,fullscreen` to force the xterm window to 480x320 at position (0,0), removing the title bar.
- **Openbox config**: A custom application rule in `/home/zedmini/.config/openbox/rpd-rc.xml` targets `class="zedvoice"` windows with `<decor>no</decor>` and `<fullscreen>yes</fullscreen>`.
- **Audio**: Default device is `plughw:0,0` (not `hw:0`) to allow ALSA automatic format conversion for USB microphones.
- **Screenshot note**: `scrot` / `import` run as root read a different framebuffer layer than zedmini's actual display. Always screenshot as zedmini user: `su - zedmini -c 'DISPLAY=:0 scrot /tmp/screenshot.png'`.

## Development Commands

```bash
# Install dependencies
npm install

# Make CLI available globally
npm link

# Run (default VAD mode)
zed-voice
# or
npm start

# Run with specific mode
zed-voice --mode ptt
zed-voice --mode duplex

# Terminal UI mode
zed-voice --tui
zed-voice --tui --mode duplex

# List available audio devices
zed-voice --list-devices

# Enable debug logging
zed-voice --debug

# Run first-time setup wizard
zed-voice --setup

# Custom config
zed-voice --gateway http://localhost:18789 --token your-token --stt-model small --language zh
```

## Prerequisites (System Dependencies)

- Node.js >= 18
- ffmpeg (must be on PATH) — recording and playback
- Python 3 + pip — required for openai-whisper
- openai-whisper (pip package) — local STT model
- ffplay (bundled with ffmpeg) — audio playback
- alsa-utils (Linux only) — microphone detection
- blessed (npm package) — TUI mode (auto-installed via npm install)

## Gateway Authentication

The gateway uses WebSocket RPC (not HTTP). Two auth methods:

1. **Ed25519 device auth** (preferred): Reads `~/.openclaw/identity/device.json` and `device-auth.json`, signs a server nonce with Ed25519 private key. Protocol: `connect.challenge` event → `connect` RPC with signed payload → `hello-ok` → `agent` RPC for messages → `agent.wait` for run completion
2. **Bearer token fallback**: If no device identity, uses `Authorization: Bearer <token>` header

## Configuration Priority

CLI flags > Environment variables > `~/.openclaw/openclaw.json` > Hardcoded defaults

Key env vars: `ZED_VOICE_MODE`, `ZED_VOICE_GATEWAY`, `ZED_VOICE_TOKEN`, `ZED_VOICE_STT_MODEL`, `ZED_VOICE_LANGUAGE`, `ZED_VOICE_RECORD_DEVICE`, `DASHSCOPE_API_KEY`, `ZED_VOICE_TTS_ENGINE`, `ZED_VOICE_TTS_EDGE_VOICE`, `ZED_VOICE_TTS_EDGE_RATE`, `ZED_VOICE_TTS_PIPER_MODEL`, `ZED_VOICE_TUI`, `ZED_VOICE_DEBUG`
