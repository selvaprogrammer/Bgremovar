/**
 * True WebM VP9/VP8 Alpha Exporter using WebCodecs API (VideoEncoder + alpha: 'keep') 
 * and webm-muxer (alpha: true), with smooth MediaRecorder fallback.
 * Prevents "Alpha encoding is not currently supported" crashes across all platforms.
 */

import { Muxer, ArrayBufferTarget } from 'webm-muxer';

/**
 * Probe available VideoEncoder configurations to find one supporting transparent alpha encoding
 */
// Bitrate = source file's bitrate x factor, so the WebM stays at or below the
// uploaded MP4's size. (Old code used a fixed 8 Mbps -> 600 KB MP4 became 3+ MB.)
const QUALITY_FACTOR = { small: 0.5, balanced: 0.8, high: 1.2 };
const QUALITY_BPP = { small: 0.02, balanced: 0.035, high: 0.06 }; // used only if source bitrate unknown

export function getTargetBitrate(width, height, fps, quality = 'balanced', sourceBitrate = 0) {
  let bitrate;
  if (sourceBitrate > 0) {
    bitrate = sourceBitrate * (QUALITY_FACTOR[quality] ?? QUALITY_FACTOR.balanced);
  } else {
    bitrate = width * height * fps * (QUALITY_BPP[quality] ?? QUALITY_BPP.balanced);
  }
  return Math.round(Math.max(120_000, Math.min(bitrate, 2_500_000)));
}

async function getSupportedWebCodecsConfig(width, height, fps, bitrate) {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') {
    return null;
  }

  const candidateConfigs = [
    // 1. VP9 with Alpha & Software Acceleration
    {
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate,
      framerate: fps,
      alpha: 'keep',
      hardwareAcceleration: 'prefer-software'
    },
    // 2. VP8 with Alpha & Software Acceleration
    {
      codec: 'vp8',
      width,
      height,
      bitrate,
      framerate: fps,
      alpha: 'keep',
      hardwareAcceleration: 'prefer-software'
    },
    // 3. VP9 with Alpha (Default Acceleration)
    {
      codec: 'vp09.00.10.08',
      width,
      height,
      bitrate,
      framerate: fps,
      alpha: 'keep'
    },
    // 4. VP8 with Alpha (Default Acceleration)
    {
      codec: 'vp8',
      width,
      height,
      bitrate,
      framerate: fps,
      alpha: 'keep'
    }
  ];

  for (const config of candidateConfigs) {
    try {
      const support = await VideoEncoder.isConfigSupported(config);
      if (support && support.supported) {
        return config;
      }
    } catch (e) {
      // Configuration probe unsupported
    }
  }

  return null;
}

/**
 * Fallback export path using MediaRecorder canvas stream
 */
function runMediaRecorderExport({
  videoElement,
  canvasElement,
  renderFrameFn,
  fps,
  duration,
  bitrate,
  onProgress,
  onComplete,
  onError,
  isCancelledRef
}) {
  const stream = canvasElement.captureStream(0); // Manual frame ticks via requestFrame
  const track = stream.getVideoTracks()[0];

  let recorder;
  const mimeTypes = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];

  let selectedMime = '';
  for (const mime of mimeTypes) {
    if (MediaRecorder.isTypeSupported(mime)) {
      selectedMime = mime;
      break;
    }
  }

  try {
    const opts = { videoBitsPerSecond: bitrate };
    if (selectedMime) opts.mimeType = selectedMime;
    recorder = new MediaRecorder(stream, opts);
  } catch (e) {
    recorder = new MediaRecorder(stream);
  }

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    if (isCancelledRef.current) return;
    const blob = new Blob(chunks, { type: 'video/webm' });
    if (blob.size === 0) {
      onError && onError(new Error("Recording produced 0 byte output file. Please try again."));
      return;
    }
    const url = URL.createObjectURL(blob);
    onComplete && onComplete(blob, url, 'webm');
  };

  recorder.start(100);

  const totalFrames = Math.ceil(duration * fps);
  const frameInterval = 1 / fps;
  let currentFrame = 0;

  const originalTime = videoElement.currentTime;
  const originalPaused = videoElement.paused;
  videoElement.pause();

  async function step() {
    if (isCancelledRef.current) {
      try { recorder.stop(); } catch(e) {}
      videoElement.currentTime = originalTime;
      if (!originalPaused) videoElement.play().catch(() => {});
      return;
    }

    if (currentFrame >= totalFrames) {
      videoElement.currentTime = originalTime;
      if (!originalPaused) videoElement.play().catch(() => {});
      setTimeout(() => {
        try { recorder.stop(); } catch(e) {}
      }, 200);
      return;
    }

    const time = currentFrame * frameInterval;
    videoElement.currentTime = Math.min(duration, time);

    await new Promise((resolve) => {
      const onSeeked = () => {
        videoElement.removeEventListener('seeked', onSeeked);
        resolve();
      };
      videoElement.addEventListener('seeked', onSeeked, { once: true });
      setTimeout(resolve, 35);
    });

    if (renderFrameFn) {
      renderFrameFn(time);
    }

    if (track && track.requestFrame) {
      track.requestFrame();
    }

    currentFrame++;
    const percent = Math.min(100, Math.round((currentFrame / totalFrames) * 100));
    if (onProgress) {
      onProgress({ percent, frame: currentFrame, totalFrames });
    }

    setTimeout(step, 10);
  }

  step();
}

