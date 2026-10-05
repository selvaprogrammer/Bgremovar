import React from 'react';
import { Video, Sparkles } from 'lucide-react';

export default function Header({ hasVideo, onLoadSample }) {
  return (
    <header className="glass-panel" style={{ margin: '0.6rem 1rem 0.4rem', padding: '0.5rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ 
          background: 'var(--accent-gradient)', 
          width: '36px', 
          height: '36px', 
          borderRadius: '10px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          boxShadow: '0 0 14px rgba(6, 182, 212, 0.4)'
        }}>
          <Video size={20} color="white" />
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <h1 style={{ fontSize: '1.15rem', fontWeight: '700', letterSpacing: '-0.02em', background: 'linear-gradient(to right, #fff, #9CA3AF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              AlphaStudio
            </h1>
            <span style={{ 
              background: 'rgba(6, 182, 212, 0.15)', 
              color: 'var(--accent-cyan)', 
              border: '1px solid rgba(6, 182, 212, 0.3)',
              fontSize: '0.65rem',
              fontWeight: '600',
              padding: '0.1rem 0.45rem',
              borderRadius: '20px',
              textTransform: 'uppercase'
            }}>
              MP4 to WebM Alpha
            </span>
          </div>
          <p style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', margin: 0 }}>
            Background & Watermark Removal Studio
          </p>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
        {!hasVideo && onLoadSample && (
          <button 
            className="btn-secondary" 
            onClick={onLoadSample}
            style={{ fontSize: '0.82rem', padding: '0.35rem 0.8rem' }}
          >
            <Sparkles size={15} color="var(--accent-cyan)" />
            Try Sample Video
          </button>
        )}
      </div>
    </header>
  );
}
