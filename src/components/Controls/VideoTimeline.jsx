import React, { useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, SkipBack, SkipForward, Repeat } from 'lucide-react';

export default function VideoTimeline({ videoRef }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLooping, setIsLooping] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const onTimeUpdate = () => setCurrentTime(video.currentTime || 0);
    const onLoadedMetadata = () => {
      setDuration(video.duration || 0);
      video.loop = isLooping;
    };
    const onEnded = () => {
      if (!isLooping) setIsPlaying(false);
    };

    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('ended', onEnded);

    if (video.duration) setDuration(video.duration);

    return () => {
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('ended', onEnded);
    };
  }, [videoRef, isLooping]);

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().then(() => setIsPlaying(true)).catch(() => {});
    } else {
      video.pause();
      setIsPlaying(false);
    }
  };

  const handleSeek = (e) => {
    const video = videoRef.current;
    if (!video) return;
    const time = parseFloat(e.target.value);
    video.currentTime = time;
    setCurrentTime(time);
  };

  const stepFrame = (frames = 1) => {
    const video = videoRef.current;
    if (!video) return;
    video.pause();
    setIsPlaying(false);
    const fps = 30;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + (frames / fps)));
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return "00:00";
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 10);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}.${ms}`;
  };

  return (
    <div className="glass-panel" style={{ padding: '0.45rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.35rem', flexShrink: 0 }}>
      {/* Timeline Scrubber */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: '50px' }}>
          {formatTime(currentTime)}
        </span>
        
        <input 
          type="range" 
          className="custom-range"
          min="0"
          max={duration || 100}
          step="0.01"
          value={currentTime}
          onChange={handleSeek}
        />

        <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', minWidth: '50px' }}>
          {formatTime(duration)}
        </span>
      </div>

      {/* Action buttons bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <button className="btn-icon" onClick={() => stepFrame(-1)} title="Step 1 Frame Back" style={{ width: '28px', height: '28px' }}>
            <SkipBack size={14} />
          </button>
          
          <button 
            className="btn-primary" 
            onClick={togglePlay}
            style={{ width: '34px', height: '34px', padding: 0, borderRadius: '50%', justifyContent: 'center' }}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} style={{ marginLeft: '2px' }} />}
          </button>

          <button className="btn-icon" onClick={() => stepFrame(1)} title="Step 1 Frame Forward" style={{ width: '28px', height: '28px' }}>
            <SkipForward size={14} />
          </button>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.8rem' }}>
          <button 
            className={`btn-icon ${isLooping ? 'active' : ''}`}
            onClick={() => {
              const next = !isLooping;
              setIsLooping(next);
              if (videoRef.current) videoRef.current.loop = next;
            }}
            title={isLooping ? "Loop Playback On" : "Loop Playback Off"}
          >
            <Repeat size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
