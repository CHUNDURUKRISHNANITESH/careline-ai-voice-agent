import asyncio,json,os
from pathlib import Path
from dotenv import load_dotenv
from websockets.asyncio.server import serve
import store
load_dotenv(Path(__file__).with_name('.env'))
class Channel:
    client=None
    async def send_json(self,data):
        if self.client is not None: await self.client.send(json.dumps(data))
async def dashboard_socket(ws):
    while True:
        await ws.send(json.dumps(store.dashboard()))
        await asyncio.sleep(1)
async def main():
    if not all(os.getenv(k) for k in ('ELEVENLABS_API_KEY','GOOGLE_API_KEY')): raise SystemExit('Configure .env first')
    from voice import run_voice
    async with serve(dashboard_socket,'127.0.0.1',8766):
        print('Dashboard socket: 8766; voice socket: 8765')
        while True:
            await run_voice(Channel())
            await asyncio.sleep(.3)
if __name__=='__main__': asyncio.run(main())
