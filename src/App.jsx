import React, { useState, useRef, useEffect } from 'react';
import VideoUploader from './components/VideoUploader';
import VideoCanvas from './components/VideoCanvas';
import VideoTimeline from './components/Controls/VideoTimeline';
import BackgroundTab from './components/Controls/BackgroundTab';
import WatermarkTab from './components/Controls/WatermarkTab';
import ExportPanel from './components/Controls/ExportPanel';
import { createSampleDemoVideo } from './utils/sampleVideoGenerator';
import { exportToAlphaWebM } from './utils/webmExporter';
import { checkPythonBackendHealth, exportViaPythonBackend, convertToLottieViaPython } from './utils/pythonExporter';
import { applyChromaKey } from './utils/chromaKey';
import { applySmartSegmentation } from './utils/aiSegmenter';
import { applyWatermarkRemoval } from './utils/watermarkRemover';
import { Layers, Eraser } from 'lucide-react';
import confetti from 'canvas-confetti';

export default function App() {
  const [videoFile, setVideoFile] = useState(null);
  const [videoSrc, setVideoSrc] = useState(null);
  const [activeTab, setActiveTab] = useState('background'); // 'background' | 'watermark'

  // Ref hooks
  const videoRef = useRef(null);
  const canvasRef = useRef(null);

  // Processing State
  const [bgSettings, setBgSettings] = useState({
    enabled: true,
    mode: 'chroma', // 'chroma' | 'ai'
    keyColor: '#00ff00',
    similarity: 0.35,
    smoothness: 0.1,
    spill: 0.3,
    aiThreshold: 0.4,
    aiFeather: 0.15,
    aiMode: 'auto',
    bgReplacement: 'transparent'
  });

  const [watermarkSettings, setWatermarkSettings] = useState({
    drawingMode: false,
    defaultMode: 'blur', // 'blur' | 'pixelate' | 'inpaint'
    regions: []
  });

  const [cropSettings, setCropSettings] = useState({
    top: 0,
    bottom: 0,
    left: 0,
    right: 0
  });

  // Export State (inline panel, no modal)
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState({ percent: 0, frame: 0, totalFrames: 0 });
  const [exportResult, setExportResult] = useState(null);
  const exportTaskRef = useRef(null);

  // File loading
  const handleFileSelected = (file) => {
    setVideoFile(file);
    const url = URL.createObjectURL(file);
    setVideoSrc(url);
    setExportResult(null);
    setWatermarkSettings({ drawingMode: false, defaultMode: 'blur', regions: [] });
    setCropSettings({ top: 0, bottom: 0, left: 0, right: 0 });
  };

  const handleLoadSample = async () => {
    const { blob, url } = await createSampleDemoVideo();
    setVideoFile({ name: 'sample_chroma_video.mp4' });
    setVideoSrc(url);
    // Preset a watermark zone on the sample video automatically
    setWatermarkSettings(prev => ({
      ...prev,
      regions: [
        { id: 'sample_roi_1', x: 380, y: 20, w: 240, h: 45, mode: 'blur', blurRadius: 18, pixelSize: 10 }
      ]
    }));
    setExportResult(null);
  };

  const handleReset = () => {
    setVideoFile(null);
    setVideoSrc(null);
    setExportResult(null);
    setWatermarkSettings({ drawingMode: false, defaultMode: 'blur', regions: [] });
    setCropSettings({ top: 0, bottom: 0, left: 0, right: 0 });
  };

  // Watermark ROI state updater helpers
  const handleAddWatermarkRegion = (region) => {
    setWatermarkSettings(prev => ({
      ...prev,
      regions: [...prev.regions, region],
      drawingMode: false
    }));
  };

  const handleRemoveWatermarkRegion = (id) => {
    setWatermarkSettings(prev => ({
      ...prev,
      regions: prev.regions.filter(r => r.id !== id)
    }));
  };

  const handleUpdateWatermarkSettings = (newFields) => {
    setWatermarkSettings(prev => ({ ...prev, ...newFields }));
  };

  // Synchronous Frame Renderer for Exporter
  const renderExportFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState < 2) return;

    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
    }

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // 1. Watermark Removal
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
  };

  // Start Export Process
  const handleStartExport = async ({ fps, format = 'webm', quality = 'balanced', includeAudio = true }) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;

    if (!video || !canvas) return;

    setIsExporting(true);
    setExportProgress({ percent: 0, frame: 0, totalFrames: 0 });

    const startTime = Date.now();

    const isPythonHealthy = await checkPythonBackendHealth();

    if (isPythonHealthy) {
      exportTaskRef.current = { cancel: () => {} };
      exportViaPythonBackend({
        videoFile,
        videoElement: video,
        bgSettings,
        watermarkSettings,
        cropSettings,
        format,
        fps,
        quality,
        includeAudio,
        onProgress: (progress) => {
          setExportProgress(progress);
        },
        onComplete: (blob, url, actualExt, durationSec) => {
          setIsExporting(false);
          const finalDuration = durationSec || ((Date.now() - startTime) / 1000).toFixed(1);
          setExportResult({ url, ext: actualExt, durationSec: finalDuration, size: blob?.size, engine: 'server' });
        },
        onError: (err) => {
          console.warn("Python export failed, attempting client fallback:", err);
          runClientFallback();
        }
      });
    } else {
      runClientFallback();
    }

    function runClientFallback() {
      // Source bitrate (bits/s) so the browser encoder doesn't overshoot the MP4 size
      const sourceBitrate = (videoFile?.size && video.duration)
        ? Math.round((videoFile.size * 8 / video.duration) * 0.9)
        : 0;
      exportTaskRef.current = exportToAlphaWebM({
        videoElement: video,
        canvasElement: canvas,
        renderFrameFn: renderExportFrame,
        fps,
        format,
        quality,
        sourceBitrate,
        includeAudio,
        onProgress: (progress) => {
          setExportProgress(progress);
        },
        onComplete: (blob, url, actualExt) => {
          setIsExporting(false);
          const finalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
          setExportResult({ url, ext: actualExt, durationSec: finalDuration, size: blob?.size, engine: 'browser' });
        },
        onError: (err) => {
          console.error("Export error:", err);
          setIsExporting(false);
          alert("Export failed: " + err.message);
        }
      });
    }
  };

  const handleConvertToLottie = async () => {
    const video = videoRef.current;
    const { url, durationSec } = await convertToLottieViaPython({
      videoFile,
      videoElement: video,
      bgSettings,
      completedUrl: exportResult?.url
    });

    const a = document.createElement('a');
    a.href = url;
    const baseName = videoFile?.name ? videoFile.name.replace(/\.[^/.]+$/, "") : "transparent_lottie";
    a.download = `${baseName}_lottie.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    confetti({
      particleCount: 120,
      spread: 80,
      origin: { y: 0.6 }
    });

    return { url, durationSec };
  };

  return (
    <div style={{ height: '100vh', maxHeight: '100vh', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      {/* Hidden HTML5 Video element for frame decoding - Auto seek to 0.05s so preview is non-empty */}
      {videoSrc && (
        <video 
          ref={videoRef}
          src={videoSrc}
          crossOrigin="anonymous"
          playsInline
          muted
          loop
          onLoadedMetadata={(e) => {
            if (e.target.currentTime === 0) {
              e.target.currentTime = 0.05;
            }
          }}
          style={{ display: 'none' }}
        />
      )}

      {/* Primary Layout */}
      {!videoSrc ? (
        <VideoUploader 
          onFileSelected={handleFileSelected} 
          onLoadSample={handleLoadSample} 
        />
      ) : (
        <main style={{ 
          flex: 1, 
          padding: '1rem', 
          display: 'grid', 
          gridTemplateColumns: 'minmax(0, 1fr) 340px', 
          gap: '1rem',
          maxWidth: '1600px',
          margin: '0 auto',
          width: '100%',
          minHeight: 0,
          overflow: 'hidden'
        }}>
          {/* Left Main Viewport */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', minHeight: 0, overflow: 'hidden' }}>
            <VideoCanvas 
              videoRef={videoRef}
              canvasRef={canvasRef}
              bgSettings={bgSettings}
              watermarkSettings={watermarkSettings}
              cropSettings={cropSettings}
              onAddWatermarkRegion={handleAddWatermarkRegion}
              onUpdateWatermarkRegion={handleUpdateWatermarkSettings}
              onRemoveWatermarkRegion={handleRemoveWatermarkRegion}
              onEyedropperPick={(hex) => setBgSettings(prev => ({ ...prev, keyColor: hex, enabled: true }))}
            />

            <VideoTimeline videoRef={videoRef} />
          </div>

          {/* Right Control Sidebar */}
          <aside className="glass-panel" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.8rem', minHeight: 0, overflow: 'hidden' }}>
            {/* Sidebar Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', background: 'rgba(0,0,0,0.25)', padding: '0.25rem', borderRadius: '10px', flexShrink: 0 }}>
              <button 
                className={`tab-btn ${activeTab === 'background' ? 'active' : ''}`}
                onClick={() => setActiveTab('background')}
                style={{ justifyContent: 'center', fontSize: '0.82rem' }}
              >
                <Layers size={15} />
                Background
              </button>
              <button 
                className={`tab-btn ${activeTab === 'watermark' ? 'active' : ''}`}
                onClick={() => setActiveTab('watermark')}
                style={{ justifyContent: 'center', fontSize: '0.82rem' }}
              >
                <Eraser size={15} />
                Watermark & Crop
              </button>
            </div>

            {/* Tab Panel Content */}
            <div style={{ flex: 1, overflowY: 'auto', paddingRight: '0.2rem', minHeight: 0 }}>
              {activeTab === 'background' ? (
                <BackgroundTab 
                  settings={bgSettings}
                  onChange={(newFields) => setBgSettings(prev => ({ ...prev, ...newFields }))}
                />
              ) : (
                <WatermarkTab 
                  watermarkSettings={watermarkSettings}
                  cropSettings={cropSettings}
                  onUpdateWatermark={handleUpdateWatermarkSettings}
                  onUpdateCrop={(newFields) => setCropSettings(prev => ({ ...prev, ...newFields }))}
                  onRemoveRegion={handleRemoveWatermarkRegion}
                />
              )}
            </div>

            {/* Inline Export: upload, convert & download on the same screen */}
            <ExportPanel
              onStartExport={handleStartExport}
              isExporting={isExporting}
              exportProgress={exportProgress}
              exportResult={exportResult}
              videoName={videoFile?.name}
              inputSize={videoFile?.size}
              onReexport={() => setExportResult(null)}
              onUploadNewVideo={handleFileSelected}
              onReset={handleReset}
            />
          </aside>
        </main>
      )}

    </div>
  );
}
