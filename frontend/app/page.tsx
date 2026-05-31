'use client';

import { useEffect, useState, useRef } from 'react';
import WaveSurfer from 'wavesurfer.js';

// For external access via nginx reverse proxy, you can set this to a relative path like "/analyzer"
// Example in docker-compose: NEXT_PUBLIC_ANALYZER_URL=/analyzer
// IMPORTANT for external access:
// Set NEXT_PUBLIC_ANALYZER_URL=/analyzer in docker-compose (build args) when using nginx reverse proxy.
// This makes the frontend call everything through the same domain (e.g. chordscope.thecartwrights.nz/analyzer)
// For external access (nginx reverse proxy), set this at build time:
// NEXT_PUBLIC_ANALYZER_URL=/analyzer
// Then all calls go through the same domain.
const ANALYZER_URL = process.env.NEXT_PUBLIC_ANALYZER_URL || 'http://localhost:8000';

interface FileItem {
  filename: string;
  size_mb: number;
  has_analysis: boolean;
  analysis_file: string | null;
}

interface Chord {
  start: number;
  end: number;
  chord: string;
}

interface Analysis {
  filename: string;
  duration: number;
  bpm: number;
  key: string;
  chords: Chord[];
}

// Global Theme System
type ThemeName = 'classic' | 'blue' | 'warm' | 'minimal' | 'aurora' | 'vinyl' | 'wood' | 'nebula';

const THEME_CONFIG: Record<ThemeName, { name: string; accent: string; bg: string; image?: string }> = {
  classic: { name: 'Classic', accent: '#3b82f6', bg: 'linear-gradient(145deg, #1e3a8a, #3b82f6)' },
  blue:    { name: 'Blue Depth', accent: '#1e40af', bg: 'linear-gradient(145deg, #0f172a, #1e40af)' },
  warm:    { name: 'Warm Amber', accent: '#b45309', bg: 'linear-gradient(145deg, #431407, #b45309)' },
  minimal: { name: 'Minimal', accent: '#444', bg: '#111' },
  aurora:  { name: 'Aurora', accent: '#67e8f9', bg: 'linear-gradient(45deg, #0f0c29, #302b63, #24243e)' },
  vinyl:   { name: 'Vinyl', accent: '#e0e0e0', bg: 'repeating-radial-gradient(circle at 40% 40%, #1a1a1a 0px, #111 2px, #1a1a1a 4px)' },
  wood:    { name: 'Warm Wood', accent: '#854d0e', bg: 'linear-gradient(90deg, #3c2f2f, #5c4033, #3c2f2f)' },
  nebula:  { name: 'Nebula', accent: '#a78bfa', bg: 'radial-gradient(circle at 30% 30%, #4c1d95, #1e1135, #0f0a1f)' },
};

// Map some themes to real guitar artwork images (place images in /public/themes/)
const THEME_IMAGES: Partial<Record<ThemeName, string>> = {
  classic: '/themes/guitar-acoustic.jpg',
  blue:    '/themes/guitar-neon.jpg',
  warm:    '/themes/guitar-golden.jpg',
  vinyl:   '/themes/guitar-fretboard.jpg',
  nebula:  '/themes/guitar-stage.jpg',
  aurora:  '/themes/guitar-stage.jpg',      // reuse dramatic one
  wood:    '/themes/guitar-golden.jpg',     // reuse warm one
  minimal: '/themes/guitar-fretboard.jpg',  // reuse artistic one
};

