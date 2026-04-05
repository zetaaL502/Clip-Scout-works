#!/usr/bin/env python3
import asyncio
import json
import edge_tts

async def main():
    voices = await edge_tts.list_voices()
    english_voices = [
        {
            "name": v["Name"],
            "shortName": v["ShortName"],
            "gender": v["Gender"],
            "locale": v["Locale"],
        }
        for v in voices
        if v["Locale"].startswith("en-")
    ]
    print(json.dumps(english_voices))

if __name__ == "__main__":
    asyncio.run(main())
