import React, { useRef, useEffect, useState } from 'react';
import { Eye, EyeOff, Plus, Crop } from 'lucide-react';
import { applyChromaKey } from '../utils/chromaKey';
import { applySmartSegmentation } from '../utils/aiSegmenter';
import { applyWatermarkRemoval } from '../utils/watermarkRemover';

export default function VideoCanvas({
  videoRef,
  bgSettings,
  watermarkSettings,
  cropSettings,
  onAddWatermarkRegion,
  onUpdateWatermarkRegion,
  onRemoveWatermarkRegion,
  canvasRef,
  onEyedropperPick
}) {
  const containerRef = useRef(null);
  const [showOriginal, setShowOriginal] = useState(false);
  const [isDrawingROI, setIsDrawingROI] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [currentDrawRect, setCurrentDrawRect] = useState(null);
  const [isPickingColor, setIsPickingColor] = useState(false);
  const [canvasDimensions, setCanvasDimensions] = useState({ width: 640, height: 360 });

  // Main canvas render loop synced with video playback
  useEffect(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    let animId;

    const render = () => {
      if (video.readyState >= 2) {
        if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
          canvas.width = video.videoWidth || 640;
          canvas.height = video.videoHeight || 360;
          setCanvasDimensions({ width: canvas.width, height: canvas.height });
        }

        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw current video frame onto canvas
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

        if (!showOriginal) {
          // 1. Watermark Removal (applied before bg removal to preserve frame colors)
          if (watermarkSettings.regions && watermarkSettings.regions.length > 0) {
            applyWatermarkRemoval(ctx, canvas, watermarkSettings.regions);
          }

          // 2. Background Removal
          if (bgSettings.enabled) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

            if (bgSettings.mode === 'chroma') {
              applyChromaKey(imageData, {
                keyColor: bgSettings.keyColor,
                similarity: bgSettings.similarity,
                smoothness: bgSettings.smoothness,
                spill: bgSettings.spill
              });
            } else if (bgSettings.mode === 'ai') {
              applySmartSegmentation(imageData, {
                threshold: bgSettings.aiThreshold,
                edgeFeather: bgSettings.aiFeather,
                mode: bgSettings.aiMode,
                bgSampleColor: bgSettings.keyColor
              });
            }

            ctx.putImageData(imageData, 0, 0);
          }
        }
      }

      animId = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [videoRef, canvasRef, bgSettings, watermarkSettings, showOriginal]);

  // Handle ROI mouse drawing over canvas
  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: Math.round((e.clientX - rect.left) * scaleX),
      y: Math.round((e.clientY - rect.top) * scaleY)
    };
  };

  const handleMouseDown = (e) => {
    const coords = getCanvasCoords(e);

    // Color Eyedropper mode - sample from RAW UNTOUCHED video frame!
    if (isPickingColor) {
      const video = videoRef.current;
      if (video && video.videoWidth > 0) {
        const offCanvas = document.createElement('canvas');
        offCanvas.width = video.videoWidth;
        offCanvas.height = video.videoHeight;
        const offCtx = offCanvas.getContext('2d');
        offCtx.drawImage(video, 0, 0);

        const pixel = offCtx.getImageData(coords.x, coords.y, 1, 1).data;
        const hex = '#' + ((1 << 24) + (pixel[0] << 16) + (pixel[1] << 8) + pixel[2]).toString(16).slice(1);
        onEyedropperPick && onEyedropperPick(hex);
      }
      setIsPickingColor(false);
      return;
    }

    if (watermarkSettings.drawingMode) {
      setIsDrawingROI(true);
      setDrawStart(coords);
      setCurrentDrawRect({ x: coords.x, y: coords.y, w: 0, h: 0 });
    }
  };

  const handleMouseMove = (e) => {
    if (!isDrawingROI || !drawStart) return;
    const coords = getCanvasCoords(e);
    const x = Math.min(drawStart.x, coords.x);
    const y = Math.min(drawStart.y, coords.y);
    const w = Math.abs(coords.x - drawStart.x);
    const h = Math.abs(coords.y - drawStart.y);
    setCurrentDrawRect({ x, y, w, h });
  };

  const handleMouseUp = () => {
    if (isDrawingROI && currentDrawRect && currentDrawRect.w > 10 && currentDrawRect.h > 10) {
      onAddWatermarkRegion({
        id: 'roi_' + Date.now(),
        ...currentDrawRect,
        mode: watermarkSettings.defaultMode || 'blur',
        blurRadius: 15,
        pixelSize: 10
      });
    }
    setIsDrawingROI(false);
    setDrawStart(null);
    setCurrentDrawRect(null);
  };

  return (
    <div className="glass-panel" style={{ padding: '0.65rem 0.85rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      {/* Top Controls Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button 
            className={`btn-icon ${showOriginal ? 'active' : ''}`}
            onClick={() => setShowOriginal(!showOriginal)}
            title={showOriginal ? "Showing Original Video" : "Showing Processed Alpha Stream"}
          >
            {showOriginal ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {showOriginal ? "Original MP4" : "Alpha Output Preview"}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button 
            className={`btn-secondary ${watermarkSettings.drawingMode ? 'active' : ''}`}
            onClick={() => onUpdateWatermarkRegion({ drawingMode: !watermarkSettings.drawingMode })}
            style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
          >
            <Plus size={14} />
            {watermarkSettings.drawingMode ? "Click & Drag on Video" : "+ Select Watermark Area"}
          </button>

          {bgSettings.mode === 'chroma' && (
            <button 
              className={`btn-secondary ${isPickingColor ? 'active' : ''}`}
              onClick={() => setIsPickingColor(!isPickingColor)}
              style={{ fontSize: '0.78rem', padding: '0.35rem 0.75rem' }}
            >
              <Crop size={14} />
              {isPickingColor ? "Click Color on Frame" : "Color Eyedropper"}
            </button>
          )}
        </div>
      </div>

      {/* Main Canvas Frame Container - Always Checkerboard Transparent */}
      <div 
        ref={containerRef}
        className="checkerboard-bg"
        style={{
          borderRadius: '14px',
          overflow: 'hidden',
          position: 'relative',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          flex: 1,
          minHeight: '240px',
          maxHeight: 'calc(100vh - 220px)',
          border: '1px solid var(--border-color)',
          backgroundColor: '#FFFFFF'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
      >
        {/* Inner Canvas Wrapper matching exact canvas display dimensions */}
        <div style={{ position: 'relative', display: 'inline-flex', justifyContent: 'center', alignItems: 'center', maxWidth: '100%', maxHeight: '100%' }}>
          {/* Real-time HTML5 Canvas */}
          <canvas 
            ref={canvasRef} 
            style={{ 
              display: 'block',
              maxWidth: '100%', 
              maxHeight: 'calc(100vh - 220px)', 
              objectFit: 'contain',
              cursor: isPickingColor ? 'crosshair' : (watermarkSettings.drawingMode ? 'crosshair' : 'default')
            }} 
          />

          {/* Drawing rect highlight overlay */}
          {isDrawingROI && currentDrawRect && canvasRef.current && (
            <div 
              className="roi-box"
              style={{
                left: `${(currentDrawRect.x / canvasDimensions.width) * 100}%`,
                top: `${(currentDrawRect.y / canvasDimensions.height) * 100}%`,
                width: `${(currentDrawRect.w / canvasDimensions.width) * 100}%`,
                height: `${(currentDrawRect.h / canvasDimensions.height) * 100}%`
              }}
            />
          )}

          {/* Existing Watermark Regions Overlays */}
          {!showOriginal && watermarkSettings.regions && watermarkSettings.regions.map(r => (
            <div 
              key={r.id}
              className="roi-box"
              style={{
                left: `${(r.x / canvasDimensions.width) * 100}%`,
                top: `${(r.y / canvasDimensions.height) * 100}%`,
                width: `${(r.w / canvasDimensions.width) * 100}%`,
                height: `${(r.h / canvasDimensions.height) * 100}%`
              }}
            >
              <button 
                className="roi-delete-btn"
                onClick={(e) => { e.stopPropagation(); onRemoveWatermarkRegion(r.id); }}
                title="Remove ROI region"
              >
                ×
              </button>
            </div>
          ))}

          {/* Margin Crop Overlay Lines */}
          {(cropSettings.top > 0 || cropSettings.bottom > 0 || cropSettings.left > 0 || cropSettings.right > 0) && (
            <div style={{
              position: 'absolute',
              inset: 0,
              pointerEvents: 'none',
              borderStyle: 'solid',
              borderColor: 'rgba(239, 68, 68, 0.5)',
              borderTopWidth: `${cropSettings.top}%`,
              borderBottomWidth: `${cropSettings.bottom}%`,
              borderLeftWidth: `${cropSettings.left}%`,
              borderRightWidth: `${cropSettings.right}%`
            }} />
          )}
        </div>
      </div>
    </div>
  );
}
