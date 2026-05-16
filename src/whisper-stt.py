#!/usr/bin/env python3
"""
Whisper STT wrapper - calls openai-whisper Python API directly.
Bypasses the broken whisper-cli / argparse CLI issues on Python 3.11.

Usage:
  python whisper-stt.py <audio_file> [--model <model>] [--language <lang>]

Output: prints transcription text to stdout.
Exit code: 0 on success, 1 on error (error message to stderr).
"""
import sys
import os
import io
import platform

# Force UTF-8 output on Windows
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import json
import argparse

def main():
    parser = argparse.ArgumentParser(description='Whisper STT via Python API')
    parser.add_argument('audio_file', help='Path to audio file (WAV)')
    parser.add_argument('--model', default='small', help='Whisper model name')
    parser.add_argument('--language', default='zh', help='Language code')
    args = parser.parse_args()

    if not os.path.exists(args.audio_file):
        print(f'Error: file not found: {args.audio_file}', file=sys.stderr)
        sys.exit(1)

    import whisper

    # Raspberry Pi (ARM) doesn't support FP16, disable for compatibility
    machine = platform.machine().lower()
    use_fp16 = machine not in ('armv7l', 'armv6l', 'aarch64', 'arm64')

    model = whisper.load_model(args.model)
    result = model.transcribe(
        args.audio_file,
        language=args.language,
        fp16=use_fp16,  # CPU-friendly, disabled on ARM
    )

    text = result.get('text', '').strip()
    print(text)
    sys.exit(0)

if __name__ == '__main__':
    main()
