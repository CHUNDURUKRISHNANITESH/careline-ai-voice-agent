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

Open the localhost URL printed by Vite (`http://localhost:5173/`), allow microphone access, and click **Try voice call**. Use fictional 10-digit phone numbers. Ask for availability, speak and confirm your phone number, book a slot, and cancel it while watching live dashboard updates.

## Tech Stack & Pipeline Description

- **Voice framework**: Pipecat (`pipecat-ai==0.0.99`) over native WebSocket (`ws://127.0.0.1:8765` for 16 kHz / 24 kHz PCM audio and call events; `ws://127.0.0.1:8766` for live dashboard snapshots)
- **VAD**: Silero VAD (`SileroVADAnalyzer`) for speech segmentation and immediate voice barge-in interruption
- **STT**: ElevenLabs (`ElevenLabsSTTService`)
- **LLM**: Google Gemini (`gemini-3.5-flash-lite` via `ResilientGoogleLLMService` with automatic fallback/retry and `thinking_level='minimal'`) with three registered Pipecat function-calling tools: `check_doctor_availability`, `book_appointment`, and `cancel_appointment`
- **TTS**: ElevenLabs (`ElevenLabsTTSService`, voice `EXAVITQu4vr4xnSDxMaL`)
- **Frontend**: React + Vite (`frontend/src.tsx`) with a phone-style call screen (ring/connect/end tones, live waveform, thinking loader, mute/end controls, live transcript, booking confirmation card), doctor availability browser, and live-updating appointments table with row highlights and an appointment details modal.

## Validation status

Python in-memory store, live WebSocket voice pipeline (Gemini + ElevenLabs STT/TTS), and Vite/TypeScript production build verified locally. Local WebSocket ports `8765` and `8766` must be free. No production authentication or TLS is provided.
