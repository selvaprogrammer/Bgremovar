import React from 'react';
import { Sliders, Pipette, Sparkles, Layers, ShieldCheck } from 'lucide-react';

export default function BackgroundTab({ settings, onChange }) {
  const handleToggle = (e) => {
    onChange({ enabled: e.target.checked });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Top Toggle Switch */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '0.8rem', borderBottom: '1px solid var(--border-color)' }}>
        <div>
          <div style={{ fontWeight: '600', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Layers size={16} color="var(--accent-cyan)" />
            Background Removal
          </div>
          <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
            Isolate video foreground for transparent export
          </p>
        </div>
        <label className="toggle-switch">
          <input 
            type="checkbox" 
            checked={settings.enabled} 
            onChange={handleToggle} 
          />
          <span className="toggle-slider"></span>
        </label>
      </div>

      {settings.enabled && (
        <>
          {/* Mode Switcher */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', background: 'rgba(0,0,0,0.2)', padding: '0.25rem', borderRadius: '10px' }}>
            <button 
              className={`tab-btn ${settings.mode === 'chroma' ? 'active' : ''}`}
              onClick={() => onChange({ mode: 'chroma' })}
              style={{ justifyContent: 'center', fontSize: '0.85rem' }}
            >
              <Pipette size={15} />
              Chroma Key (Color)
            </button>
            <button 
              className={`tab-btn ${settings.mode === 'ai' ? 'active' : ''}`}
              onClick={() => onChange({ mode: 'ai' })}
              style={{ justifyContent: 'center', fontSize: '0.85rem' }}
            >
              <Sparkles size={15} color="var(--accent-purple)" />
              AI Auto Segment
            </button>
          </div>

          {/* Chroma Key Controls */}
          {settings.mode === 'chroma' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
                  Target Key Color
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                  <input 
                    type="color" 
                    value={settings.keyColor} 
                    onChange={(e) => onChange({ keyColor: e.target.value })}
                    style={{ width: '38px', height: '38px', borderRadius: '8px', border: '1px solid var(--border-color)', cursor: 'pointer', background: 'none' }}
                  />
                  <input 
                    type="text" 
                    className="glass-panel"
                    value={settings.keyColor} 
                    onChange={(e) => onChange({ keyColor: e.target.value })}
                    style={{ width: '120px', padding: '0.4rem 0.6rem', color: 'var(--text-primary)', fontSize: '0.85rem', textTransform: 'uppercase' }}
                  />
                </div>
              </div>

              {/* Similarity Slider */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Color Tolerance (Similarity)</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>{Math.round(settings.similarity * 100)}%</span>
                </div>
                <input 
                  type="range" className="custom-range"
                  min="0.05" max="0.8" step="0.01"
                  value={settings.similarity}
                  onChange={(e) => onChange({ similarity: parseFloat(e.target.value) })}
                />
              </div>

              {/* Edge Smoothness */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Edge Feather / Softness</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>{Math.round(settings.smoothness * 100)}%</span>
                </div>
                <input 
                  type="range" className="custom-range"
                  min="0.001" max="0.4" step="0.01"
                  value={settings.smoothness}
                  onChange={(e) => onChange({ smoothness: parseFloat(e.target.value) })}
                />
              </div>

              {/* Color Spill Suppression */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Spill Suppression</span>
                  <span style={{ color: 'var(--accent-cyan)', fontWeight: '600' }}>{Math.round(settings.spill * 100)}%</span>
                </div>
                <input 
                  type="range" className="custom-range"
                  min="0" max="1" step="0.05"
                  value={settings.spill}
                  onChange={(e) => onChange({ spill: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          )}

          {/* AI Auto Segmentation Controls */}
          {settings.mode === 'ai' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>AI Sensitivity Threshold</span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{Math.round(settings.aiThreshold * 100)}%</span>
                </div>
                <input 
                  type="range" className="custom-range"
                  min="0.1" max="0.8" step="0.01"
                  value={settings.aiThreshold}
                  onChange={(e) => onChange({ aiThreshold: parseFloat(e.target.value) })}
                />
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.82rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Edge Feathering</span>
                  <span style={{ color: 'var(--accent-purple)', fontWeight: '600' }}>{Math.round(settings.aiFeather * 100)}%</span>
                </div>
                <input 
                  type="range" className="custom-range"
                  min="0.01" max="0.4" step="0.01"
                  value={settings.aiFeather}
                  onChange={(e) => onChange({ aiFeather: parseFloat(e.target.value) })}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