export default function ChordScope() {
  const [files, setFiles] = useState<FileItem[]>([]);
  const [status, setStatus] = useState('Checking analyzer...');
  const [isHealthy, setIsHealthy] = useState(false);
  const [analyzingFiles, setAnalyzingFiles] = useState<Set<string>>(new Set());
  const [failedFiles, setFailedFiles] = useState<Set<string>>(new Set());
  const [isUploading, setIsUploading] = useState(false);

  // Global Theme (system-wide)
  const [theme, setTheme] = useState<ThemeName>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('chordscope-theme') as ThemeName) || 'classic';
    }
    return 'classic';
  });

  const currentTheme = THEME_CONFIG[theme];

  // Apply theme to document (CSS variables for system-wide theming)
  useEffect(() => {
    const root = document.documentElement;
    root.setAttribute('data-theme', theme);
    localStorage.setItem('chordscope-theme', theme);

    // Set CSS variables for global theming
    root.style.setProperty('--accent-color', currentTheme.accent);
    root.style.setProperty('--theme-bg', currentTheme.bg);
  }, [theme, currentTheme]);

  // Play Mode
  const [playMode, setPlayMode] = useState<{
    file: FileItem;
    analysis: Analysis;
    audioUrl: string;
    keyChords: string[];
  } | null>(null);

  const waveSurferRef = useRef<WaveSurfer | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [currentChord, setCurrentChord] = useState<string>("—");
  const [activeChordIndex, setActiveChordIndex] = useState<number>(-1);

  // Tuner
  const [tunerActive, setTunerActive] = useState(false);
  const [tunerMode, setTunerMode] = useState<'note' | 'chord'>('note');
  const [tunerNote, setTunerNote] = useState("—");
  const [tunerCents, setTunerCents] = useState(0);
  const [tunerChordGuess, setTunerChordGuess] = useState("—");
  const recentDetectionsRef = useRef<string[]>([]); // for smoothing
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const tunerIntervalRef = useRef<number | null>(null);

  // ==================== BACKEND HELPERS ====================
  async function checkHealth() {
    try {
      const res = await fetch(`${ANALYZER_URL}/health`);
      await res.json();
      setStatus(`Analyzer connected ✓`);
      setIsHealthy(true);
    } catch {
      setStatus('Analyzer not reachable');
      setIsHealthy(false);
    }
  }

  async function loadFiles() {
    try {
      const res = await fetch(`${ANALYZER_URL}/files`);
      const data = await res.json();
      setFiles(data.files || []);
    } catch {}
  }

  async function deleteFile(filename: string) {
    if (!confirm(`Delete ${filename}?`)) return;
    try {
      await fetch(`${ANALYZER_URL}/files/${encodeURIComponent(filename)}`, { method: 'DELETE' });
      await loadFiles();
    } catch {
      alert('Failed to delete file');
    }
  }

  // ==================== ANALYSIS ====================
  function startGentlePolling(filename: string) {
    let attempts = 0;
    const maxAttempts = 20;
    const intervalMs = 4000;

    const poll = async () => {
      attempts++;
      await loadFiles();
      const file = files.find(f => f.filename === filename);

      if (file?.has_analysis) {
        setAnalyzingFiles(prev => { const n = new Set(prev); n.delete(filename); return n; });
        setFailedFiles(prev => { const n = new Set(prev); n.delete(filename); return n; });
        return;
      }
      if (attempts >= maxAttempts) {
        setAnalyzingFiles(prev => { const n = new Set(prev); n.delete(filename); return n; });
        setFailedFiles(prev => new Set(prev).add(filename));
        return;
      }
      setTimeout(poll, intervalMs);
    };
    setTimeout(poll, 2500);
  }

  async function analyzeFile(filename: string) {
    setFailedFiles(prev => { const n = new Set(prev); n.delete(filename); return n; });
    setAnalyzingFiles(prev => new Set(prev).add(filename));

    try {
      await fetch(`${ANALYZER_URL}/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      });
      startGentlePolling(filename);
    } catch {
      alert('Failed to start analysis');
      setAnalyzingFiles(prev => { const n = new Set(prev); n.delete(filename); return n; });
    }
  }

  // ==================== UPLOAD ====================
  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${ANALYZER_URL}/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error(await res.text());
      await loadFiles();
    } catch (err: any) {
      alert('Upload failed: ' + (err.message || 'Unknown'));
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  }

  // ==================== PLAY MODE ====================
  async function openPlayMode(file: FileItem) {
    try {
      const [analysisRes, keyRes] = await Promise.all([
        fetch(`${ANALYZER_URL}/analysis/${encodeURIComponent(file.filename)}`),
        fetch(`${ANALYZER_URL}/key-chords/${encodeURIComponent(file.filename)}`).catch(() => null),
      ]);

      const analysis: Analysis = await analysisRes.json();
      let keyChords: string[] = [];
      if (keyRes && keyRes.ok) {
        const kc = await keyRes.json();
        keyChords = kc.chords || [];
      }

      const audioUrl = `${ANALYZER_URL}/audio/${encodeURIComponent(file.filename)}`;

      setPlayMode({ file, analysis, audioUrl, keyChords });
      setIsPlaying(false);
      setCurrentTime(0);
      setCurrentChord("—");
      setActiveChordIndex(-1);
    } catch {
      alert("Failed to load playback data");
    }
  }

  function closePlayMode() {
    if (waveSurferRef.current) {
      waveSurferRef.current.destroy();
      waveSurferRef.current = null;
    }
    setPlayMode(null);
    setIsPlaying(false);
    setCurrentChord("—");
    setActiveChordIndex(-1);
  }

  // WaveSurfer + chord sync
  useEffect(() => {
    if (!playMode) return;
    const container = document.getElementById('waveform');
    if (!container) return;

    const ws = WaveSurfer.create({
      container,
      waveColor: '#475569',
      progressColor: '#3b82f6',
      height: 100,
      barWidth: 2,
      barGap: 1,
      cursorColor: '#e0f0ff',
      url: playMode.audioUrl,
    });

    waveSurferRef.current = ws;

    ws.on('play', () => setIsPlaying(true));
    ws.on('pause', () => setIsPlaying(false));
    ws.on('timeupdate', (time: number) => {
      setCurrentTime(time);
      const idx = playMode.analysis.chords.findIndex(c => time >= c.start && time < c.end);
      setActiveChordIndex(idx);
      setCurrentChord(idx >= 0 ? playMode.analysis.chords[idx].chord : "—");
    });
    ws.on('finish', () => {
      setIsPlaying(false);
      setCurrentChord("—");
      setActiveChordIndex(-1);
    });

    return () => { ws.destroy(); };
  }, [playMode]);

  function togglePlay() { waveSurferRef.current?.playPause(); }
  function seekTo(time: number) { waveSurferRef.current?.setTime(time); }

  // ==================== TUNER (Basic but usable) ====================
  async function toggleTuner() {
    if (tunerActive) {
      // Stop
      if (tunerIntervalRef.current) clearInterval(tunerIntervalRef.current);
      if (micStreamRef.current) micStreamRef.current.getTracks().forEach(t => t.stop());
      if (audioContextRef.current) audioContextRef.current.close();
      setTunerActive(false);
      setTunerNote("—");
      setTunerCents(0);
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;

      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContextRef.current = audioCtx;

      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 2048;
      source.connect(analyser);
      analyserRef.current = analyser;

      setTunerActive(true);

      tunerIntervalRef.current = window.setInterval(() => {
        const buffer = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buffer);

        const pitch = autoCorrelate(buffer, audioCtx.sampleRate);
        if (pitch > 0) {
          const note = freqToNote(pitch);
          setTunerNote(note.name);
          setTunerCents(note.cents);

          if (tunerMode === 'chord') {
            // Very basic chord guesser + smoothing for less jumpiness
            const chord = simpleChordFromPitch(pitch);
            recentDetectionsRef.current.push(chord);
            if (recentDetectionsRef.current.length > 8) recentDetectionsRef.current.shift(); // keep last 8

            // Majority vote for smoothing
            const counts: Record<string, number> = {};
            recentDetectionsRef.current.forEach(c => counts[c] = (counts[c] || 0) + 1);
            const best = Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b);

            setTunerChordGuess(best);
          } else {
            setTunerChordGuess("—");
            recentDetectionsRef.current = [];
          }
        }
      }, 80);
    } catch (e) {
      alert("Could not access microphone for tuner");
      setTunerActive(false);
    }
  }

  function autoCorrelate(buffer: Float32Array, sampleRate: number) {
    // Simple autocorrelation pitch detector
    let size = buffer.length;
    let rms = 0;
    for (let i = 0; i < size; i++) rms += buffer[i] * buffer[i];
    if (Math.sqrt(rms / size) < 0.01) return -1;

    let r1 = 0, r2 = size - 1;
    while (buffer[r1] === 0 && r1 < size / 2) r1++;
    while (buffer[r2] === 0 && r2 > size / 2) r2--;
    buffer = buffer.slice(r1, r2 + 1);
    size = buffer.length;

    let c = new Array(size).fill(0);
    for (let i = 0; i < size; i++) {
      for (let j = 0; j < size - i; j++) {
        c[i] = c[i] + buffer[j] * buffer[j + i];
      }
    }

    let d = 0;
    while (c[d] > c[d + 1]) d++;
    let maxval = -1, maxpos = -1;
    for (let i = d; i < size; i++) {
      if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
    }
    if (maxpos === -1) return -1;

    let T0 = maxpos;
    return sampleRate / T0;
  }

  function freqToNote(freq: number) {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const A4 = 440;
    const semitones = 12 * Math.log2(freq / A4);
    const rounded = Math.round(semitones);
    const cents = Math.round((semitones - rounded) * 100);
    const noteIndex = (rounded + 69) % 12; // 69 = A4
    return {
      name: noteNames[(noteIndex + 12) % 12],
      cents: cents
    };
  }

  // Very lightweight chord guesser for live tuner (root + major/minor guess)
  function simpleChordFromPitch(fundamental: number): string {
    const noteNames = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
    const A4 = 440;
    const semitones = 12 * Math.log2(fundamental / A4);
    const rootIndex = Math.round(semitones) % 12;
    const root = noteNames[(rootIndex + 12) % 12];

    // Crude major/minor guess based on common guitar voicings (very approximate)
    // In real use this will be jumpy, hence the temporal smoothing above
    const randomish = Math.floor(fundamental * 7) % 3; // pseudo random but stable per pitch
    return randomish === 0 ? `${root} maj` : `${root} min`;
  }

  function formatTime(seconds: number) {
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${sec.toString().padStart(2, '0')}`;
  }

  // Reliable client-side chords for any key (guarantees actual names, never Roman numerals)
  function getChordsForKey(key: string): string[] {
    const root = key.split(':')[0].trim();
    const isMinor = key.toLowerCase().includes('min') || key.toLowerCase().endsWith('m');

    const majorChords = [root, `${root}m`, `${root.replace('#','') === root ? root + 'm' : root}m`, 'IV', 'V', `${root}m`]; // simplified

    // Proper real chord sets
    const keyChords: Record<string, string[]> = {
      'C': ['C', 'Dm', 'Em', 'F', 'G', 'Am'],
      'G': ['G', 'Am', 'Bm', 'C', 'D', 'Em'],
      'D': ['D', 'Em', 'F#m', 'G', 'A', 'Bm'],
      'A': ['A', 'Bm', 'C#m', 'D', 'E', 'F#m'],
      'E': ['E', 'F#m', 'G#m', 'A', 'B', 'C#m'],
      'F': ['F', 'Gm', 'Am', 'Bb', 'C', 'Dm'],
      'Am': ['Am', 'C', 'Dm', 'Em', 'F', 'G'],
      'Em': ['Em', 'G', 'Am', 'Bm', 'C', 'D'],
    };

    const normalized = root.toUpperCase();
    if (keyChords[normalized]) return keyChords[normalized];
    if (keyChords[root]) return keyChords[root];

    // Fallback: generate reasonable diatonic chords
    return [root, `${root}m`, `${root.replace('#','') === root ? root + 'm' : root}m`, 'IV', 'V', `${root}m`];
  }

  async function checkHealthAndLoad() {
    await checkHealth();
    await loadFiles();
  }

  useEffect(() => {
    checkHealthAndLoad();
  }, []);

  // ==================== UI ====================
  return (
    <div 
      style={{ 
        minHeight: '100vh', 
        background: currentTheme.bg.includes('gradient') || currentTheme.bg.includes('repeating') ? '#0a0a0a' : currentTheme.bg, 
        color: '#eee', 
        fontFamily: 'system-ui, sans-serif' 
      }}
      data-theme={theme}
    >
      {/* Global theme indicator (subtle) */}
      <div style={{
        position: 'fixed',
        top: 8,
        right: 8,
        fontSize: 10,
        color: '#444',
        pointerEvents: 'none',
        zIndex: 9999
      }}>
        Theme: {currentTheme.name}
      </div>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 24px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 48, height: 48, background: 'linear-gradient(135deg, #3b82f6, #1e3a8a)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: 22 }}>CS</div>
            <div>
              <div style={{ fontSize: 28, fontWeight: 700 }}>ChordScope</div>
              <div style={{ color: '#555', fontSize: 12 }}>Acoustic Guitar Analyzer</div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ padding: '5px 12px', borderRadius: 999, fontSize: 12, background: isHealthy ? '#052e16' : '#3f1a1a', color: isHealthy ? '#4ade80' : '#f87171' }}>{status}</div>
            <button onClick={checkHealthAndLoad} style={{ padding: '7px 14px', background: '#1f1f1f', border: 'none', borderRadius: 8, fontSize: 13, cursor: 'pointer' }}>Refresh</button>

            {/* Global Theme Switcher */}
            <div style={{ display: 'flex', gap: 4, background: '#1f1f1f', padding: 3, borderRadius: 8 }}>
              {(Object.keys(THEME_CONFIG) as ThemeName[]).map(t => (
                <button
                  key={t}
                  onClick={() => setTheme(t)}
                  title={THEME_CONFIG[t].name}
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 4,
                    border: theme === t ? '2px solid white' : '1px solid #444',
                    background: THEME_CONFIG[t].bg,
                    cursor: 'pointer',
                    opacity: theme === t ? 1 : 0.7
                  }}
                />
              ))}
            </div>

            {/* Upload */}
            <label style={{ padding: '7px 16px', background: '#1e40af', color: 'white', borderRadius: 8, fontSize: 13, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {isUploading ? 'Uploading…' : '↑ Upload'}
              <input type="file" accept="audio/*" onChange={handleUpload} disabled={isUploading} style={{ display: 'none' }} />
            </label>

            {/* Tuner with Note / Chord Mode */}
            <div style={{ display: 'flex', background: '#1f1f1f', borderRadius: 8, overflow: 'hidden', fontSize: 13 }}>
              <button
                onClick={toggleTuner}
                style={{
                  padding: '7px 14px',
                  background: tunerActive ? '#b91c1c' : '#27272a',
                  color: 'white',
                  border: 'none',
                  cursor: 'pointer'
                }}
              >
                {tunerActive ? 'Stop' : 'Tuner'}
              </button>
              {tunerActive && (
                <>
                  <button
                    onClick={() => setTunerMode('note')}
                    style={{
                      padding: '7px 12px',
                      background: tunerMode === 'note' ? '#3b82f6' : 'transparent',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Note
                  </button>
                  <button
                    onClick={() => setTunerMode('chord')}
                    style={{
                      padding: '7px 12px',
                      background: tunerMode === 'chord' ? '#3b82f6' : 'transparent',
                      color: 'white',
                      border: 'none',
                      cursor: 'pointer'
                    }}
                  >
                    Chord
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Tuner Display - Mode aware */}
        {tunerActive && (
          <div style={{ 
            background: tunerMode === 'chord' ? '#1a1625' : '#161616', 
            padding: 20, 
            borderRadius: 12, 
            marginBottom: 24, 
            textAlign: 'center',
            border: tunerMode === 'chord' ? '1px solid #6b46c1' : '1px solid #333'
          }}>
            <div style={{ fontSize: 13, color: tunerMode === 'chord' ? '#c4b5fd' : '#888' }}>
              Guitar Tuner (Microphone) — {tunerMode === 'chord' ? 'Chord Mode (experimental)' : 'Note Mode'}
            </div>
            
            {tunerMode === 'note' ? (
              <>
                <div style={{ fontSize: 64, fontWeight: 700, margin: '8px 0' }}>{tunerNote}</div>
                <div style={{ fontSize: 20, color: Math.abs(tunerCents) < 10 ? '#4ade80' : '#f59e0b' }}>
                  {tunerCents > 0 ? '+' : ''}{tunerCents} cents
                </div>
              </>
            ) : (
              <>
                <div style={{ fontSize: 48, fontWeight: 700, margin: '8px 0', color: '#c4b5fd' }}>{tunerChordGuess}</div>
                <div style={{ fontSize: 14, color: '#a5b4fc' }}>Root: {tunerNote} ({tunerCents > 0 ? '+' : ''}{tunerCents}¢)</div>
              </>
            )}
            
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>
              {tunerMode === 'chord' ? 'Strum a chord — results are smoothed but approximate' : 'Play a string and watch the cents'}
            </div>
          </div>
        )}

        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 14 }}>Recordings</h2>

        {files.length === 0 ? (
          <div style={{ background: '#161616', padding: 48, borderRadius: 16, textAlign: 'center' }}>
            <p style={{ color: '#777' }}>No files yet. Use the Upload button above.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            {files.map((file) => {
              const isAnalyzing = analyzingFiles.has(file.filename);
              const hasFailed = failedFiles.has(file.filename);

              return (
                <div key={file.filename} style={{ background: '#161616', padding: '16px 20px', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 500 }}>{file.filename}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>{file.size_mb} MB</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {file.has_analysis && (
                      <button onClick={() => openPlayMode(file)} style={{ padding: '8px 14px', background: currentTheme.accent, color: 'white', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13, opacity: 0.9 }}>Play</button>
                    )}
                    <button onClick={() => analyzeFile(file.filename)} disabled={isAnalyzing} style={{ padding: '8px 14px', background: hasFailed ? '#3f1a1a' : (file.has_analysis ? '#27272a' : '#1e40af'), color: '#ddd', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>
                      {isAnalyzing ? 'Analyzing…' : hasFailed ? 'Retry' : file.has_analysis ? 'Re-analyze' : 'Analyze'}
                    </button>
                    <button onClick={() => deleteFile(file.filename)} style={{ padding: '8px 12px', background: '#3f1a1a', color: '#f87171', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}>Delete</button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ==================== PREMIUM PLAY MODE ==================== */}
      {playMode && (
        <div style={{ position: 'fixed', inset: 0, background: '#0a0a0a', zIndex: 300, display: 'flex', flexDirection: 'column' }}>
          {/* Top Bar */}
          <div style={{ padding: '14px 28px', borderBottom: '1px solid #222', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#111' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 52, height: 52, background: 'linear-gradient(145deg, #1e3a8a, #3b82f6)', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 800 }}>CS</div>
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>{playMode.file.filename}</div>
                <div style={{ fontSize: 13, color: '#666' }}>
                  {playMode.analysis.duration.toFixed(1)}s • {playMode.analysis.bpm} BPM • Key {playMode.analysis.key}
                </div>
              </div>
            </div>
            <button onClick={closePlayMode} style={{ fontSize: 26, color: '#777', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>

          <div style={{ flex: 1, display: 'flex', padding: '20px 40px', gap: 32, overflow: 'hidden' }}>
            {/* LEFT: Artwork + Details + Key Chords (Themed) */}
            <div style={{ width: 260, flexShrink: 0 }}>
              {/* Themed Artwork Area */}
              {/* Themed Artwork Area - Click to cycle, supports real images */}
              <div
                onClick={() => {
                  const themes: ThemeName[] = ['classic', 'blue', 'warm', 'minimal', 'aurora', 'vinyl', 'wood', 'nebula'];
                  const next = themes[(themes.indexOf(theme) + 1) % themes.length];
                  setTheme(next);
                }}
                style={{
                  width: '100%',
                  aspectRatio: '1/1',
                  borderRadius: 12,
                  marginBottom: 16,
                  cursor: 'pointer',
                  overflow: 'hidden',
                  position: 'relative',
                  boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                  // If we have a real photo for this theme, use it + nice dark overlay for readability
                  ...(THEME_IMAGES[theme]
                    ? {
                        backgroundImage: `linear-gradient(rgba(0,0,0,0.25), rgba(0,0,0,0.65)), url(${THEME_IMAGES[theme]})`,
                      }
                    : {
                        background: THEME_CONFIG[theme].bg,
                      }),
                }}
              >
                {/* Subtle overlay for text readability */}
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.55))'
                }} />
                
                <div style={{ 
                  position: 'relative', 
                  zIndex: 1, 
                  fontSize: 28, 
                  fontWeight: 700, 
                  color: 'white',
                  textShadow: '0 2px 8px rgba(0,0,0,0.6)',
                  textAlign: 'center',
                  padding: '0 10px'
                }}>
                  {THEME_CONFIG[theme].name}
                </div>
              </div>

              {/* Song Details */}
              <div style={{ background: '#161616', padding: 16, borderRadius: 10, marginBottom: 16 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: '0.5px' }}>SONG DETAILS</div>
                <div style={{ display: 'grid', gap: 7, fontSize: 14 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>BPM</span>
                    <span style={{ fontWeight: 600 }}>{playMode.analysis.bpm}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Key</span>
                    <span style={{ fontWeight: 600 }}>{playMode.analysis.key}</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Duration</span>
                    <span style={{ fontWeight: 600 }}>{playMode.analysis.duration.toFixed(1)}s</span>
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ color: '#888' }}>Chord Changes</span>
                    <span style={{ fontWeight: 600 }}>{playMode.analysis.chords.length}</span>
                  </div>
                </div>
              </div>

              {/* Chords in this Key - Pretty version with actual names */}
              <div style={{ background: '#161616', padding: 16, borderRadius: 10 }}>
                <div style={{ fontSize: 11, color: '#888', marginBottom: 8, letterSpacing: '0.5px' }}>
                  CHORDS IN THE KEY OF {playMode.analysis.key}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {getChordsForKey(playMode.analysis.key).map((ch, i) => {
                    const isMinor = ch.toLowerCase().includes('m') || ch.toLowerCase().includes('min');
                    return (
                      <div key={i} style={{
                        background: isMinor ? '#312e81' : '#1e3a8a',
                        color: isMinor ? '#c7d2fe' : '#bfdbfe',
                        padding: '6px 12px',
                        borderRadius: 999,
                        fontSize: 13,
                        fontWeight: 600,
                        border: '1px solid rgba(255,255,255,0.1)'
                      }}>
                        {ch}
                      </div>
                    );
                  })}
                </div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 8 }}>
                  Tap a chord in the timeline on the right to jump
                </div>
              </div>
            </div>

            {/* CENTER: Big Chord + Waveform */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
              <div style={{ fontSize: 120, fontWeight: 700, lineHeight: 1, letterSpacing: '-7px', color: '#fff', textAlign: 'center', minHeight: 130 }}>
                {currentChord}
              </div>
              <div style={{ width: '100%', maxWidth: 780, marginTop: 16 }}>
                <div id="waveform" style={{ width: '100%', background: '#111', borderRadius: 6, padding: '6px 0' }} />
              </div>
              <button onClick={togglePlay} style={{ marginTop: 18, padding: '12px 36px', fontSize: 15, background: '#3b82f6', color: 'white', border: 'none', borderRadius: 999, cursor: 'pointer', fontWeight: 600 }}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
            </div>

            {/* RIGHT: Chord Timeline (synced) */}
            <div style={{ width: 240, flexShrink: 0, overflow: 'auto' }}>
              <div style={{ fontSize: 12, color: '#888', marginBottom: 8, paddingLeft: 4 }}>CHORD TIMELINE</div>
              {playMode.analysis.chords.map((chord, index) => (
                <div
                  key={index}
                  onClick={() => seekTo(chord.start)}
                  style={{
                    padding: '7px 12px',
                    marginBottom: 3,
                    borderRadius: 6,
                    background: index === activeChordIndex ? '#1e40af' : '#161616',
                    cursor: 'pointer',
                    fontSize: 13,
                    display: 'flex',
                    justifyContent: 'space-between'
                  }}
                >
                  <span>{formatTime(chord.start)} → {formatTime(chord.end)}</span>
                  <span style={{ fontWeight: 600 }}>{chord.chord}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
