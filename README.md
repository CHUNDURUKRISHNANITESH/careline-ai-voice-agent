# CareLine AI — minimal assignment edition

Two components: Python Pipecat voice pipeline and React dashboard. No separate FastAPI application, REST endpoints or database. The Python process uses native WebSocket transport for audio and a small WebSocket snapshot channel for the dashboard. In-memory fictional appointments reset on restart. Local demo only; no real patient data.

## Windows setup

In CMD, from the extracted project:

```cmd
cd voice_pipeline
py -3.13 -m venv .venv
.venv\Scripts\activate
python -m pip install -r requirements.txt
copy .env.example .env
notepad .env
python run.py
```

Fill in ElevenLabs and Google keys locally before running. Never commit `.env`.

In another CMD from the project root:

```cmd
cd frontend
npm install
npm run dev
```

Open the localhost URL printed by Vite, allow microphone access, click Try voice call. Use fictional phone numbers. Ask for availability, confirm a spoken phone number, book a slot, then cancel it. Verify the dashboard updates. The LLM is Gemini (configured in .env); ElevenLabs handles STT and TTS. Silero VAD is optional functionality included. Phone confirmation is enforced by LLM instructions and a confirmation argument, not independent identity verification.

## Validation status

Python syntax and in-memory booking logic checked locally. Native Pipecat transport, live API calls, browser audio and frontend build have not been verified in this environment. Test them before submission. The native transport API may need adjustment for the pinned version. Local WebSocket ports 8765 and 8766 must be free. No production authentication or TLS is provided.