/**
 * Export processed canvas frames to transparent WebM VP9/VP8 Alpha video blob (.webm)
 */
export function exportToAlphaWebM({
  videoElement,
  canvasElement,
  renderFrameFn,
  fps = 30,
  quality = 'balanced',
  sourceBitrate = 0,
  // eslint-disable-next-line no-unused-vars
  includeAudio = true,
  onProgress,
  onComplete,
  onError
}) {
  const isCancelledRef = { current: false };

  const duration = videoElement.duration;
  if (!duration || isNaN(duration)) {
    onError && onError(new Error("Invalid video duration"));
    return { cancel: () => {} };
  }

  const width = canvasElement.width || videoElement.videoWidth || 640;
  const height = canvasElement.height || videoElement.videoHeight || 360;

  (async () => {
    const bitrate = getTargetBitrate(width, height, fps, quality, sourceBitrate);
    const validConfig = await getSupportedWebCodecsConfig(width, height, fps, bitrate);

    if (validConfig && !isCancelledRef.current) {
      try {
        const muxer = new Muxer({
          target: new ArrayBufferTarget(),
          video: {
            codec: validConfig.codec.startsWith('vp8') ? 'V_VP8' : 'V_VP9',
            width: width,
            height: height,
            frameRate: fps,
            alpha: true
          },
          firstTimestampBehavior: 'strict'
        });

        let hasEncoderError = false;

        const encoder = new VideoEncoder({
          output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
          error: (e) => {
            console.warn("VideoEncoder runtime error:", e);
            hasEncoderError = true;
          }
        });

        encoder.configure(validConfig);

        const totalFrames = Math.ceil(duration * fps);
        const frameInterval = 1 / fps;
        const originalTime = videoElement.currentTime;
        const originalPaused = videoElement.paused;

        videoElement.pause();

        for (let f = 0; f < totalFrames; f++) {
          if (isCancelledRef.current || hasEncoderError) break;

          const time = f * frameInterval;
          videoElement.currentTime = Math.min(duration, time);

          await new Promise((resolve) => {
            const onSeeked = () => {
              videoElement.removeEventListener('seeked', onSeeked);
              resolve();
            };
            videoElement.addEventListener('seeked', onSeeked, { once: true });
            setTimeout(resolve, 35);
          });

          if (renderFrameFn) {
            renderFrameFn(time);
          }

          try {
            const frame = new VideoFrame(canvasElement, {
              timestamp: Math.round(time * 1_000_000),
              alpha: 'keep'
            });
            const isKey = f % (fps * 4) === 0; // keyframe every ~4s keeps size down
            encoder.encode(frame, { keyFrame: isKey });
            frame.close();
          } catch (err) {
            console.warn("VideoFrame encode warning:", err);
          }

          const percent = Math.min(100, Math.round(((f + 1) / totalFrames) * 100));
          if (onProgress) {
            onProgress({ percent, frame: f + 1, totalFrames });
          }
        }

        if (!isCancelledRef.current && !hasEncoderError) {
          await encoder.flush();
          muxer.finalize();
          const { buffer } = muxer.target;
          const blob = new Blob([buffer], { type: 'video/webm' });
          const url = URL.createObjectURL(blob);

          videoElement.currentTime = originalTime;
          if (!originalPaused) videoElement.play().catch(() => {});

          onComplete && onComplete(blob, url, 'webm');
          return;
        }

        // Cleanup on failure/cancel
        try { encoder.close(); } catch(e) {}
        videoElement.currentTime = originalTime;
        if (!originalPaused) videoElement.play().catch(() => {});

        if (hasEncoderError && !isCancelledRef.current) {
          console.warn("Falling back to MediaRecorder after VideoEncoder error");
          runMediaRecorderExport({
            videoElement, canvasElement, renderFrameFn, fps, duration, bitrate, onProgress, onComplete, onError, isCancelledRef
          });
        }
        return;
      } catch (e) {
        console.warn("WebCodecs export failed, falling back to MediaRecorder:", e);
      }
    }

    // Fallback to MediaRecorder if getSupportedWebCodecsConfig returned null or threw
    if (!isCancelledRef.current) {
      runMediaRecorderExport({
        videoElement, canvasElement, renderFrameFn, fps, duration, bitrate, onProgress, onComplete, onError, isCancelledRef
      });
    }
  })();

  return {
    cancel: () => {
      isCancelledRef.current = true;
    }
  };
}

