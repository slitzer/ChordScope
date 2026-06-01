"""
ChordScope Analysis Engine (v2.2 - Improved Chord Stability)

Changes in this version:
- Stronger minimum chord duration (250ms)
- Extra pass to merge very short or similar chords
- Better handling of rapid strumming / arpeggios
"""

from pathlib import Path
import numpy as np
import warnings

try:
    import madmom
    from madmom.audio.signal import Signal
    from madmom.features.beats import DBNBeatTrackingProcessor
    from madmom.features.downbeats import DBNDownBeatTrackingProcessor
    MADMOM_AVAILABLE = True
except Exception:
    MADMOM_AVAILABLE = False

import librosa

# Chord templates
CHORD_TEMPLATES = {}
NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

def _build_templates():
    major = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    minor = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    for i, note in enumerate(NOTES):
        CHORD_TEMPLATES[f"{note}:maj"] = np.roll(major, i)
        CHORD_TEMPLATES[f"{note}:min"] = np.roll(minor, i)

_build_templates()


def _are_chords_similar(chord_a: str, chord_b: str) -> bool:
    """Simple heuristic: same root = similar enough for merging in guitar context."""
    if not chord_a or not chord_b:
        return False
    root_a = chord_a.split(':')[0]
    root_b = chord_b.split(':')[0]
    return root_a == root_b


def _smooth_chord_sequence(chords: list, min_duration: float = 0.25) -> list:
    """
    Aggressive smoothing for real guitar playing.
    - Minimum chord duration (default 250ms)
    - Merge adjacent chords with same root
    """
    if not chords:
        return []

    # Pass 1: Merge identical or very similar chords
    merged = []
    current = chords[0].copy()

    for chord in chords[1:]:
        if chord["chord"] == current["chord"] or _are_chords_similar(chord["chord"], current["chord"]):
            current["end"] = chord["end"]
        else:
            merged.append(current)
            current = chord.copy()
    merged.append(current)

    # Pass 2: Remove / merge chords shorter than min_duration
    filtered = []
    for chord in merged:
        duration = chord["end"] - chord["start"]
        if duration >= min_duration:
            filtered.append(chord)
        elif filtered:
            # Extend the previous chord
            filtered[-1]["end"] = chord["end"]
        # If no previous chord, we just drop it (very start of file)

    return filtered


def _chroma_to_chord_sequence(chroma: np.ndarray, hop_length: int, sr: int) -> list:
    chord_names = list(CHORD_TEMPLATES.keys())
    templates = np.array(list(CHORD_TEMPLATES.values()))

    templates = templates / (np.linalg.norm(templates, axis=1, keepdims=True) + 1e-8)
    chroma = chroma / (np.linalg.norm(chroma, axis=0, keepdims=True) + 1e-8)

    correlations = templates @ chroma
    best_idx = np.argmax(correlations, axis=0)
    raw_chords = [chord_names[i] for i in best_idx]

    # Strong median smoothing (7-frame window)
    window_size = 7
    smoothed = []
    for i in range(len(raw_chords)):
        start = max(0, i - window_size // 2)
        end = min(len(raw_chords), i + window_size // 2 + 1)
        window = raw_chords[start:end]
        counts = {}
        for c in window:
            counts[c] = counts.get(c, 0) + 1
        best = max(counts, key=counts.get)
        smoothed.append(best)

    # Build segments
    chords = []
    if not smoothed:
        return chords

    current_chord = smoothed[0]
    start_frame = 0

    for i in range(1, len(smoothed)):
        if smoothed[i] != current_chord:
            start_time = librosa.frames_to_time(start_frame, sr=sr, hop_length=hop_length)
            end_time = librosa.frames_to_time(i, sr=sr, hop_length=hop_length)

            if (end_time - start_time) > 0.08:
                root, quality = current_chord.split(':')
                chords.append({
                    "start": round(float(start_time), 3),
                    "end": round(float(end_time), 3),
                    "chord": current_chord,
                    "root": root,
                    "quality": quality
                })
            current_chord = smoothed[i]
            start_frame = i

    # Final segment
    start_time = librosa.frames_to_time(start_frame, sr=sr, hop_length=hop_length)
    end_time = librosa.frames_to_time(len(smoothed), sr=sr, hop_length=hop_length)
    if (end_time - start_time) > 0.08:
        root, quality = current_chord.split(':')
        chords.append({
            "start": round(float(start_time), 3),
            "end": round(float(end_time), 3),
            "chord": current_chord,
            "root": root,
            "quality": quality
        })

    # Final aggressive cleanup with 250ms minimum
    return _smooth_chord_sequence(chords, min_duration=0.25)


def analyze_file(audio_path: str) -> dict:
    audio_path = Path(audio_path)
    print(f"🎵 Analyzing: {audio_path.name}")

    try:
        y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
        duration = float(len(y) / sr)

        if duration < 1.0:
            return _empty_result(duration, "File too short")

        hop_length = 512
        chroma = librosa.feature.chroma_cqt(
            y=y, sr=sr, hop_length=hop_length, n_chroma=12, n_octaves=7
        )

        chords = _chroma_to_chord_sequence(chroma, hop_length, sr)

        # === Beat tracking ===
        beats = []
        downbeats = []
        bpm = 0.0

        if MADMOM_AVAILABLE:
            try:
                sig = Signal(str(audio_path), sample_rate=44100, num_channels=1)
                beat_proc = DBNBeatTrackingProcessor(fps=100)
                downbeat_proc = DBNDownBeatTrackingProcessor(beats_per_bar=[3, 4], fps=100)

                beats = [float(b) for b in beat_proc(sig)]
                downbeats = [float(d) for d in downbeat_proc(sig)]

                if len(beats) > 1:
                    bpm = round(float(60.0 / np.median(np.diff(beats))), 1)
            except Exception as e:
                print(f"  Madmom beat tracking failed, falling back: {e}")

        if not beats:
            try:
                tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, hop_length=hop_length)
                beats = librosa.frames_to_time(beat_frames, sr=sr, hop_length=hop_length).tolist()
                bpm = round(float(tempo), 1)
                downbeats = beats[::4] if len(beats) > 4 else beats[:1]
            except Exception as e:
                print(f"  Librosa beat tracking also failed: {e}")

        key = _estimate_key_simple(chroma)

        result = {
            "duration": round(duration, 2),
            "bpm": bpm,
            "key": key,
            "chords": chords,
            "beats": [round(b, 3) for b in beats],
            "downbeats": [round(d, 3) for d in downbeats],
        }

        print(f"✅ Done: {len(chords)} chords, BPM={bpm}, Key={key}")
        return result

    except Exception as e:
        print(f"❌ Analysis failed: {e}")
        return _empty_result(0.0, str(e))


def _estimate_key_simple(chroma: np.ndarray) -> str:
    avg = np.mean(chroma, axis=1)
    key_idx = int(np.argmax(avg))
    return NOTES[key_idx]


def _empty_result(duration: float, error_msg: str) -> dict:
    return {
        "duration": round(duration, 2),
        "bpm": 0.0,
        "key": "Unknown",
        "chords": [],
        "beats": [],
        "downbeats": [],
        "error": error_msg
    }
