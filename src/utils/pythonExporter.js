/**
 * Python Backend FFmpeg Exporter
 * Posts video blob + params to Python FastAPI server at http://localhost:8000/api/export
 * Downloads genuine 4-channel transparent WebM (VP9 yuva420p) or MOV (ProRes 4444)
 */

export async function checkPythonBackendHealth() {
  try {
    const res = await fetch('http://localhost:8000/api/health', { method: 'GET' });
    if (!res.ok) return false;
    const data = await res.json();
    return data.status === 'ok' && data.ffmpeg;
  } catch (err) {
    return false;
  }
}

export async function exportViaPythonBackend({
  videoFile,
  videoElement,
  bgSettings,
  watermarkSettings,
  cropSettings,
  format = 'webm',
  fps = 30,
  quality = 'balanced',
  includeAudio = true,
  onProgress,
  onComplete,
  onError
}) {
  try {
    let videoBlob = null;
    
    // If videoFile object exists
    if (videoFile && videoFile instanceof Blob) {
      videoBlob = videoFile;
    } else if (videoElement && videoElement.src) {
      // Fetch src blob if loaded from sample URL
      const response = await fetch(videoElement.src);
      videoBlob = await response.blob();
    }

    if (!videoBlob) {
      throw new Error("No valid video source found for export.");
    }

    const formData = new FormData();
    formData.append('file', videoBlob, videoFile?.name || 'input_video.mp4');
    formData.append('mode', bgSettings.mode || 'chroma');
    formData.append('keyColor', bgSettings.keyColor || '#00ff00');
    formData.append('similarity', bgSettings.similarity ?? 0.4);
    formData.append('smoothness', bgSettings.smoothness ?? 0.1);
    formData.append('spill', bgSettings.spill ?? 0.5);
    formData.append('outputFormat', format); // 'webm' or 'mov'
    formData.append('fps', fps);
    formData.append('quality', quality); // 'small' | 'balanced' | 'high'
    formData.append('includeAudio', includeAudio ? 'true' : 'false');
    formData.append('watermarkRegions', JSON.stringify(watermarkSettings?.regions || []));
    formData.append('cropSettings', JSON.stringify(cropSettings || { top: 0, bottom: 0, left: 0, right: 0 }));

    let currentPercent = 10;
    if (onProgress) {
      onProgress({ percent: currentPercent, frame: currentPercent, totalFrames: 100 });
    }

    const progressTimer = setInterval(() => {
      if (currentPercent < 98) {
        currentPercent += (currentPercent < 80 ? 5 : 1);
        if (onProgress) {
          onProgress({ percent: Math.min(98, currentPercent), frame: currentPercent, totalFrames: 100 });
        }
      }
    }, 200);

    const startTime = Date.now();

    let response;
    try {
      response = await fetch('http://localhost:8000/api/export', {
        method: 'POST',
        body: formData
      });
    } finally {
      clearInterval(progressTimer);
    }

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.detail || `Server returned status ${response.status}`);
    }

    const resultBlob = await response.blob();
    const resultUrl = URL.createObjectURL(resultBlob);

    if (onProgress) {
      onProgress({ percent: 100, frame: 100, totalFrames: 100 });
    }

    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    const actualExt = format === 'mov' ? 'mov' : 'webm';
    onComplete && onComplete(resultBlob, resultUrl, actualExt, durationSec);
  } catch (err) {
    console.error("Python export failed:", err);
    onError && onError(err);
  }
}

export async function convertToLottieViaPython({
  videoFile,
  videoElement,
  bgSettings,
  completedUrl
}) {
  const startTime = Date.now();
  try {
    let inputBlob = null;
    
    if (completedUrl) {
      const res = await fetch(completedUrl);
      inputBlob = await res.blob();
    } else if (videoFile && videoFile instanceof Blob) {
      inputBlob = videoFile;
    } else if (videoElement && videoElement.src) {
      const res = await fetch(videoElement.src);
      inputBlob = await res.blob();
    }

    if (!inputBlob) {
      throw new Error("No video source available for Lottie conversion.");
    }

    const formData = new FormData();
    formData.append('file', inputBlob, 'input_video.webm');
    formData.append('mode', bgSettings?.mode || 'chroma');
    formData.append('keyColor', bgSettings?.keyColor || '#00ff00');
    formData.append('similarity', bgSettings?.similarity ?? 0.4);
    formData.append('smoothness', bgSettings?.smoothness ?? 0.1);
    formData.append('spill', bgSettings?.spill ?? 0.5);

    const response = await fetch('http://localhost:8000/api/convert-lottie', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson.detail || `Lottie conversion failed with status ${response.status}`);
    }

    const jsonBlob = await response.blob();
    const jsonUrl = URL.createObjectURL(jsonBlob);
    const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
    return { blob: jsonBlob, url: jsonUrl, durationSec };
  } catch (err) {
    console.error("Lottie conversion failed:", err);
    throw err;
  }
}
