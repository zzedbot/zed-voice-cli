#!/bin/bash
# ============================================================
# zed-voice 关闭脚本
# 完全停止 zed-voice 相关进程
#
# 用法: sudo ./stop.sh
# ============================================================

export DISPLAY=:0

# --- 1. Kill xterm windows by name ---
WINIDS=$(xdotool search --class "XTerm" --name "zedvoice" 2>/dev/null)
if [ -n "$WINIDS" ]; then
  for WINID in $WINIDS; do
    PID=$(xdotool getwindowpid "$WINID" 2>/dev/null)
    [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null
  done
fi

# --- 2. Kill all zed-voice processes ---
kill -9 $(ps aux | grep 'xterm.*zedvoice' | grep -v grep | grep -v stop.sh | awk '{print $2}') 2>/dev/null
kill -9 $(ps aux | grep 'zed-voice-cli/src' | grep -v grep | grep -v stop.sh | awk '{print $2}') 2>/dev/null
kill -9 $(ps aux | grep 'index.js.*zed-voice' | grep -v grep | grep -v stop.sh | grep -v 'openclaw/dist' | awk '{print $2}') 2>/dev/null
kill -9 $(ps aux | grep 'ffmpeg.*zed-voice' | grep -v grep | grep -v stop.sh | awk '{print $2}') 2>/dev/null

sleep 1

# --- 3. Verify all zed-voice processes are gone ---
REMAINING=$(ps aux | grep -E 'xterm.*zedvoice|zed-voice-cli/src|ffmpeg.*zed-voice' | grep -v grep | grep -v stop.sh | grep -v 'openclaw/dist')
if [ -n "$REMAINING" ]; then
  echo "警告: 以下进程仍在运行:"
  echo "$REMAINING" | awk '{print $2}' | xargs kill -9 2>/dev/null
  sleep 1
fi

# --- 4. Refresh X display to clear window artifacts ---
xrefresh 2>/dev/null

echo "✅ zed-voice 已完全关闭"
exit 0
