#!/usr/bin/env python3
import sys
import asyncio
import edge_tts

async def main():
    if len(sys.argv) < 3:
        print("Usage: tts_generate.py <voice> <output_file> [text]", file=sys.stderr)
        sys.exit(1)

    voice = sys.argv[1]
    output_file = sys.argv[2]
    text = sys.argv[3] if len(sys.argv) > 3 else "Hello"

    communicate = edge_tts.Communicate(text, voice)
    await communicate.save(output_file)

if __name__ == "__main__":
    asyncio.run(main())
