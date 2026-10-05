import React, { useState, useEffect, useRef } from 'react';
import { Download, X, Film, Check, Loader2, Sparkles, Volume2, VolumeX, Upload, Clock } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function ExportModal({ 
  isOpen, 
  onClose, 
  onStartExport, 
  exportProgress, 
  isExporting, 
  exportResult,
  videoName,
  onReexport,
  onUploadNewVideo
}) {
  const [fps, setFps] = useState(30);
  const [includeAudio, setIncludeAudio] = useState(true);
  const [elapsedSeconds, setElapsedSeconds] = useState('0.0');
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!isExporting) {
      setElapsedSeconds('0.0');
      return;
    }
    const startTime = Date.now();
    const timer = setInterval(() => {
      setElapsedSeconds(((Date.now() - startTime) / 1000).toFixed(1));
    }, 100);

    return () => clearInterval(timer);
  }, [isExporting]);

  if (!isOpen) return null;

  const completedUrl = exportResult?.url;

  const handleDownload = () => {
    if (!completedUrl) return;
    const a = document.createElement('a');
    a.href = completedUrl;
    const baseName = videoName ? videoName.replace(/\.[^/.]+$/, "") : "transparent_video";
    a.download = `${baseName}_alpha_transparent.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Trigger confetti celebration!
    confetti({
      particleCount: 100,
      spread: 70,
      origin: { y: 0.6 }
    });
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      onClose();
      if (onUploadNewVideo) {
        onUploadNewVideo(file);
      }
      e.target.value = '';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      zIndex: 999,
      background: 'rgba(0, 0, 0, 0.75)',
      backdropFilter: 'blur(10px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1.5rem'
    }}>
      <input 
        ref={fileInputRef} 
        type="file" 
        accept="video/mp4,video/webm,video/quicktime,video/mov" 
        style={{ display: 'none' }} 
        onChange={handleFileChange}
      />
      <div className="glass-panel" style={{ width: '100%', maxWidth: '480px', padding: '1.75rem', position: 'relative' }}>
        {/* Modal Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
            <div style={{ background: 'rgba(255, 0, 127, 0.2)', padding: '0.5rem', borderRadius: '10px', color: 'var(--picsart-pink)' }}>
              <Film size={20} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.15rem', fontWeight: '700' }}>Export Alpha WebM</h3>
              <p style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>VP9/VP8 Transparent Video Stream</p>
            </div>
          </div>
          {!isExporting && (
            <button className="btn-icon" onClick={onClose}>
              <X size={18} />
            </button>
          )}
        </div>

        {!isExporting && !completedUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.2rem' }}>
            {/* FPS Selector */}
            <div>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                Target Frame Rate (FPS)
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.5rem' }}>
                {[24, 30, 60].map(rate => (
                  <button 
                    key={rate}
                    className={`tab-btn ${fps === rate ? 'active' : ''}`}
                    onClick={() => setFps(rate)}
                    style={{ justifyContent: 'center', fontSize: '0.85rem' }}
                  >
                    {rate} FPS
                  </button>
                ))}
              </div>
            </div>

            {/* Audio Inclusion Toggle */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 0.8rem', background: 'rgba(0,0,0,0.2)', borderRadius: '10px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '0.85rem' }}>
                {includeAudio ? <Volume2 size={18} color="var(--accent-green)" /> : <VolumeX size={18} color="var(--text-muted)" />}
                <span>Include Source Audio Track</span>
              </div>
              <label className="toggle-switch">
                <input 
                  type="checkbox" 
                  checked={includeAudio}
                  onChange={(e) => setIncludeAudio(e.target.checked)}
                />
                <span className="toggle-slider"></span>
              </label>
            </div>

            <div style={{ 
              padding: '0.8rem', 
              borderRadius: '10px', 
              background: 'rgba(255, 0, 127, 0.08)', 
              border: '1px solid rgba(255, 0, 127, 0.2)',
              fontSize: '0.8rem',
              color: 'var(--text-secondary)'
            }}>
              ✨ WebM VP9 Codec ensures full transparent background support in Chrome, Edge, Brave, Premiere Pro, OBS, and DaVinci.
            </div>

            <button 
              className="btn-primary"
              onClick={() => onStartExport({ fps, includeAudio })}
              style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', fontSize: '0.95rem', marginTop: '0.5rem' }}
            >
              <Sparkles size={18} />
              Start Rendering WebM
            </button>
          </div>
        )}

        {/* Progress Bar Rendering state */}
        {isExporting && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ position: 'relative', width: '64px', height: '64px', margin: '0 auto 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Loader2 size={48} color="var(--picsart-pink)" className="pulse-glow" style={{ animation: 'spin 1.5s linear infinite' }} />
            </div>
            <h4 style={{ fontSize: '1.1rem', fontWeight: '600', marginBottom: '0.4rem' }}>
              Rendering WebM with Alpha...
            </h4>
            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Frame {exportProgress.frame || 0} of {exportProgress.totalFrames || 100}
            </p>

            {/* Progress Bar */}
            <div style={{ height: '8px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px', overflow: 'hidden', marginBottom: '0.8rem' }}>
              <div 
                style={{ 
                  height: '100%', 
                  width: `${exportProgress.percent || 0}%`, 
                  background: 'var(--button-gradient)',
                  transition: 'width 0.2s linear'
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '0.4rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: '700', color: 'var(--picsart-pink)' }}>
                {exportProgress.percent || 0}%
              </span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.82rem', color: 'var(--text-secondary)', background: 'rgba(0,0,0,0.3)', padding: '0.2rem 0.6rem', borderRadius: '12px' }}>
                <Clock size={13} color="var(--picsart-pink)" />
                <span>Processing Time: <strong style={{ color: '#fff' }}>{elapsedSeconds}s</strong></span>
              </div>
            </div>
          </div>
        )}

        {/* Completed State */}
        {!isExporting && completedUrl && (
          <div style={{ textAlign: 'center', padding: '1rem 0' }}>
            <div style={{ 
              width: '56px', height: '56px', borderRadius: '50%', background: 'rgba(16, 185, 129, 0.15)',
              border: '1px solid var(--accent-green)', color: 'var(--accent-green)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem'
            }}>
              <Check size={28} />
            </div>
            <h4 style={{ fontSize: '1.2rem', fontWeight: '700', marginBottom: '0.3rem' }}>
              Transparent WebM Ready!
            </h4>
            
            {/* Completion processing time badge */}
            <div style={{ 
              display: 'inline-flex', 
              alignItems: 'center', 
              gap: '0.4rem', 
              background: 'rgba(16, 185, 129, 0.12)', 
              border: '1px solid rgba(16, 185, 129, 0.3)', 
              color: 'var(--accent-green)', 
              padding: '0.35rem 0.85rem', 
              borderRadius: '20px', 
              fontSize: '0.82rem', 
              fontWeight: '600',
              marginBottom: '1.25rem'
            }}>
              <Clock size={14} />
              <span>Processing Time: <strong>{exportResult?.durationSec || elapsedSeconds}s</strong></span>
            </div>

            <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Your video has been rendered with background removal.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <button 
                className="btn-primary"
                onClick={handleDownload}
                style={{ width: '100%', justifyContent: 'center', padding: '0.8rem', fontSize: '0.95rem' }}
              >
                <Download size={18} />
                Download .WebM File
              </button>

              <button 
                className="btn-secondary"
                onClick={() => {
                  fileInputRef.current?.click();
                }}
                style={{ width: '100%', justifyContent: 'center', padding: '0.75rem', fontSize: '0.9rem' }}
              >
                <Film size={18} />
                Choose MP4 File
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

