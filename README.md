# ChordScope

**ChordScope** is a beautiful, local-first guitar practice tool. Drop in your acoustic (or electric) recordings and instantly get accurate chord detection, timing, key, BPM, plus a premium play-along mode with waveform scrubbing, big chord display, editable notes, and a built-in tuner.

Perfect for learning songs by ear, transcribing, or just understanding what you are actually playing.

**v1.0** — Stable self-hostable release.

## Features

- **Drag & drop or upload** any guitar recording (WAV, MP3, M4A, etc.)
- **Accurate chord + timing detection** (Librosa CQT + heavy smoothing, beat tracking)
- **Premium Play Mode**:
  - Scrubbable WaveSurfer waveform
  - Large current chord display that follows playback
  - Speed and volume controls
  - Full-screen beautiful guitar artwork
- **Per-song notes** saved as plain `.notes.txt` sidecar files (portable, editable in any text editor)
- **"Chords in the Key of X"** quick reference panel (real chord names)
- **Built-in Tuner** — Note mode + experimental Chord detection mode
- **10 Guitar Genre Themes** (Acoustic, Metal, Rock, Pop, Jazz, Blues, Folk, Punk, Country, Classical) with dedicated high-quality artwork + full-page subtle background atmosphere layer, matching accent colors, font personality, and themed surfaces throughout the UI. Theme choice is remembered per browser via localStorage.

All data is stored as simple files next to your audio — no proprietary database, easy to backup or move.

## Quick Start (Docker Compose)

1. Clone the repository:
   ```bash
   git clone https://github.com/YOUR_USERNAME/chordscope.git
   cd chordscope
   ```

2. **Important first step** — Edit `docker-compose.yml` and set the correct analyzer URL for your setup:
   ```yaml
   # In the frontend build args section:
   - NEXT_PUBLIC_ANALYZER_URL=http://localhost:8000     # most people
   ```

3. Start everything:
   ```bash
   docker compose up -d --build
   ```

4. Open http://localhost:4000

Your audio files + analysis data live in `./data/recordings` on the host (safe, portable, no database).

## Self-Hosting & Reverse Proxy (External Access)

ChordScope is designed to be run locally or behind a reverse proxy.

### Local Only (Simplest)
Just use the Quick Start above. Everything stays on http://localhost.

### External Access via Nginx Proxy Manager (or Caddy / Traefik)

Example NPM setup (what the original developer uses successfully):

1. Create a new Proxy Host pointing to your server IP.
2. In the Advanced tab, add this custom location block:

```nginx
location /analyzer/ {
    proxy_pass http://127.0.0.1:8000/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
}
```

3. In `docker-compose.yml` change the build arg to:
   ```yaml
   - NEXT_PUBLIC_ANALYZER_URL=/analyzer
   ```

4. Rebuild: `docker compose up -d --build --force-recreate`

Now everything (frontend + analyzer API) is served over the same HTTPS domain and port. No CORS issues.

## Guitar Genre Themes (New in v1)

Click the theme selector in the header to instantly switch between 10 real guitar-inspired visual themes:

- **Acoustic** – Warm spruce/mahogany woods
- **Metal** – Black, aggressive, high-contrast
- **Rock** – Classic sunburst energy
- **Pop** – Clean modern bright
- **Jazz** – Elegant archtop sophistication
- **Blues** – Relic tele soul
- **Folk** – Organic natural light
- **Punk** – Raw stickered attitude
- **Country** – Golden hour rustic
- **Classical** – Refined nylon-string elegance

Each theme now delivers a much deeper experience:

- **Full-page subtle artwork layer** — the chosen guitar photo sits behind the entire UI at very low opacity with a dark veil (gives real "I'm in Acoustic mode" or "Metal session" atmosphere without ever hurting readability).
- Large dedicated artwork in Play mode (click to cycle).
- Accent color used on logos, Play button, file row accents, speed buttons, etc.
- Different card/panel/input surface colors per genre family (warmer woods for Acoustic/Country, near-black for Metal/Punk, etc.).
- Font personality (elegant serif for Jazz/Classical/Folk/Acoustic, crisp sans for Rock/Metal/Pop).
- Themed header treatment, waveform container, notes area, chord timeline, and tuner panel.
- Everything persists per-browser via localStorage.

