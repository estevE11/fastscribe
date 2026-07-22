"""FastScribe backend: FastAPI + faster-whisper local transcription server."""

import json
import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from faster_whisper import WhisperModel

ALLOWED_EXTENSIONS = {".mp3", ".wav", ".m4a", ".opus"}

# Languages offered in the UI selector. "auto" lets Whisper detect it.
SUPPORTED_LANGUAGES = {
    "auto", "es", "en", "fr", "de", "it", "pt", "ca", "nl", "ru", "ja", "zh", "ko",
}

app = FastAPI(title="FastScribe", version="1.0.0")

# Allow the Electron renderer (file:// origin) to call the API.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Auto-detect device/compute type, fall back to a CPU-friendly default.
# Loaded once at import time so the model stays warm across requests.
try:
    model = WhisperModel("small", device="auto", compute_type="int8")
except Exception:
    model = WhisperModel("small", device="cpu", compute_type="int8")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form("auto"),
):
    filename = file.filename or "audio"
    ext = os.path.splitext(filename)[1].lower()

    language = (language or "auto").lower()
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported language '{language}'.",
        )
    # None tells faster-whisper to auto-detect the spoken language.
    lang_arg = None if language == "auto" else language

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {sorted(ALLOWED_EXTENSIONS)}",
        )

    # Read the upload while we're still in the async request context.
    content = await file.read()

    def stream():
        """Yield newline-delimited JSON progress events as segments decode."""
        tmp_path = None
        try:
            with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
                tmp_path = tmp.name
                tmp.write(content)

            segments, info = model.transcribe(
                tmp_path,
                language=lang_arg,
                beam_size=5,
                # VAD strips silent regions that make Whisper hallucinate
                # phantom phrases (e.g. "감사합니다", "Thank you").
                vad_filter=True,
            )

            # info.duration is the audio length; each segment.end is its position
            # on that timeline, so end / duration is real progress.
            duration = info.duration or 0
            parts = []
            for segment in segments:
                parts.append(segment.text.strip())
                progress = min(segment.end / duration, 0.999) if duration else 0.0
                yield json.dumps({
                    "type": "progress",
                    "progress": progress,
                    "text": " ".join(parts).strip(),
                }) + "\n"

            yield json.dumps({
                "type": "done",
                "progress": 1.0,
                "filename": filename,
                "transcript": " ".join(parts).strip(),
                "language": info.language,
            }) + "\n"
        except Exception as exc:
            yield json.dumps({
                "type": "error",
                "detail": f"Transcription failed: {exc}",
            }) + "\n"
        finally:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)

    return StreamingResponse(stream(), media_type="application/x-ndjson")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
