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


def hex_to_rgb(hex_str: str):
    hex_clean = hex_str.lstrip('#')
    if len(hex_clean) == 3:
        hex_clean = ''.join([c*2 for c in hex_clean])
    return tuple(int(hex_clean[i:i+2], 16) for i in (0, 2, 4))


def process_chroma_key(img_bgr, key_rgb, similarity=0.4, smoothness=0.1, spill=0.5):
    """
    High-performance NumPy vectorized Chroma Key algorithm with spill suppression
    """
    key_r, key_g, key_b = key_rgb
    
    # Convert BGR input to float RGB for precise distance calculation
    img_rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB).astype(np.float32)
    
    # Distance in RGB space
    dr = img_rgb[:, :, 0] - key_r
    dg = img_rgb[:, :, 1] - key_g
    db = img_rgb[:, :, 2] - key_b
    
    dist = np.sqrt(dr*dr + dg*dg + db*db)
    
    max_dist = 441.6729559300637 # sqrt(255^2 * 3)
    norm_dist = dist / max_dist
    
    # Similarity and smoothness thresholds
    thresh = max(0.05, similarity)
    feather = thresh + max(0.01, smoothness)
    
    # Alpha mask generation
    alpha = np.zeros_like(norm_dist, dtype=np.float32)
    
    # Foreground pixels
    alpha[norm_dist >= feather] = 1.0
    
    # Feather zone
    feather_mask = (norm_dist >= thresh) & (norm_dist < feather)
    if np.any(feather_mask):
        alpha[feather_mask] = (norm_dist[feather_mask] - thresh) / (feather - thresh)
        
    # Spill suppression
    if spill > 0:
        # Determine dominant key color channel
        if key_g >= key_r and key_g >= key_b: # Green Key
            max_other = np.maximum(img_rgb[:, :, 0], img_rgb[:, :, 2])
            spill_mask = img_rgb[:, :, 1] > max_other
            if np.any(spill_mask):
                excess = (img_rgb[:, :, 1] - max_other) * spill
                img_rgb[:, :, 1] = np.where(spill_mask, img_rgb[:, :, 1] - excess, img_rgb[:, :, 1])
        elif key_b >= key_r and key_b >= key_g: # Blue Key
            max_other = np.maximum(img_rgb[:, :, 0], img_rgb[:, :, 1])
            spill_mask = img_rgb[:, :, 2] > max_other
            if np.any(spill_mask):
                excess = (img_rgb[:, :, 2] - max_other) * spill
                img_rgb[:, :, 2] = np.where(spill_mask, img_rgb[:, :, 2] - excess, img_rgb[:, :, 2])

    rgba = np.dstack((img_rgb.astype(np.uint8), (alpha * 255).astype(np.uint8)))
    return rgba


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
    similarity: float = Form(0.4),
    smoothness: float = Form(0.1),
    spill: float = Form(0.5),
    outputFormat: str = Form("webm"), # "webm" or "mov"
    fps: int = Form(30),
    watermarkRegions: str = Form("[]"),
    cropSettings: str = Form("{}")
):
    if not shutil.which("ffmpeg"):
        raise HTTPException(status_code=500, detail="FFmpeg is not installed on server system")

    try:
        import json
        parsed_regions = json.loads(watermarkRegions) if watermarkRegions else []
    except Exception:
        parsed_regions = []

    try:
        import json
        parsed_crops = json.loads(cropSettings) if cropSettings else {}
    except Exception:
        parsed_crops = {}

    has_watermark = bool(parsed_regions and len(parsed_regions) > 0)
    has_crop = bool(parsed_crops and any(v > 0 for v in parsed_crops.values() if isinstance(v, (int, float))))

    # Create temporary working directory
    with tempfile.TemporaryDirectory() as temp_dir:
        input_path = os.path.join(temp_dir, "input_video.mp4")
        with open(input_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Open video stream using OpenCV
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

        # Output video settings
        ext = "webm" if outputFormat == "webm" else "mov"
        output_filename = f"transparent_export.{ext}"
        output_path = os.path.join(temp_dir, output_filename)

        key_rgb = hex_to_rgb(keyColor)
        key_r, key_g, key_b = key_rgb

        # Fast path: Chroma mode ALWAYS uses direct multi-threaded C-filter rendering (1.5s - 2s)
        if mode == "chroma":
            key_color_hex = keyColor.replace("#", "0x")
            vf_filters = [f"colorkey={key_color_hex}:{similarity}:{smoothness}"]
            
            if spill > 0:
                spill_type = "green" if (key_g >= key_r and key_g >= key_b) else "blue"
                vf_filters.append(f"despill=type={spill_type}:mix={spill}")
                
            if outputFormat == "webm":
                vf_filters.append("format=yuva420p")
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-vf", ",".join(vf_filters),
                    "-c:v", "libvpx-vp9",
                    "-b:v", "6M",
                    "-deadline", "realtime",
                    "-cpu-used", "8",
                    "-threads", "0",
                    "-row-mt", "1",
                    "-metadata:s:v:0", "alpha_mode=1",
                    output_path
                ]
            else:
                vf_filters.append("format=yuva444p10le")
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-i", input_path,
                    "-vf", ",".join(vf_filters),
                    "-c:v", "prores_ks",
                    "-profile:v", "4",
                    "-threads", "0",
                    output_path
                ]

            proc = subprocess.run(ffmpeg_cmd, capture_output=True, text=True)
            if proc.returncode != 0:
                print(f"Direct FFmpeg filter error: {proc.stderr}")
                mode = "fallback_frame_loop"
            else:
                mode = "direct_done"

        if mode != "direct_done":
            cap = cv2.VideoCapture(input_path)
            
            # Recalculate dimensions if crop applies
            out_w, out_h = width, height
            if has_crop:
                c_top = int((float(parsed_crops.get("top", 0)) / 100.0) * height)
                c_bot = int((float(parsed_crops.get("bottom", 0)) / 100.0) * height)
                c_left = int((float(parsed_crops.get("left", 0)) / 100.0) * width)
                c_right = int((float(parsed_crops.get("right", 0)) / 100.0) * width)
                out_w = max(1, width - c_left - c_right)
                out_h = max(1, height - c_top - c_bot)

            if outputFormat == "webm":
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-f", "rawvideo",
                    "-vcodec", "rawvideo",
                    "-pix_fmt", "rgba",
                    "-s", f"{out_w}x{out_h}",
                    "-r", str(int(video_fps)),
                    "-i", "pipe:0",
                    "-c:v", "libvpx-vp9",
                    "-pix_fmt", "yuva420p",
                    "-b:v", "6M",
                    "-deadline", "realtime",
                    "-cpu-used", "8",
                    "-threads", "0",
                    "-row-mt", "1",
                    "-metadata:s:v:0", "alpha_mode=1",
                    output_path
                ]
            else:
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-f", "rawvideo",
                    "-vcodec", "rawvideo",
                    "-pix_fmt", "rgba",
                    "-s", f"{out_w}x{out_h}",
                    "-r", str(int(video_fps)),
                    "-i", "pipe:0",
                    "-c:v", "prores_ks",
                    "-profile:v", "4",
                    "-threads", "0",
                    "-pix_fmt", "yuva444p10le",
                    output_path
                ]

            process = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.DEVNULL)
            session = get_rembg_session() if mode == "ai" else None

            try:
                while True:
                    ret, frame_bgr = cap.read()
                    if not ret:
                        break

                    # 1. Apply OpenCV Telea Inpainting & Crop to remove watermark on top of objects
                    if has_watermark or has_crop:
                        frame_bgr = apply_opencv_watermark_and_crop(frame_bgr, parsed_regions, parsed_crops)

                    # 2. Apply Background Removal
                    if mode == "ai" and REMBG_AVAILABLE:
                        img_rgb = cv2.cvtColor(frame_bgr, cv2.COLOR_BGR2RGB)
                        pil_img = Image.fromarray(img_rgb)
                        if session:
                            res_pil = remove(pil_img, session=session)
                        else:
                            res_pil = remove(pil_img)
                        rgba_frame = np.array(res_pil)
                    else:
                        rgba_frame = process_chroma_key(
                            frame_bgr,
                            key_rgb=key_rgb,
                            similarity=similarity,
                            smoothness=smoothness,
                            spill=spill
                        )

                    process.stdin.write(rgba_frame.tobytes())

                process.stdin.close()
                process.wait()
            except Exception as err:
                try: process.kill()
                except Exception: pass
                raise HTTPException(status_code=500, detail=f"Frame processing error: {err}")
            finally:
                cap.release()

        if not os.path.exists(output_path) or os.path.getsize(output_path) == 0:
            raise HTTPException(status_code=500, detail="FFmpeg encoding failed to generate file output")

        # Read exported binary into memory to return
        with open(output_path, "rb") as out_f:
            file_bytes = out_f.read()

        media_type = "video/webm" if outputFormat == "webm" else "video/quicktime"
        
        # Save temp file for download
        final_temp = tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}")
        final_temp.write(file_bytes)
        final_temp.close()

        return FileResponse(
            path=final_temp.name,
            filename=output_filename,
            media_type=media_type,
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
