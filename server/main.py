import os
import sys
import tempfile
import subprocess
import shutil
import asyncio
from typing import Optional

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
import base64
import json
import numpy as np
import cv2

try:
    from PIL import Image
    from rembg import remove, new_session
    REMBG_AVAILABLE = True
except Exception as e:
    REMBG_AVAILABLE = False
    print(f"Warning: rembg not initialized yet: {e}")

app = FastAPI(title="AlphaStudio FFmpeg & AI Background Removal Server")

# Enable CORS for React frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Global rembg session cache
rembg_session = None

def get_rembg_session():
    global rembg_session
    if REMBG_AVAILABLE and rembg_session is None:
        try:
            rembg_session = new_session('u2net')
        except Exception as e:
            print(f"Error loading rembg session: {e}")
    return rembg_session


@app.get("/api/health")
def health_check():
    ffmpeg_installed = shutil.which("ffmpeg") is not None
    return {
        "status": "ok",
        "ffmpeg": ffmpeg_installed,
        "rembg": REMBG_AVAILABLE
    }


# ---------------------------------------------------------------------------
# Encoding presets
# CRF (constant quality) + a bitrate CAP derived from the source file, so the
# transparent WebM stays around (or below) the size of the uploaded MP4.
# ---------------------------------------------------------------------------
VP9_QUALITY_PRESETS = {
    #            crf   cap = source video bitrate x factor   audio
    "small":    {"crf": 40, "cap_factor": 0.5, "audio": "32k"},
    "balanced": {"crf": 35, "cap_factor": 0.8, "audio": "48k"},
    "high":     {"crf": 30, "cap_factor": 1.2, "audio": "96k"},
}


def probe_video_bitrate(path: str, duration_hint: float = 0.0) -> int:
    """Video-stream bitrate (bits/s) of the uploaded file. Falls back to file size / duration."""
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-select_streams", "v:0",
             "-show_entries", "stream=bit_rate:format=bit_rate,duration", "-of", "json", path],
            capture_output=True, text=True, timeout=20
        ).stdout
        info = json.loads(out or "{}")
        stream_br = (info.get("streams") or [{}])[0].get("bit_rate")
        if stream_br and str(stream_br).isdigit():
            return int(stream_br)
        fmt = info.get("format") or {}
        if fmt.get("bit_rate") and str(fmt["bit_rate"]).isdigit():
            return int(int(fmt["bit_rate"]) * 0.9)
        dur = float(fmt.get("duration") or duration_hint or 0)
        if dur > 0:
            return int(os.path.getsize(path) * 8 / dur * 0.9)
    except Exception as e:
        print(f"ffprobe bitrate probe failed: {e}")
    return 0


def vp9_encode_args(quality: str, fps: Optional[float] = None, source_bitrate: int = 0):
    preset = VP9_QUALITY_PRESETS.get(quality, VP9_QUALITY_PRESETS["balanced"])
    gop = int(max(1, (fps or 30)) * 8)  # keyframe every ~8s
    cap = int(source_bitrate * preset["cap_factor"]) if source_bitrate > 0 else 0
    cap = max(cap, 120_000) if cap else 0
    return [
        "-c:v", "libvpx-vp9",
        "-crf", str(preset["crf"]),
        "-b:v", f"{cap // 1000}k" if cap else "0",   # constrained quality: never above cap
        "-deadline", "good",
        "-cpu-used", "5",
        "-row-mt", "1",
        "-threads", "0",
        "-g", str(gop),
        "-metadata:s:v:0", "alpha_mode=1",
    ]


def audio_args(include_audio: bool, quality: str):
    if not include_audio:
        return ["-an"]
    preset = VP9_QUALITY_PRESETS.get(quality, VP9_QUALITY_PRESETS["balanced"])
    return ["-c:a", "libopus", "-b:a", preset["audio"]]


