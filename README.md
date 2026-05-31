# ChordScope

Guitar chord + beat analysis tool for reviewing guitar recordings.

Built for local/self-hosted use with Docker Compose. Focused on clean acoustic guitar recordings (30s – 10 min).

## Current Status (v1)

- Uses **madmom** for chord recognition and beat tracking
- Saves analysis as `.analysis.json` right next to your audio files
- Interactive waveform + chord timeline in the browser
- Pretty guitar chord diagrams
- Designed to run on a Linux server (Debian 12 in this case)

Demucs stem separation and stronger chord models (BTC) are planned for later versions.


---

## Getting Started



### Access the UI

Open your browser on:

```
http://YOURIP:4000
```

---

## Folder Structure (Important)

```
chordscope/
├── docker-compose.yml
├── analyzer/               # FastAPI backend (madmom analysis)
├── frontend/               # Next.js UI
├── data/
│   └── recordings/         # ← Put your audio files here
│       ├── my_take_01.mp3
│       └── my_take_01.analysis.json   # Generated automatically
└── README.md
```

All your audio files + analysis results live together in `data/recordings/`.

---

## How to Use (Once Running)

1. Drop your acoustic guitar recordings into:
   `/data/chordscope/data/recordings/`

2. In the web UI:
   - You should see your files listed
   - Click "Analyze" on a file
   - Wait for processing (madmom is fast on short acoustic files)
   - View the interactive timeline + chord diagrams

3. Analysis results are saved as `filename.analysis.json` next to the original file.

---


## Ports

| Service     | Internal | External (host) |
|-------------|----------|-----------------|
| Frontend    | 3000     | 4000            |
| Analyzer    | 8000     | 8000            |

---

## Requirements on the Server

- Docker + Docker Compose
- Enough disk space in `/data/`

---

## Roadmap

- v1 (current): madmom chords + beats + nice UI + .json export
- v2: Optional Demucs guitar stem separation before analysis
- v3: Stronger chord models (BTC from ChordMini)
- Later: Song structure detection, batch processing, better key estimation

---

## Troubleshooting

**Analysis fails?**
Check logs:
```bash
docker compose logs -f analyzer
```

---

## Questions / Improvements

This tool is being built specifically for reviewing  guitar practice recordings.

If you have feedback on the UI, analysis quality, or features, let me know.
