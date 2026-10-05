/**
 * Generate a sample MP4/WebM video blob dynamically using Canvas animation & MediaRecorder
 * for instant 1-click demo testing!
 */

export function createSampleDemoVideo() {
  return new Promise((resolve) => {
    const canvas = document.createElement('canvas');
    canvas.width = 640;
    canvas.height = 360;
    const ctx = canvas.getContext('2d');

    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];

    recorder.ondataavailable = (e) => chunks.push(e.data);
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const url = URL.createObjectURL(blob);
      resolve({ blob, url });
    };

    let frame = 0;
    const totalFrames = 150; // 5 seconds at 30 fps

    recorder.start();

    function drawFrame() {
      if (frame >= totalFrames) {
        recorder.stop();
        return;
      }

      // Bright green background (Chroma key sample)
      ctx.fillStyle = '#00ff00';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Bouncing glowing gradient character/circle
      const t = frame / 30;
      const x = 320 + Math.sin(t * 2) * 180;
      const y = 180 + Math.cos(t * 3) * 80;
      const radius = 50 + Math.sin(t * 4) * 10;

      // Glow effect
      ctx.save();
      ctx.shadowColor = '#06B6D4';
      ctx.shadowBlur = 25;

      // Character body
      const grad = ctx.createRadialGradient(x, y, 5, x, y, radius);
      grad.addColorStop(0, '#FFFFFF');
      grad.addColorStop(0.5, '#06B6D4');
      grad.addColorStop(1, '#8B5CF6');

      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Sample Watermark text on top right
      ctx.save();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.font = 'bold 22px sans-serif';
      ctx.fillText('SAMPLE WATERMARK', 380, 50);
      ctx.restore();

      frame++;
      requestAnimationFrame(drawFrame);
    }

    drawFrame();
  });
}