def hex_to_rgb(hex_str: str):
    hex_clean = hex_str.lstrip('#')
    if len(hex_clean) == 3:
        hex_clean = ''.join([c*2 for c in hex_clean])
    return tuple(int(hex_clean[i:i+2], 16) for i in (0, 2, 4))


def process_chroma_key(img_bgr, key_rgb, similarity=0.35, smoothness=0.1, spill=0.3):
    """
    Green / blue screen key  (input BGR uint8 -> output RGBA uint8).

    A pixel is removed ONLY when
      1. the screen channel (G for green screen) clearly dominates R and B, AND
      2. its hue is close to the screen's hue.
    So yellow, lime, teal, cyan, skin, white, black, etc. are never removed.
    (Old version used plain RGB distance from #00ff00, which also ate teal / lime /
    dark tones.)

    Size optimisations: tiny alpha noise is snapped to 0/255 and fully transparent
    pixels are painted flat black, so VP9 doesn't waste bits on hidden green noise.
    """
    kr, kg, kb = [float(v) for v in key_rgb]
    img = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    r, g, b = img[..., 0], img[..., 1], img[..., 2]

    if kg >= kr and kg >= kb:            # green screen -> hue offset from (B - R)
        ch, main, a1, a2 = 1, g, r, b
        k_off = 60.0 * (kb - kr) / max(kg - min(kr, kb), 1.0)
    elif kb >= kr and kb >= kg:          # blue screen -> hue offset from (R - G)
        ch, main, a1, a2 = 2, b, g, r
        k_off = 60.0 * (kr - kg) / max(kb - min(kr, kg), 1.0)
    else:
        return _distance_key(img, key_rgb, similarity, smoothness)

    other_max = np.maximum(a1, a2)
    other_min = np.minimum(a1, a2)
    dom = main - other_max

    # 1) dominance: how strongly the screen channel beats the other two
    d_lo = 40.0 * (1.0 - similarity)
    d_hi = d_lo + 10.0 + smoothness * 60.0
    dom_f = np.clip((dom - d_lo) / (d_hi - d_lo), 0.0, 1.0)

    # 2) hue closeness to the key colour
    off = 60.0 * (a2 - a1) / np.maximum(main - other_min, 1.0)
    dh = np.abs(off - k_off)
    tol = 8.0 + similarity * 30.0
    feather = 6.0 + smoothness * 30.0
    hue_f = np.clip(1.0 - (dh - tol) / feather, 0.0, 1.0)
    hue_f[dom <= 0] = 0.0

    alpha = 1.0 - dom_f * hue_f
    alpha[alpha < 0.06] = 0.0
    alpha[alpha > 0.94] = 1.0

    out = img
    if spill > 0:  # despill only semi-transparent edge pixels
        m = (alpha > 0) & (alpha < 1) & (dom > 0)
        out[..., ch] = np.where(m, other_max + (1.0 - spill) * dom, main)
    out = np.clip(out, 0, 255).astype(np.uint8)
    a8 = (alpha * 255).astype(np.uint8)
    out[a8 == 0] = 0
    return np.dstack((out, a8))


def _distance_key(img_rgb_f32, key_rgb, similarity, smoothness):
    """Fallback for key colours that are neither green nor blue."""
    kr, kg, kb = key_rgb
    d = np.sqrt((img_rgb_f32[..., 0] - kr) ** 2 + (img_rgb_f32[..., 1] - kg) ** 2 + (img_rgb_f32[..., 2] - kb) ** 2) / 441.67
    thresh = max(0.03, similarity * 0.5)
    feather = thresh + max(0.01, smoothness)
    alpha = np.clip((d - thresh) / (feather - thresh), 0.0, 1.0)
    alpha[alpha < 0.06] = 0.0
    alpha[alpha > 0.94] = 1.0
    out = img_rgb_f32.astype(np.uint8)
    a8 = (alpha * 255).astype(np.uint8)
    out[a8 == 0] = 0
    return np.dstack((out, a8))