**Future theme work** (still planned): even stronger full-bleed backgrounds on certain themes, theme-specific subtle patterns/fret lines, more dynamic control states, and possibly per-theme analysis visualization tweaks. New genre artwork or CSS ideas are very welcome!

## Project Structure

```
chordscope/
├── docker-compose.yml
├── frontend/               # Next.js 14 (standalone build)
│   └── public/themes/      # Guitar genre artwork (10 high-res photos)
├── analyzer/               # FastAPI + Python (librosa engine)
│   └── analysis/madmom_engine.py   # (stable librosa-based chord engine in v1)
├── data/recordings/        # ← Your audio + sidecar files live here
│   ├── MySong.mp3
│   ├── MySong.analysis.json
│   └── MySong.notes.txt
└── README.md
```

## How Data Works (Sidecar Files)

Everything is plain files — zero lock-in:

- `your-recording.mp3` — your original audio (never modified)
- `your-recording.analysis.json` — chords, beats, BPM, key, duration (generated)
- `your-recording.notes.txt` — your personal notes (plain text, editable anywhere)

Delete the sidecars and ChordScope will happily re-analyze. Perfect for git, Syncthing, or Dropbox.

## Analysis Engine (v1)

- Primary: Librosa CQT chroma + template matching + aggressive median smoothing + min-duration filtering
- Beat tracking: Librosa (madmom was used early but replaced for stability and lower resource use on CPU-only hosts)
- Key detection: Simple chroma correlation
- Works great on clean acoustic recordings. Electric/distorted/heavily compressed material will be less accurate (expected for v1).

The first analysis of a file can take 3–12 seconds depending on length and host CPU. Subsequent loads are instant (reads the cached `.analysis.json`).

## Troubleshooting

**"Analyzer not reachable"**
- Make sure both containers are running: `docker compose ps`
- Check the `NEXT_PUBLIC_ANALYZER_URL` value you set at build time (it is baked in)
- For LAN access from another device, use the server actual LAN IP (not localhost) and rebuild frontend

**Images / artwork not showing in Play mode**
- Rebuild with `--no-cache` once: `docker compose build --no-cache frontend`
- Confirm the jpgs exist in `frontend/public/themes/` before building

**Reverse proxy 502 or "host not found"**
- Use `127.0.0.1:8000` inside the proxy config (not the container name)
- Path must end with trailing slash in `proxy_pass`

**Slow analysis or high memory**
- v1 uses a lightweight librosa pipeline. Works fine on a modest NUC / mini PC. GPU not required.

## Development

Frontend (Next.js):
```bash
cd frontend
npm install
npm run dev
```

Analyzer (FastAPI):
```bash
cd analyzer
python -m venv .venv
source .venv/bin/activate   # or .venv\Scripts\activate on Windows
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Then set `NEXT_PUBLIC_ANALYZER_URL=http://localhost:8000` in a `.env.local` or directly in the dev frontend.

## Roadmap / Future Work

- Deeper genre theme system (background imagery on main UI, more dynamic styling)
- Optional PDF export of chord charts + notes
- Better support for distorted electric / metal rhythm analysis
- Mobile-friendly Play mode refinements
- Import from YouTube / Bandcamp (with consent)

PRs and theme artwork contributions especially encouraged!

## Contributing

Issues, PRs, and theme suggestions are very welcome. Please open an issue first for larger changes.

## License

MIT License

## Acknowledgements

- Next.js + WaveSurfer.js (beautiful frontend)
- Librosa (core analysis)
- FastAPI + Uvicorn
- The original developer built this for personal use then open-sourced it so other guitarists could self-host.

---

**Made with ❤️ for guitarists who want to understand what they are actually playing.**
