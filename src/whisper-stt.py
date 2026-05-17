#!/usr/bin/env python3
"""
Whisper STT service - keeps model loaded in memory, processes audio files
via stdin commands to avoid repeated model loading overhead.

Protocol (line-based over stdin):
  transcribe <audio_file> <model> <language>
  exit

Response (stdout):
  OK: <transcribed_text>
  ERR: <error_message>
"""
import sys
import os
import io
import platform
import json

# Force UTF-8
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

_loaded_models = {}

def get_model(name):
    if name not in _loaded_models:
        import whisper
        machine = platform.machine().lower()
        use_fp16 = machine not in ('armv7l', 'armv6l', 'aarch64', 'arm64')
        _loaded_models[name] = whisper.load_model(name, device='cpu')
    return _loaded_models[name]

def transcribe(audio_file, model_name, language):
    if not os.path.exists(audio_file):
        return None, f'file not found: {audio_file}'
    try:
        model = get_model(model_name)
        result = model.transcribe(audio_file, language=language, fp16=False)
        return result.get('text', '').strip(), None
    except Exception as e:
        return None, str(e)

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('audio_file', nargs='?', help='Audio file (direct mode)')
    parser.add_argument('--model', default='tiny')
    parser.add_argument('--language', default='zh')
    parser.add_argument('--service', action='store_true', help='Run as persistent service')
    args = parser.parse_args()

    if args.service:
        # Service mode: read commands from stdin
        while True:
            try:
                line = sys.stdin.readline()
                if not line:
                    break
                line = line.strip()
                if line == 'exit':
                    break
                parts = line.split()
                if len(parts) >= 3 and parts[0] == 'transcribe':
                    text, err = transcribe(parts[1], parts[2], parts[3])
                    if err:
                        print(f'ERR: {err}')
                    else:
                        print(f'OK: {text}')
                    sys.stdout.flush()
            except Exception as e:
                print(f'ERR: {e}')
                sys.stdout.flush()
    elif args.audio_file:
        # Direct mode: single file (backwards compatible)
        text, err = transcribe(args.audio_file, args.model, args.language)
        if err:
            print(f'Error: {err}', file=sys.stderr)
            sys.exit(1)
        print(text)
        sys.exit(0)
    else:
        parser.print_help()
        sys.exit(1)

if __name__ == '__main__':
    main()