def apply_opencv_watermark_and_crop(frame, regions, crops):
    """
    Applies OpenCV Telea Inpainting to watermark ROIs and crops image margins
    without removing or blurring underlying background objects.
    """
    if frame is None:
        return frame

    h_img, w_img = frame.shape[:2]

    # 1. Apply Watermark Removal Regions
    if regions and isinstance(regions, list):
        for r in regions:
            rx = int(r.get("x", 0))
            ry = int(r.get("y", 0))
            rw = int(r.get("w", 0))
            rh = int(r.get("h", 0))
            mode = r.get("mode", "inpaint")
            blur_radius = int(r.get("blurRadius", 15))
            pixel_size = int(r.get("pixelSize", 10))

            if rw <= 0 or rh <= 0:
                continue

            rx = max(0, min(w_img - 1, rx))
            ry = max(0, min(h_img - 1, ry))
            rw = min(w_img - rx, rw)
            rh = min(h_img - ry, rh)

            if rw <= 0 or rh <= 0:
                continue

            roi = frame[ry:ry+rh, rx:rx+rw]

            if mode in ["inpaint", "patch"]:
                # High-precision OpenCV Telea Inpainting
                mask = np.zeros((h_img, w_img), dtype=np.uint8)
                gray_roi = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
                mean_val = float(np.mean(gray_roi))
                std_val = float(np.std(gray_roi))

                if std_val > 8:
                    diff = cv2.absdiff(gray_roi, int(mean_val))
                    _, text_mask = cv2.threshold(diff, int(max(10, std_val * 0.4)), 255, cv2.THRESH_BINARY)
                    kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
                    text_mask = cv2.dilate(text_mask, kernel, iterations=2)
                    mask[ry:ry+rh, rx:rx+rw] = text_mask
                else:
                    mask[ry:ry+rh, rx:rx+rw] = 255

                # Perform Telea Inpainting to preserve background object structure
                frame = cv2.inpaint(frame, mask, inpaintRadius=5, flags=cv2.INPAINT_TELEA)

            elif mode == "blur":
                ksize = max(3, blur_radius | 1)
                blurred_roi = cv2.GaussianBlur(roi, (ksize, ksize), 0)
                frame[ry:ry+rh, rx:rx+rw] = blurred_roi

            elif mode == "pixelate":
                p_size = max(2, pixel_size)
                small_w = max(1, rw // p_size)
                small_h = max(1, rh // p_size)
                small_roi = cv2.resize(roi, (small_w, small_h), interpolation=cv2.INTER_NEAREST)
                pixelated_roi = cv2.resize(small_roi, (rw, rh), interpolation=cv2.INTER_NEAREST)
                frame[ry:ry+rh, rx:rx+rw] = pixelated_roi

    # 2. Apply Crop Margins
    if crops and isinstance(crops, dict):
        top_pct = float(crops.get("top", 0))
        bot_pct = float(crops.get("bottom", 0))
        left_pct = float(crops.get("left", 0))
        right_pct = float(crops.get("right", 0))

        if top_pct > 0 or bot_pct > 0 or left_pct > 0 or right_pct > 0:
            c_top = int((top_pct / 100.0) * h_img)
            c_bot = int((bot_pct / 100.0) * h_img)
            c_left = int((left_pct / 100.0) * w_img)
            c_right = int((right_pct / 100.0) * w_img)

            c_h = max(1, h_img - c_top - c_bot)
            c_w = max(1, w_img - c_left - c_right)

            frame = frame[c_top:c_top+c_h, c_left:c_left+c_w]

    return frame


@app.post("/api/export")
async def export_video(
    file: UploadFile = File(...),
    mode: str = Form("chroma"), # "chroma" or "ai"
    keyColor: str = Form("#00ff00"),
    similarity: float = Form(0.35),
    smoothness: float = Form(0.1),
    spill: float = Form(0.3),
    outputFormat: str = Form("webm"), # "webm" or "mov"
    fps: int = Form(30),
    quality: str = Form("balanced"),  # "small" | "balanced" | "high"
    includeAudio: str = Form("true"),
    watermarkRegions: str = Form("[]"),
    cropSettings: str = Form("{}")
):
    include_audio = str(includeAudio).lower() in ("1", "true", "yes", "on")
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="FFmpeg is not installed on server system")

    try:
        parsed_regions = json.loads(watermarkRegions) if watermarkRegions else []
    except Exception:
        parsed_regions = []
    try:
        parsed_crops = json.loads(cropSettings) if cropSettings else {}
    except Exception:
        parsed_crops = {}

    has_watermark = bool(parsed_regions)
    has_crop = bool(parsed_crops and any(v > 0 for v in parsed_crops.values() if isinstance(v, (int, float))))

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = os.path.join(temp_dir, "input_video")
        with open(input_path, "wb") as f:
            f.write(await file.read())

        cap = cv2.VideoCapture(input_path)
        if not cap.isOpened():
            raise HTTPException(status_code=400, detail="Unable to read uploaded video file")
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
        video_fps = cap.get(cv2.CAP_PROP_FPS) or fps
        total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        cap.release()
        if width <= 0 or height <= 0:
            raise HTTPException(status_code=400, detail="Invalid video dimensions")

        source_bitrate = probe_video_bitrate(input_path, total_frames / video_fps if video_fps else 0)

        ext = "webm" if outputFormat == "webm" else "mov"
        output_filename = f"transparent_export.{ext}"
        output_path = os.path.join(temp_dir, output_filename)
        key_rgb = hex_to_rgb(keyColor)

        # Only ever reduce frame rate (higher fps = bigger file)
        out_fps = min(float(fps), float(video_fps)) if fps else float(video_fps)
        fps_filter = [f"fps={out_fps:g}"] if fps and fps < video_fps - 0.5 else []

        # Output size after crop (even numbers required by yuva420p)
        out_w, out_h = width, height
        if has_crop:
            c_top = int((float(parsed_crops.get("top", 0)) / 100.0) * height)
            c_bot = int((float(parsed_crops.get("bottom", 0)) / 100.0) * height)
            c_left = int((float(parsed_crops.get("left", 0)) / 100.0) * width)
            c_right = int((float(parsed_crops.get("right", 0)) / 100.0) * width)
            out_w = max(2, width - c_left - c_right)
            out_h = max(2, height - c_top - c_bot)
        enc_w, enc_h = out_w // 2 * 2, out_h // 2 * 2

        common_in = [
            "ffmpeg", "-y", "-loglevel", "error",
            "-f", "rawvideo", "-vcodec", "rawvideo", "-pix_fmt", "rgba",
            "-s", f"{enc_w}x{enc_h}", "-r", f"{float(video_fps):g}",
            "-i", "pipe:0",
            "-i", input_path,                 # 2nd input = original audio
            "-map", "0:v:0",
            *(["-map", "1:a:0?"] if include_audio else []),
            *(["-vf", ",".join(fps_filter)] if fps_filter else []),
        ]
        if outputFormat == "webm":
            ffmpeg_cmd = common_in + [
                "-pix_fmt", "yuva420p",
                *vp9_encode_args(quality, out_fps, source_bitrate),
                *audio_args(include_audio, quality),
                "-shortest", output_path,
            ]
        else:
            ffmpeg_cmd = common_in + [
                "-c:v", "prores_ks", "-profile:v", "4", "-pix_fmt", "yuva444p10le",
                *(["-c:a", "pcm_s16le"] if include_audio else ["-an"]),
                "-shortest", output_path,
            ]

        use_ai = mode == "ai" and REMBG_AVAILABLE
        session = get_rembg_session() if use_ai else None

        def process_frame(frame_bgr):
            if has_watermark or has_crop:
                frame_bgr = apply_opencv_watermark_and_crop(frame_bgr, parsed_regions, parsed_crops)
            if use_ai:
                pil_img = Image.fromarray(cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB))
                rgba = np.array(remove(pil_img, session=session) if session else remove(pil_img))
            else:
                rgba = process_chroma_key(frame_bgr, key_rgb, similarity, smoothness, spill)
            if rgba.shape[1] != enc_w or rgba.shape[0] != enc_h:
                rgba = rgba[:enc_h, :enc_w]
            return np.ascontiguousarray(rgba).tobytes()

        def run_pipeline():
            from concurrent.futures import ThreadPoolExecutor
            from collections import deque
            workers = 1 if use_ai else max(1, (os.cpu_count() or 2))
            proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)
            cap = cv2.VideoCapture(input_path)
            try:
                with ThreadPoolExecutor(max_workers=workers) as pool:
                    pending = deque()
                    while True:
                        ok, frame = cap.read()
                        if not ok:
                            break
                        pending.append(pool.submit(process_frame, frame))
                        if len(pending) >= workers * 2:          # keep order, bounded memory
                            proc.stdin.write(pending.popleft().result())
                    while pending:
                        proc.stdin.write(pending.popleft().result())
                proc.stdin.close()
                err = proc.stderr.read().decode(errors="ignore")
                proc.wait()
                if proc.returncode != 0:
                    raise RuntimeError(err[-800:])
            except Exception:
                try: proc.kill()
                except Exception: pass
                raise
            finally:
                cap.release()

        try:
            await asyncio.to_thread(run_pipeline)
        except Exception as err:
            raise HTTPException(status_code=500, detail=f"Frame processing error: {err}")

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise HTTPException(status_code=500, detail="FFmpeg encoding failed to generate file output")

        final_temp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
        with open(output_path, "rb") as out_f:
            final_temp.write(out_f.read())
        final_temp.close()

        return FileResponse(
            path=final_temp.name,
            filename=output_filename,
            media_type="video/webm" if outputFormat == "webm" else "video/quicktime",
            headers={"X-Source-Bitrate": str(source_bitrate)},
            background=BackgroundTasks()
        )


