import React from 'react';
import { Eraser, Crop, Plus, Trash2, Sliders, Eye } from 'lucide-react';

export default function WatermarkTab({ 
  watermarkSettings, 
  cropSettings, 
  onUpdateWatermark, 
  onUpdateCrop,
  onRemoveRegion 
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Watermark ROI Section */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.8rem' }}>
          <div>
            <div style={{ fontWeight: '600', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Eraser size={16} color="var(--accent-cyan)" />
              Watermark & Logo Eraser
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Target & erase logos or overlays
            </p>
          </div>
          <button 
            className={`btn-secondary ${watermarkSettings.drawingMode ? 'active' : ''}`}
            onClick={() => onUpdateWatermark({ drawingMode: !watermarkSettings.drawingMode })}
            style={{ fontSize: '0.8rem', padding: '0.35rem 0.7rem' }}
          >
            <Plus size={14} />
            {watermarkSettings.drawingMode ? "Drawing..." : "+ Add Box"}
          </button>
        </div>

        {/* Region Filter Mode Selector */}
        <div style={{ marginBottom: '1rem' }}>
          <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.4rem' }}>
            Erase Mode Algorithm
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
            <button 
              className={`tab-btn ${watermarkSettings.defaultMode === 'blur' ? 'active' : ''}`}
              onClick={() => onUpdateWatermark({ defaultMode: 'blur' })}
              style={{ justifyContent: 'center', fontSize: '0.78rem', padding: '0.4rem' }}
            >
              Blur
            </button>
            <button 
              className={`tab-btn ${watermarkSettings.defaultMode === 'pixelate' ? 'active' : ''}`}
              onClick={() => onUpdateWatermark({ defaultMode: 'pixelate' })}
              style={{ justifyContent: 'center', fontSize: '0.78rem', padding: '0.4rem' }}
            >
              Pixelate
            </button>
            <button 
              className={`tab-btn ${watermarkSettings.defaultMode === 'inpaint' ? 'active' : ''}`}
              onClick={() => onUpdateWatermark({ defaultMode: 'inpaint' })}
              style={{ justifyContent: 'center', fontSize: '0.78rem', padding: '0.4rem' }}
            >
              Inpaint Fill
            </button>
          </div>
        </div>

        {/* Active ROI list */}
        {watermarkSettings.regions && watermarkSettings.regions.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <label style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
              Active Eraser Zones ({watermarkSettings.regions.length})
            </label>
            {watermarkSettings.regions.map((region, idx) => (
              <div 
                key={region.id}
                className="glass-panel" 
                style={{ padding: '0.6rem 0.8rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'rgba(0,0,0,0.3)' }}
              >
                <div style={{ fontSize: '0.8rem' }}>
                  <span style={{ fontWeight: '600', color: 'var(--accent-cyan)' }}>Zone #{idx + 1}</span>
                  <span style={{ color: 'var(--text-muted)', marginLeft: '0.5rem' }}>
                    ({region.w}px × {region.h}px) - {region.mode}
                  </span>
                </div>
                <button 
                  className="btn-icon"
                  onClick={() => onRemoveRegion(region.id)}
                  style={{ width: '28px', height: '28px', color: '#EF4444' }}
                  title="Delete Zone"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <div style={{ 
            padding: '1rem', 
            borderRadius: '10px', 
            background: 'rgba(255,255,255,0.02)', 
            border: '1px dashed var(--border-color)', 
            textAlign: 'center',
            fontSize: '0.8rem',
            color: 'var(--text-muted)'
          }}>
            No watermark zones drawn yet. Click "+ Add Box" then drag on the video to select a logo.
          </div>
        )}
      </div>

      {/* Margin Cropping Section */}
      <div style={{ paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
        <div style={{ fontWeight: '600', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.8rem' }}>
          <Crop size={16} color="var(--accent-cyan)" />
          Video Margin Cropper
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.8rem' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Crop Top</span>
              <span>{cropSettings.top}%</span>
            </div>
            <input 
              type="range" className="custom-range"
              min="0" max="30" step="1"
              value={cropSettings.top}
              onChange={(e) => onUpdateCrop({ top: parseInt(e.target.value) })}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Crop Bottom</span>
              <span>{cropSettings.bottom}%</span>
            </div>
            <input 
              type="range" className="custom-range"
              min="0" max="30" step="1"
              value={cropSettings.bottom}
              onChange={(e) => onUpdateCrop({ bottom: parseInt(e.target.value) })}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Crop Left</span>
              <span>{cropSettings.left}%</span>
            </div>
            <input 
              type="range" className="custom-range"
              min="0" max="30" step="1"
              value={cropSettings.left}
              onChange={(e) => onUpdateCrop({ left: parseInt(e.target.value) })}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', marginBottom: '0.2rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Crop Right</span>
              <span>{cropSettings.right}%</span>
            </div>
            <input 
              type="range" className="custom-range"
              min="0" max="30" step="1"
              value={cropSettings.right}
              onChange={(e) => onUpdateCrop({ right: parseInt(e.target.value) })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
