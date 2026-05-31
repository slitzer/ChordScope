from fastapi import FastAPI, HTTPException, BackgroundTasks, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from pathlib import Path
import os
import json
from datetime import datetime
import shutil

from analysis.madmom_engine import analyze_file

app = FastAPI(title="ChordScope Analyzer", version="0.1.0")

# CORS - allow frontend during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

RECORDINGS_PATH = Path(os.getenv("RECORDINGS_PATH", "/app/data/recordings"))

class AnalysisRequest(BaseModel):
    filename: str

class AnalysisResponse(BaseModel):
    success: bool
    message: str
    analysis_file: str | None = None

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "chordscope-analyzer",
        "recordings_path": str(RECORDINGS_PATH)
    }

@app.get("/files")
async def list_files():
    """List audio files in the recordings directory."""
    if not RECORDINGS_PATH.exists():
        return {"files": []}

    audio_extensions = {".mp3", ".wav", ".flac", ".m4a", ".ogg"}
    files = []

    for f in RECORDINGS_PATH.iterdir():
        if f.is_file() and f.suffix.lower() in audio_extensions:
            analysis_file = f.with_suffix(f.suffix + ".analysis.json")
            files.append({
                "filename": f.name,
                "size_mb": round(f.stat().st_size / (1024 * 1024), 2),
                "has_analysis": analysis_file.exists(),
                "analysis_file": analysis_file.name if analysis_file.exists() else None
            })

    # Sort newest first
    files.sort(key=lambda x: x["filename"], reverse=True)
    return {"files": files}

@app.post("/analyze", response_model=AnalysisResponse)
async def analyze(request: AnalysisRequest, background_tasks: BackgroundTasks):
    """
    Trigger analysis on a file.
    Analysis runs in the background and writes <filename>.analysis.json next to the audio.
    """
    audio_path = RECORDINGS_PATH / request.filename

    if not audio_path.exists():
        raise HTTPException(status_code=404, detail=f"File not found: {request.filename}")

    analysis_path = audio_path.with_suffix(audio_path.suffix + ".analysis.json")

    # Run analysis in background
    background_tasks.add_task(
        run_analysis_task,
        str(audio_path),
        str(analysis_path)
    )

    return AnalysisResponse(
        success=True,
        message=f"Analysis started for {request.filename}",
        analysis_file=analysis_path.name
    )

def run_analysis_task(audio_path: str, analysis_path: str):
    """Background task that performs the actual analysis."""
    try:
        result = analyze_file(audio_path)

        result["processed_at"] = datetime.utcnow().isoformat() + "Z"
        result["original_file"] = Path(audio_path).name

        with open(analysis_path, "w") as f:
            json.dump(result, f, indent=2)

        print(f"✅ Analysis complete: {analysis_path}")

    except Exception as e:
        error_result = {
            "error": str(e),
            "original_file": Path(audio_path).name,
            "processed_at": datetime.utcnow().isoformat() + "Z"
        }
        with open(analysis_path, "w") as f:
            json.dump(error_result, f, indent=2)
        print(f"❌ Analysis failed for {audio_path}: {e}")

@app.get("/analysis/{filename}")
async def get_analysis(filename: str):
    """Return existing analysis JSON if available."""
    # Handle both "file.mp3" and "file.mp3.analysis.json"
    if filename.endswith(".analysis.json"):
        analysis_path = RECORDINGS_PATH / filename
    else:
        base = Path(filename)
        analysis_path = RECORDINGS_PATH / (base.stem + base.suffix + ".analysis.json")

    if not analysis_path.exists():
        raise HTTPException(status_code=404, detail="Analysis not found")

    with open(analysis_path) as f:
        return json.load(f)


@app.get("/audio/{filename}")
async def get_audio(filename: str):
    """Stream audio file for playback + waveform."""
    audio_path = RECORDINGS_PATH / filename
    if not audio_path.exists():
        raise HTTPException(status_code=404, detail="Audio file not found")

    # Basic content type detection
    suffix = audio_path.suffix.lower()
    media_type = "audio/wav" if suffix == ".wav" else "audio/mpeg"
    
    return FileResponse(
        path=str(audio_path),
        media_type=media_type,
        filename=filename
    )


AUDIO_EXTENSIONS = {".mp3", ".wav", ".flac", ".m4a", ".ogg", ".wma"}

@app.post("/upload")
async def upload_audio(file: UploadFile = File(...)):
    """Upload an audio file directly from the web UI."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No filename provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in AUDIO_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Unsupported file type: {suffix}")

    # Sanitize filename
    safe_name = "".join(c for c in file.filename if c.isalnum() or c in "._- ").strip()
    if not safe_name:
        safe_name = f"upload_{datetime.utcnow().strftime('%Y%m%d_%H%M%S')}{suffix}"

    dest_path = RECORDINGS_PATH / safe_name

    counter = 1
    original_stem = Path(safe_name).stem
    while dest_path.exists():
        dest_path = RECORDINGS_PATH / f"{original_stem}_{counter}{suffix}"
        counter += 1

    try:
        with open(dest_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save file: {str(e)}")
    finally:
        file.file.close()

    return {
        "success": True,
        "filename": dest_path.name,
        "message": f"Uploaded {dest_path.name}"
    }


@app.delete("/files/{filename}")
async def delete_file(filename: str):
    """Delete an audio file and its analysis JSON."""
    audio_path = RECORDINGS_PATH / filename
    analysis_path = audio_path.with_suffix(audio_path.suffix + ".analysis.json")

    deleted = False
    if audio_path.exists():
        audio_path.unlink()
        deleted = True
    if analysis_path.exists():
        analysis_path.unlink()
        deleted = True

    if not deleted:
        raise HTTPException(status_code=404, detail="File not found")

    return {"success": True, "message": f"Deleted {filename}"}


# Very basic key → common chords map (expandable later)
KEY_CHORDS = {
    "C": ["C", "Dm", "Em", "F", "G", "Am"],
    "G": ["G", "Am", "Bm", "C", "D", "Em"],
    "D": ["D", "Em", "F#m", "G", "A", "Bm"],
    "A": ["A", "Bm", "C#m", "D", "E", "F#m"],
    "E": ["E", "F#m", "G#m", "A", "B", "C#m"],
    "F": ["F", "Gm", "Am", "Bb", "C", "Dm"],
}

@app.get("/key-chords/{key}")
async def get_key_chords(key: str):
    """Return common chords for a given key (simplified)."""
    key_clean = key.split(":")[0].strip().upper()  # handle "A:maj" etc.
    chords = KEY_CHORDS.get(key_clean, ["I", "IV", "V", "vi"])
    return {"key": key, "chords": chords}
