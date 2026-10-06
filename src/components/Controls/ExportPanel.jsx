import React, { useState, useEffect, useRef } from 'react';
import { Download, Check, Loader2, Sparkles, Volume2, VolumeX, Upload, Clock, RefreshCw, FileVideo } from 'lucide-react';
import confetti from 'canvas-confetti';

/**
 * Inline export panel — upload, conversion progress and download all on the same screen (no modal).
 */

const QUALITY_OPTIONS = [
  { id: 'small', label: 'Small', hint: 'Smallest file' },
  { id: 'balanced', label: 'Balanced', hint: 'Recommended' },
  { id: 'high', label: 'High', hint: 'Best quality' }
];

export function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ExportPanel({
  onStartExport,
  exportProgress,
  isExporting,
  exportResult,
  videoName,
  inputSize,
  onReexport,
  onUploadNewVideo,
  onReset
}) {
  const [fps, setFps] = useState(30);
  const [quality, setQuality] = useState('balanced');
  const [includeAudio, setIncludeAudio] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState('0.0');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isExporting) return;
    const startTime = Date.now();
    setElapsedSeconds('0.0');
    const timer = setInterval(() => {
      setElapsedSeconds(((Date.now() - startTime) / 1000).toFixed(1));
    }, 100);
    return () => clearInterval(timer);
  }, [isExporting]);

  const completedUrl = exportResult?.url;

  const handleDownload = () => {
    if (!completedUrl) return;
    const a = document.createElement('a');
    a.href = completedUrl;
    const baseName = videoName ? videoName.replace(/\.[^/.]+$/, '') : 'transparent_video';
    a.download = `${baseName}_alpha_transparent.${exportResult?.ext || 'webm'}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file && onUploadNewVideo) onUploadNewVideo(file);
    e.target.value = '';
  };

  const chip = () => ({
    justifyContent: 'center',
    fontSize: '0.75rem',
    padding: '0.35rem 0.2rem',
    opacity: isExporting ? 0.5 : 1
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', paddingTop: '0.75rem', borderTop: '1px solid var(--border-color)', flexShrink: 0 }}>
      <input
        ref={fileInputRef}
        type="file"
        accept="video/mp4,video/webm,video/quicktime,video/mov"
        style={{ display: 'none' }}
        onChange={handleFileChange}
      />

      {/* Current file row: name + size + change / reset */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.78rem' }}>
        <FileVideo size={15} color="var(--picsart-pink)" style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={videoName}>
          {videoName || 'video'} <span style={{ color: 'var(--text-secondary)' }}>· {formatBytes(inputSize)}</span>
        </span>
        <button className="btn-secondary" disabled={isExporting} onClick={onReset}
          style={{ fontSize: '0.72rem', padding: '0.25rem 0.5rem' }} title="Reset video & settings">
          <RefreshCw size={13} />
        </button>
      </div>

      {/* Re-upload: pick a new video without leaving this screen */}
      <button className="btn-secondary" disabled={isExporting}
        onClick={() => fileInputRef.current?.click()}
        style={{ width: '100%', justifyContent: 'center', fontSize: '0.8rem', padding: '0.45rem', opacity: isExporting ? 0.5 : 1 }}
        title="Upload a different video (settings are kept)">
        <Upload size={15} /> Re-upload Video
      </button>

      {/* Settings (always visible, locked while rendering) */}
      {!completedUrl && (
        <>
          <div>
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', marginBottom: '0.25rem' }}>File size / quality</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '0.3rem' }}>
              {QUALITY_OPTIONS.map(q => (
                <button key={q.id} disabled={isExporting} title={q.hint}
                  className={`tab-btn ${quality === q.id ? 'active' : ''}`}
                  onClick={() => setQuality(q.id)} style={chip()}>
                  {q.label}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr) auto', gap: '0.3rem', alignItems: 'center' }}>
            {[24, 30, 60].map(rate => (
              <button key={rate} disabled={isExporting}
                className={`tab-btn ${fps === rate ? 'active' : ''}`}
                onClick={() => setFps(rate)} style={chip()}>
                {rate} FPS
              </button>
            ))}
            <button className="btn-icon" disabled={isExporting}
              onClick={() => setIncludeAudio(v => !v)}
              title={includeAudio ? 'Audio included (click to remove)' : 'No audio (click to include)'}
              style={{ padding: '0.3rem' }}>
              {includeAudio ? <Volume2 size={16} color="var(--accent-green)" /> : <VolumeX size={16} color="var(--text-muted)" />}
            </button>
          </div>
        </>
      )}

      {/* Progress (inline) */}
      {isExporting && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '0.75rem', marginBottom: '0.3rem' }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
              <Loader2 size={14} color="var(--picsart-pink)" style={{ animation: 'spin 1s linear infinite' }} />
              Converting… <strong style={{ color: 'var(--picsart-pink)' }}>{exportProgress.percent || 0}%</strong>
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem', color: 'var(--text-secondary)' }}>
              <Clock size={12} /> {elapsedSeconds}s
            </span>
          </div>
          <div style={{ height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${exportProgress.percent || 0}%`, background: 'var(--button-gradient)', transition: 'width 0.2s linear' }} />
          </div>
        </div>
      )}

      {/* Result (inline) */}
      {!isExporting && completedUrl && (
        <div style={{ padding: '0.6rem 0.7rem', borderRadius: '10px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid rgba(16, 185, 129, 0.3)', fontSize: '0.78rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: 'var(--accent-green)', fontWeight: 600, marginBottom: '0.3rem' }}>
            <Check size={15} /> Transparent {(exportResult?.ext || 'webm').toUpperCase()} ready
          </div>
          <div style={{ color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '0.2rem 0.8rem' }}>
            <span>{formatBytes(inputSize)} → <strong style={{ color: '#fff' }}>{formatBytes(exportResult?.size)}</strong></span>
            <span><Clock size={11} style={{ verticalAlign: '-1px' }} /> {exportResult?.durationSec}s</span>
            <span>{exportResult?.engine === 'server' ? 'Python server' : 'Browser'}</span>
          </div>
          {exportResult?.engine === 'browser' && (
            <div style={{ marginTop: '0.3rem', color: '#fbbf24', fontSize: '0.72rem' }}>
              Python server offline: used browser encoder. For the smallest file, run the server (port 8000).
            </div>
          )}
        </div>
      )}

      {/* Main action */}
      {!completedUrl ? (
        <button className="btn-primary" disabled={isExporting}
          onClick={() => onStartExport({ fps, quality, includeAudio })}
          style={{ width: '100%', justifyContent: 'center', padding: '0.55rem', fontSize: '0.85rem', opacity: isExporting ? 0.6 : 1 }}>
          {isExporting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={16} />}
          {isExporting ? 'Converting…' : 'Convert to Alpha WebM'}
        </button>
      ) : (
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="btn-secondary" onClick={onReexport}
            style={{ flex: 1, justifyContent: 'center', fontSize: '0.8rem', padding: '0.5rem' }} title="Change settings and convert again">
            <RefreshCw size={14} /> Re-convert
          </button>
          <button className="btn-primary" onClick={handleDownload}
            style={{ flex: 2, justifyContent: 'center', fontSize: '0.85rem', padding: '0.5rem' }}>
            <Download size={16} /> Download
          </button>
        </div>
      )}
    </div>
  );
}
