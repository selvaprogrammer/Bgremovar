import React, { useRef, useState } from 'react';
import { UploadCloud, Film, Sparkles, CheckCircle2, ShieldCheck } from 'lucide-react';

export default function VideoUploader({ onFileSelected, onLoadSample }) {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (file.type.startsWith('video/')) {
        onFileSelected(file);
      }
    }
  };

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelected(e.target.files[0]);
    }
  };

  return (
    <div style={{ padding: '2rem', maxWidth: '850px', margin: '3rem auto' }}>
      <div 
        className="glass-panel"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          padding: '3.5rem 2rem',
          textAlign: 'center',
          cursor: 'pointer',
          border: isDragging ? '2px dashed var(--accent-cyan)' : '2px dashed var(--border-color)',
          background: isDragging ? 'rgba(6, 182, 212, 0.08)' : 'var(--bg-card)',
          transition: 'all 0.3s ease',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        <input 
          ref={fileInputRef} 
          type="file" 
          accept="video/mp4,video/webm,video/quicktime,video/mov" 
          style={{ display: 'none' }} 
          onChange={handleFileChange}
        />

        <div style={{ 
          width: '72px', 
          height: '72px', 
          margin: '0 auto 1.5rem', 
          borderRadius: '20px', 
          background: 'rgba(6, 182, 212, 0.12)', 
          border: '1px solid rgba(6, 182, 212, 0.3)',
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center'
        }}>
          <UploadCloud size={36} color="var(--accent-cyan)" />
        </div>

        <h2 style={{ fontSize: '1.5rem', fontWeight: '700', marginBottom: '0.5rem' }}>
          Upload MP4 Video for Processing
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.95rem', marginBottom: '1.5rem' }}>
          Drag and drop your MP4 file here, or click to browse files
        </p>

        <div style={{ display: 'inline-flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className="btn-primary" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
            <Film size={18} />
            Choose MP4 File
          </button>
          <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); onLoadSample(); }}>
            <Sparkles size={18} color="var(--accent-cyan)" />
            Load Sample Video
          </button>
        </div>

        <div style={{ 
          marginTop: '2.5rem', 
          paddingTop: '1.5rem', 
          borderTop: '1px solid var(--border-color)',
          display: 'flex',
          justifyContent: 'center',
          gap: '1.5rem',
          flexWrap: 'wrap',
          fontSize: '0.82rem',
          color: 'var(--text-muted)'
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CheckCircle2 size={14} color="var(--accent-green)" /> VP9 / VP8 Transparent WebM Output
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <CheckCircle2 size={14} color="var(--accent-green)" /> AI & Chroma Key Background Removal
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <ShieldCheck size={14} color="var(--accent-cyan)" /> 100% Private Client-Side Processing
          </span>
        </div>
      </div>
    </div>
  );
}