@app.post("/api/convert-lottie")
async def convert_to_lottie(
    file: UploadFile = File(...),
    mode: str = Form("chroma"),
    keyColor: str = Form("#00ff00"),
    similarity: float = Form(0.4),
    smoothness: float = Form(0.1),
    spill: float = Form(0.5),
    maxDimension: int = Form(512)
):
    """
    High-Speed Raster-based Lottie JSON converter via FFmpeg RGBA PNG Extraction.
    Extracts continuous RGBA transparent PNG frames with 100% genuine alpha channel
    and packages them into base64 Lottie JSON animation assets.
    """
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="FFmpeg is not installed on server system")

    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = os.path.join(temp_dir, "input_lottie_source")
        with open(input_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Probe video parameters
        cap = cv2.VideoCapture(input_path)
        orig_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)) or 640
        orig_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)) or 360
        video_fps = int(cap.get(cv2.CAP_PROP_FPS)) or 30
        cap.release()

        if orig_w <= 0 or orig_h <= 0:
            raise HTTPException(status_code=400, detail="Invalid video dimensions")

        # Downscale target dimension to keep Lottie JSON file size under 1-3MB
        scale_dim = max(320, min(maxDimension, 512))
        scale = 1.0
        if max(orig_w, orig_h) > scale_dim:
            scale = scale_dim / float(max(orig_w, orig_h))
            
        target_w = int(orig_w * scale)
        target_h = int(orig_h * scale)
        target_w += (target_w % 2)
        target_h += (target_h % 2)

        png_dir = os.path.join(temp_dir, "frames")
        os.makedirs(png_dir, exist_ok=True)

        key_rgb = hex_to_rgb(keyColor)
        key_r, key_g, key_b = key_rgb
        key_color_hex = keyColor.replace("#", "0x")

        # Extract 4-channel RGBA transparent PNG sequence
        # Try VP9 WebM alpha decoder first if file is transparent WebM
        cmd_webm = [
            "ffmpeg", "-y",
            "-c:v", "libvpx-vp9",
            "-i", input_path,
            "-vf", f"scale=w={target_w}:h={target_h}:flags=lanczos,format=rgba",
            os.path.join(png_dir, "frame_%04d.png")
        ]

        # Chroma key extraction command if file is raw video
        vf_filters = []
        if mode == "chroma":
            vf_filters.append(f"colorkey={key_color_hex}:{similarity}:{smoothness}")
            if spill > 0:
                spill_type = "green" if (key_g >= key_r and key_g >= key_b) else "blue"
                vf_filters.append(f"despill=type={spill_type}:mix={spill}")
        vf_filters.append(f"scale=w={target_w}:h={target_h}:flags=lanczos")
        vf_filters.append("format=rgba")

        cmd_chroma = [
            "ffmpeg", "-y",
            "-i", input_path,
            "-vf", ",".join(vf_filters),
            os.path.join(png_dir, "frame_%04d.png")
        ]

        # Attempt VP9 WebM alpha decode first
        proc = subprocess.run(cmd_webm, capture_output=True, text=True)
        png_files = sorted([os.path.join(png_dir, f) for f in os.listdir(png_dir) if f.endswith(".png")])

        if proc.returncode != 0 or len(png_files) == 0:
            # Fallback to chroma key extraction
            subprocess.run(cmd_chroma, capture_output=True)
            png_files = sorted([os.path.join(png_dir, f) for f in os.listdir(png_dir) if f.endswith(".png")])

        if not png_files:
            raise HTTPException(status_code=500, detail="Failed to extract RGBA frames for Lottie conversion")

        assets = []
        layers = []

        import io
        for idx, png_path in enumerate(png_files):
            # Encode as transparent PNG Base64 with PIL optimization for 100% universal Lottie player transparency
            try:
                im = Image.open(png_path)
                out_io = io.BytesIO()
                im.save(out_io, format="PNG", optimize=True)
                b64_str = base64.b64encode(out_io.getvalue()).decode("utf-8")
            except Exception:
                with open(png_path, "rb") as pf:
                    b64_str = base64.b64encode(pf.read()).decode("utf-8")

            asset_id = f"img_{idx}"
            assets.append({
                "id": asset_id,
                "w": target_w,
                "h": target_h,
                "u": "",
                "p": f"data:image/png;base64,{b64_str}",
                "e": 1
            })

            layers.append({
                "ddd": 0,
                "ind": idx + 1,
                "ty": 2, # Image Layer
                "name": f"Frame_{idx}",
                "refId": asset_id,
                "sr": 1,
                "ks": {
                    "o": {"a": 0, "k": 100},
                    "r": {"a": 0, "k": 0},
                    "p": {"a": 0, "k": [target_w / 2, target_h / 2, 0]},
                    "a": {"a": 0, "k": [target_w / 2, target_h / 2, 0]},
                    "s": {"a": 0, "k": [100, 100, 100]}
                },
                "ao": 0,
                "ip": idx,
                "op": idx + 1,
                "st": idx,
                "bm": 0
            })

        lottie_json = {
            "v": "5.7.0",
            "fr": video_fps,
            "ip": 0,
            "op": len(png_files),
            "w": target_w,
            "h": target_h,
            "nm": "AlphaStudio Transparent Lottie Animation",
            "ddd": 0,
            "assets": assets,
            "layers": layers
        }

        output_json_path = os.path.join(temp_dir, "transparent_lottie.json")
        with open(output_json_path, "w", encoding="utf-8") as f_out:
            json.dump(lottie_json, f_out)

        final_temp = tempfile.NamedTemporaryFile(delete=False, suffix=".json")
        with open(output_json_path, "rb") as src_f:
            final_temp.write(src_f.read())
        final_temp.close()

        return FileResponse(
            path=final_temp.name,
            filename="transparent_lottie.json",
            media_type="application/json",
            background=BackgroundTasks()
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
