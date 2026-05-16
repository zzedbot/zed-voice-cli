#!/usr/bin/env python3
"""
Edge TTS wrapper - uses Microsoft Edge's free neural TTS service.
No API key required.

Usage:
  python tts-edge-tts.py <output_wav> <text> [--voice <voice_name>] [--rate <speech_rate>]

Output: WAV file at output_wav.
Exit code: 0 on success, 1 on error.
"""
import sys
import asyncio

def main():
    if len(sys.argv) < 3:
        print('Usage: tts-edge-tts.py <output_wav> <text> [--voice <name>] [--rate <rate>]', file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]
    text = sys.argv[2]
    voice = 'zh-CN-XiaoxiaoNeural'  # Default Chinese voice
    rate = '+0%'

    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == '--voice' and i + 1 < len(sys.argv):
            voice = sys.argv[i + 1]
            i += 2
        elif sys.argv[i] == '--rate' and i + 1 < len(sys.argv):
            rate = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    import edge_tts

    async def synthesize():
        communicate = edge_tts.Communicate(text, voice, rate=rate)
        await communicate.save(output_path)

    asyncio.run(synthesize())
    sys.exit(0)

if __name__ == '__main__':
    main()
