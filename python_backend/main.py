"""FastScribe backend: FastAPI + faster-whisper local transcription server."""

import os
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
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

    tmp_path = None
    try:
        # Persist the upload to a temp file so faster-whisper can read from disk.
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            tmp_path = tmp.name
            content = await file.read()
            tmp.write(content)

        segments, info = model.transcribe(
            tmp_path,
            language=lang_arg,
            beam_size=5,
            # VAD strips silent regions that make Whisper hallucinate
            # phantom phrases (e.g. "감사합니다", "Thank you").
            vad_filter=True,
        )
        transcript = " ".join(segment.text.strip() for segment in segments).strip()

        return {
            "filename": filename,
            "transcript": transcript,
            "language": info.language,
        }
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}")
    finally:
        # Always clean up the temporary audio file.
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8000)
