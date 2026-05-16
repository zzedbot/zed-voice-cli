#!/usr/bin/env python3
"""
Piper TTS wrapper - local offline TTS engine.
Requires: pip install piper-tts
Model auto-downloads to ~/.local/share/piper on first use.

Usage:
  python tts-piper.py <output_wav> <text> [--model <model_name>]

Output: WAV file at output_wav.
Exit code: 0 on success, 1 on error.
"""
import sys
import os

def main():
    if len(sys.argv) < 3:
        print('Usage: tts-piper.py <output_wav> <text> [--model <model>]', file=sys.stderr)
        sys.exit(1)

    output_path = sys.argv[1]
    text = sys.argv[2]
    model = 'zh_CN-huayan-medium'  # Default Chinese voice

    i = 3
    while i < len(sys.argv):
        if sys.argv[i] == '--model' and i + 1 < len(sys.argv):
            model = sys.argv[i + 1]
            i += 2
        else:
            i += 1

    from piper import PiperVoice

    voice = PiperVoice.from_pretrained(model)
    wav = voice.synthesize(text)
    wav.export(output_path, format='wav')

    sys.exit(0)

if __name__ == '__main__':
    main()
