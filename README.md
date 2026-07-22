# FastScribe

Minimal, local audio transcription desktop app. Electron UI + a Python
[`faster-whisper`](https://github.com/SYSTRAN/faster-whisper) backend. Audio
never leaves your machine — transcription runs fully offline after the model is
downloaded once.

## Download

Prebuilt installers for macOS (`.dmg`), Windows (`.exe`), and Linux
(`.AppImage`) are attached to each [release](https://github.com/estevE11/fastscribe/releases).
They bundle the Python backend — no Python install required.

### macOS: "FastScribe is damaged / malware" on first launch

The builds are **not signed or notarized** (that requires a paid Apple Developer
account). Because the app bundles a Python backend, macOS Gatekeeper may quarantine
it and — on recent macOS versions — even move it to the Bin, reporting it as
malware. This is a **false positive** from the unsigned bundle, not actual malware.

To run it, strip the quarantine flag **before** first launch:

```bash
# 1. Open the .dmg and drag FastScribe to Applications, then:
xattr -cr /Applications/FastScribe.app
# 2. Open it normally.
```

If macOS already moved it to the Bin, restore it to Applications first, then run
the command above. Alternatively, after a blocked launch, allow it under
*System Settings → Privacy & Security → Open Anyway*.

> Prefer to build it yourself and avoid this entirely? See
> [Setup](#setup) — locally built apps are not quarantined.

## Features

- Drag-and-drop or file-picker for `.mp3`, `.wav`, `.m4a`, `.opus`
- Language selector (auto-detect or force a specific language)
- Voice-activity filtering to suppress silence hallucinations
- In-memory list of transcriptions with filename, timestamp, detected language
- Dark, minimal UI
- Python backend auto-spawned and cleanly terminated by Electron

## Architecture

```
fastcribe/
├── main.js                 Electron main: spawns/kills backend, opens window
├── preload.js              contextBridge — exposes backend URL only
├── renderer/               UI (dark theme, dropzone, language selector)
│   ├── index.html
│   ├── styles.css
│   └── renderer.js
├── python_backend/
│   ├── main.py             FastAPI + faster-whisper (WhisperModel "small")
│   └── requirements.txt
└── package.json
```

- **Backend:** FastAPI on `http://127.0.0.1:8000`, `POST /transcribe`
  (multipart file + optional `language`) → `{ filename, transcript, language }`.
- **Lifecycle:** `main.js` spawns the backend on launch (preferring the project
  virtualenv interpreter) and kills it on quit.

## Prerequisites

- Node.js 18+
- Python 3.9+
- macOS / Windows / Linux

## Setup

### 1. Python backend

```bash
cd python_backend
python3 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
deactivate
```

The first transcription downloads the Whisper `small` model (~460 MB) and caches
it; subsequent runs are fast.

### 2. Electron app

```bash
npm install
npm start
```

`npm start` auto-spawns the backend and opens the window once it's healthy.

## Usage

1. Pick a language (or leave **Auto-detect**).
2. Drop an audio file onto the dropzone, or click **Choose file**.
3. The transcription appears at the top of the list.

## Configuration

- **Model size** — edit `WhisperModel("small")` in `python_backend/main.py`.
  Larger models (`medium`, `large-v3`) are more accurate but slower.
- **Port** — backend runs on `127.0.0.1:8000` (see `main.py` and `preload.js`).

## License

MIT
