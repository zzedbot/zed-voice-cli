#!/bin/bash
# ============================================================
# zed-voice 一键启动脚本
# 在 Raspberry Pi LCD (480x320) 上全屏运行 zed-voice TUI
#
# 重要：LCD 显示属于 zedmini 用户的 X11 会话 (DISPLAY=:0)。
# 此脚本以 root 身份执行，通过 xhost +local: 获取 zedmini 的 X
# 授权，然后在 zedmini 的桌面会话中显示 xterm 窗口。
# Node.js 位于 /root/.nvm 下，必须以 root 身份运行。
#
# 用法:
#   sudo ./launch.sh                    # 默认 PTT 模式，本地 Gateway
#   sudo ./launch.sh vad                # VAD 模式
#   sudo ./launch.sh duplex             # 全双工模式
#   sudo ./launch.sh ptt hw:1           # 指定录音设备
#   sudo ./launch.sh vad http://HOST:PORT  # 自定义 Gateway
# ============================================================

# 必须以 root 执行
if [ "$(id -u)" != "0" ]; then
  echo "错误: 请使用 sudo 或 root 执行此脚本"
  exit 1
fi

export DISPLAY=:0

NODE="/root/.nvm/versions/node/v24.15.0/bin/node"
APP_DIR="/claude/workspace/zed-voice-cli"
MODE="${1:-ptt}"
GATEWAY="${2:-http://192.168.1.9:18789}"
DEVICE="${3:-}"

# --- 1. Kill existing instances ---
kill -9 $(ps aux | grep 'xterm.*zedvoice' | grep -v grep | awk '{print $2}') 2>/dev/null
kill -9 $(ps aux | grep 'zed-voice-cli/src' | grep -v grep | awk '{print $2}') 2>/dev/null
sleep 1

# --- 2. Get X11 access from zedmini user, hide panel ---
su - zedmini -c 'xhost +local: 2>/dev/null'
su - zedmini -c '
  PANEL=$(xdotool search --name "panel" 2>/dev/null | head -1)
  [ -n "$PANEL" ] && xdotool windowunmap "$PANEL" 2>/dev/null
'

# --- 3. Build command args ---
ARGS="--mode $MODE --tui --gateway $GATEWAY"
if [ -n "$DEVICE" ]; then
  ARGS="$ARGS --record-device $DEVICE"
fi

# --- 4. Launch xterm with inline node command (root connects to zedmini's X session) ---
xterm -hold -name zedvoice -geometry 72x29 -fa "Noto Sans Mono" -fs 11 -e /bin/bash -c "
  export NODE_TLS_REJECT_UNAUTHORIZED=0
  export PATH=\"/root/.nvm/versions/node/v24.15.0/bin:\$PATH\"
  export DISPLAY=:0
  exec $NODE $APP_DIR/src/index.js $ARGS
" &
disown
sleep 3

# --- 5. Wait for window and force fullscreen ---
WINID=""
for i in $(seq 1 20); do
  WINID=$(xdotool search --class "XTerm" 2>/dev/null | head -1)
  if [ -n "$WINID" ]; then
    break
  fi
  sleep 0.5
done

if [ -n "$WINID" ]; then
  wmctrl -i -r "$WINID" -b add,fullscreen 2>/dev/null
  xdotool windowsize "$WINID" 480 320 2>/dev/null
  xdotool windowmove "$WINID" 0 0 2>/dev/null
  xdotool windowfocus --sync "$WINID" 2>/dev/null
  xdotool windowraise "$WINID" 2>/dev/null
  echo "窗口已全屏: $WINID"
else
  echo "警告: 未找到终端窗口"
fi

# --- 6. Background loop to keep window fullscreen ---
(
  while true; do
    sleep 10
    WINID=$(xdotool search --class "XTerm" 2>/dev/null | head -1)
    if [ -n "$WINID" ]; then
      wmctrl -i -r "$WINID" -b add,fullscreen 2>/dev/null
      xdotool windowsize "$WINID" 480 320 2>/dev/null
      xdotool windowmove "$WINID" 0 0 2>/dev/null
    else
      break
    fi
  done
) &
disown

exit 0
