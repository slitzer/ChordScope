# ChordScope

Guitar chord + beat analysis tool for reviewing old acoustic guitar recordings.

Built for local/self-hosted use with Docker Compose. Focused on clean acoustic guitar recordings (30s – 10 min).

## Current Status (v1)

- Uses **madmom** for chord recognition and beat tracking
- Saves analysis as `.analysis.json` right next to your audio files
- Interactive waveform + chord timeline in the browser
- Pretty guitar chord diagrams
- Designed to run on a Linux server (Debian 12 in this case)

Demucs stem separation and stronger chord models (BTC) are planned for later versions.

---

## Target Deployment (Your Setup)

- **Server**: VECNACORE (Debian 12) at `192.168.1.167`
- **Project path on server**: `/srv/ai-data/chordscope`
- **Recordings path**: `/srv/ai-data/chordscope/data/recordings`
- **Frontend port**: `4000`
- Running as `root` (for now)

---

## Getting Started

### 1. Copy the project to the server

From your Windows machine, run these commands in PowerShell:

```powershell
# 1. Create the folder structure on the server
ssh root@192.168.1.167 "mkdir -p /srv/ai-data/chordscope/data/recordings"

# 2. Copy the project (initial copy)
scp -r C:\temp\Chordscope\* root@192.168.1.167:/srv/ai-data/chordscope/
```

For future updates, use rsync (much better):

```powershell
# Recommended for repeated updates (requires Git Bash or WSL)
rsync -avz --delete -e ssh C:\temp\Chordscope\ root@192.168.1.167:/srv/ai-data/chordscope/
```

### 2. On the server – Start the stack

SSH into the server:

```bash
ssh root@192.168.1.167
cd /srv/ai-data/chordscope

# Build and start everything
docker compose up -d --build
```

### 3. Access the UI

Open your browser on Windows:

```
http://192.168.1.167:4000
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
   `/srv/ai-data/chordscope/data/recordings/`

2. In the web UI:
   - You should see your files listed
   - Click "Analyze" on a file
   - Wait for processing (madmom is fast on short acoustic files)
   - View the interactive timeline + chord diagrams

3. Analysis results are saved as `filename.analysis.json` next to the original file.

---

## Development Workflow

1. Make changes on Windows in `C:\temp\Chordscope`
2. Sync to the server using the `rsync` or `scp` command above
3. On the server:
   ```bash
   cd /srv/ai-data/chordscope
   docker compose up -d --build
   ```
4. Refresh browser at `http://192.168.1.167:4000`

---

## Ports

| Service     | Internal | External (host) |
|-------------|----------|-----------------|
| Frontend    | 3000     | 4000            |
| Analyzer    | 8000     | 8000            |

---

## Requirements on the Server

- Docker + Docker Compose
- NVIDIA drivers + NVIDIA Container Toolkit (already installed on VECNACORE)
- Enough disk space in `/srv/ai-data/`

---

## Roadmap

- v1 (current): madmom chords + beats + nice UI + .json export
- v2: Optional Demucs guitar stem separation before analysis
- v3: Stronger chord models (BTC from ChordMini)
- Later: Song structure detection, batch processing, better key estimation

---

## Troubleshooting

**Port 4000 already in use?**
Change the port in `docker-compose.yml` under the `frontend` service.

**Analysis fails?**
Check logs:
```bash
docker compose logs -f analyzer
```

**Permission issues with recordings?**
Since we're running as root for now, this is usually not a problem. We can tighten permissions later.

---

## Questions / Improvements

This tool is being built specifically for reviewing old acoustic guitar practice recordings.

If you have feedback on the UI, analysis quality, or features, let me know.
