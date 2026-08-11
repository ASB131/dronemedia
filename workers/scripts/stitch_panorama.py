#!/usr/bin/env python3
"""
Pose-based DJI panorama stitcher.

Projects PANO####.JPG tiles onto an equirectangular (or sector) canvas using
gimbal yaw/pitch/roll + horizontal FOV.

Compositing is winner-takes-all (prefer tile center) to avoid ghosting from
soft-blending misaligned overlaps. Output aims for native tile angular
resolution (px/deg ≈ tile_width / hfov).
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

TILE_MAX_EDGE = 0
# Native Mavic 3 tiles ≈ 5280/73.7 ≈ 71.6 px/deg → ~25.8k for a full sphere.
OUT_MAX_WIDTH = 26624
OUT_MAX_HEIGHT = 13312
SPHERE_PITCH_THRESHOLD = -70.0
# Discard outer ring where lens distortion / vignetting is worst.
EDGE_REJECT = 0.90
# Tiny seam blend only when the incoming score nearly ties the current winner.
SEAM_RATIO = 0.97


def run_exiftool(path: str) -> dict:
    cmd = [
        "exiftool",
        "-j",
        "-n",
        "-GimbalYawDegree",
        "-GimbalPitchDegree",
        "-GimbalRollDegree",
        "-FOV",
        "-FocalLengthIn35mmFormat",
        "-ImageWidth",
        "-ImageHeight",
        path,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(f"exiftool failed for {path}: {proc.stderr.strip()}")
    return json.loads(proc.stdout)[0]


def horizontal_fov_deg(meta: dict) -> float:
    """Prefer 35mm-equivalent focal length → true horizontal FOV."""
    fl35 = meta.get("FocalLengthIn35mmFormat")
    if fl35 is not None:
        try:
            fl = float(fl35)
            if fl > 1:
                return math.degrees(2.0 * math.atan(36.0 / (2.0 * fl)))
        except (TypeError, ValueError):
            pass
    fov = float(meta.get("FOV") or 73.7)
    return max(20.0, min(120.0, fov))


def load_tile(path: str) -> tuple[np.ndarray, dict]:
    meta = run_exiftool(path)
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError(f"failed to read {path}")
    h, w = img.shape[:2]
    if TILE_MAX_EDGE > 0:
        scale = min(1.0, TILE_MAX_EDGE / float(max(h, w)))
        if scale < 1.0:
            img = cv2.resize(
                img,
                (max(1, int(w * scale)), max(1, int(h * scale))),
                interpolation=cv2.INTER_AREA,
            )
    return img, meta


def camera_to_world(yaw_deg: float, pitch_deg: float, roll_deg: float) -> np.ndarray:
    yaw = math.radians(yaw_deg)
    pitch = math.radians(pitch_deg)
    roll = math.radians(roll_deg)

    forward = np.array(
        [
            math.sin(yaw) * math.cos(pitch),
            math.sin(pitch),
            math.cos(yaw) * math.cos(pitch),
        ],
        dtype=np.float64,
    )
    forward /= np.linalg.norm(forward) + 1e-12

    if abs(math.sin(pitch)) > 0.99:
        right = np.array([math.cos(yaw), 0.0, -math.sin(yaw)], dtype=np.float64)
    else:
        world_up = np.array([0.0, 1.0, 0.0], dtype=np.float64)
        right = np.cross(world_up, forward)
    right /= np.linalg.norm(right) + 1e-12

    down = np.cross(right, forward)
    down /= np.linalg.norm(down) + 1e-12
    right = np.cross(forward, down)
    right /= np.linalg.norm(right) + 1e-12

    cr, sr = math.cos(roll), math.sin(roll)
    right2 = right * cr + down * sr
    down2 = -right * sr + down * cr

    return np.column_stack([right2, down2, forward])


def yaw_coverage(yaws: list[float]) -> tuple[float, float]:
    """Return (span_deg, start_deg) on [0, 360) excluding the largest empty gap."""
    if not yaws:
        return 360.0, 0.0
    s = np.sort(np.mod(np.asarray(yaws, dtype=np.float64), 360.0))
    if len(s) == 1:
        return 0.0, float(s[0])
    gaps = np.diff(s)
    gaps = np.append(gaps, (s[0] + 360.0) - s[-1])
    i = int(np.argmax(gaps))
    span = float(360.0 - gaps[i])
    start = float(s[(i + 1) % len(s)] % 360.0)
    return span, start


def project_tile(
    img: np.ndarray,
    meta: dict,
    out_w: int,
    out_h: int,
    lon0: float,
    lon_span: float,
    lat_top: float,
    lat_span: float,
    canvas: np.ndarray,
    score: np.ndarray,
) -> None:
    """Winner-takes-all projection: prefer samples closer to each tile's center."""
    h, w = img.shape[:2]
    yaw = float(meta.get("GimbalYawDegree") or 0.0)
    pitch = float(meta.get("GimbalPitchDegree") or 0.0)
    roll = float(meta.get("GimbalRollDegree") or 0.0)
    hfov = horizontal_fov_deg(meta)
    f = (w * 0.5) / math.tan(math.radians(hfov) * 0.5)

    r_inv = camera_to_world(yaw, pitch, roll).T
    block = 256

    for y0 in range(0, out_h, block):
        y1 = min(out_h, y0 + block)
        for x0 in range(0, out_w, block):
            x1 = min(out_w, x0 + block)
            xs = np.arange(x0, x1, dtype=np.float64) + 0.5
            ys = np.arange(y0, y1, dtype=np.float64) + 0.5
            grid_x, grid_y = np.meshgrid(xs, ys)

            lon = np.deg2rad(lon0 + (grid_x / out_w) * lon_span)
            lat = np.deg2rad(lat_top - (grid_y / out_h) * lat_span)
            cos_lat = np.cos(lat)
            dir_world = np.stack(
                [
                    cos_lat * np.sin(lon),
                    np.sin(lat),
                    cos_lat * np.cos(lon),
                ],
                axis=-1,
            )

            dir_cam = dir_world @ r_inv.T
            z = dir_cam[..., 2]
            valid = z > 1e-4
            if not np.any(valid):
                continue

            u = f * (dir_cam[..., 0] / z) + (w * 0.5)
            v = f * (dir_cam[..., 1] / z) + (h * 0.5)
            valid &= (u >= 0) & (u < w - 1) & (v >= 0) & (v < h - 1)
            if not np.any(valid):
                continue

            nx = np.abs((u - w * 0.5) / (w * 0.5))
            ny = np.abs((v - h * 0.5) / (h * 0.5))
            # Drop distorted periphery.
            valid &= (nx < EDGE_REJECT) & (ny < EDGE_REJECT)
            if not np.any(valid):
                continue

            # Higher score nearer the optical center.
            r = np.sqrt(nx * nx + ny * ny)
            sc = ((1.0 - np.clip(r / EDGE_REJECT, 0.0, 1.0)) ** 2).astype(
                np.float32
            )
            sc = np.where(valid, sc, 0.0)
            if not np.any(sc > 0):
                continue

            sampled = cv2.remap(
                img,
                u.astype(np.float32),
                v.astype(np.float32),
                interpolation=cv2.INTER_LINEAR,
                borderMode=cv2.BORDER_CONSTANT,
                borderValue=(0, 0, 0),
            )

            cur = score[y0:y1, x0:x1]
            # Hard replace when clearly better.
            better = sc > cur
            # Micro-blend only on near-ties to soften seam edges.
            near = (~better) & (sc > 0) & (cur > 0) & (sc >= cur * SEAM_RATIO)
            if np.any(better):
                canvas[y0:y1, x0:x1][better] = sampled[better]
                cur[better] = sc[better]
            if np.any(near):
                alpha = (sc[near] / (sc[near] + cur[near])).astype(np.float32)
                base = canvas[y0:y1, x0:x1][near].astype(np.float32)
                mix = sampled[near].astype(np.float32)
                canvas[y0:y1, x0:x1][near] = np.clip(
                    base * (1.0 - alpha[..., None]) + mix * alpha[..., None],
                    0,
                    255,
                ).astype(np.uint8)
                cur[near] = np.maximum(cur[near], sc[near])
            score[y0:y1, x0:x1] = cur


def stitch(paths: list[str], output: str) -> int:
    metas: list[dict] = []
    sizes: list[tuple[int, int]] = []
    ok_paths: list[str] = []
    for path in paths:
        try:
            meta = run_exiftool(path)
            w = int(meta.get("ImageWidth") or 0)
            h = int(meta.get("ImageHeight") or 0)
            if w <= 0 or h <= 0:
                # Fall back to reading the file header via imread size only.
                img = cv2.imread(path, cv2.IMREAD_COLOR)
                if img is None:
                    raise RuntimeError("unreadable")
                h, w = img.shape[:2]
                del img
            metas.append(meta)
            sizes.append((w, h))
            ok_paths.append(path)
        except Exception as exc:  # noqa: BLE001
            print(f"skip meta {path}: {exc}", file=sys.stderr)

    if len(metas) < 2:
        print("need at least 2 readable tiles with pose metadata", file=sys.stderr)
        return 2

    pitches = [float(m.get("GimbalPitchDegree") or 0.0) for m in metas]
    yaws = [float(m.get("GimbalYawDegree") or 0.0) for m in metas]
    hfovs = [horizontal_fov_deg(m) for m in metas]
    avg_w = float(np.mean([w for w, _ in sizes]))
    avg_h = float(np.mean([h for _, h in sizes]))
    avg_hfov = float(np.mean(hfovs))
    avg_vfov = math.degrees(
        2.0
        * math.atan(math.tan(math.radians(avg_hfov) * 0.5) * (avg_h / avg_w))
    )
    px_per_deg = avg_w / max(avg_hfov, 1.0)
    is_sphere = min(pitches) <= SPHERE_PITCH_THRESHOLD

    if is_sphere:
        lon_span = 360.0
        lon0 = -180.0
        lat_span = 180.0
        lat_top = 90.0
        out_w = int(min(OUT_MAX_WIDTH, max(4096, round(px_per_deg * 360.0))))
        out_h = out_w // 2
    else:
        yaw_span, yaw_start = yaw_coverage(yaws)
        margin_yaw = avg_hfov * 0.55
        lon_span = min(360.0, yaw_span + 2.0 * margin_yaw)
        lon0 = yaw_start - margin_yaw
        while lon0 > 180.0:
            lon0 -= 360.0
        while lon0 < -180.0:
            lon0 += 360.0

        margin_pitch = avg_vfov * 0.55
        lat_min = max(-90.0, min(pitches) - margin_pitch)
        lat_max = min(90.0, max(pitches) + margin_pitch)
        lat_span = max(10.0, lat_max - lat_min)
        lat_top = lat_max

        out_w = int(min(OUT_MAX_WIDTH, max(2048, round(px_per_deg * lon_span))))
        out_h = int(min(OUT_MAX_HEIGHT, max(1024, round(px_per_deg * lat_span))))

    out_w = max(64, (out_w // 64) * 64)
    out_h = max(64, (out_h // 64) * 64)
    if is_sphere:
        out_h = out_w // 2

    print(
        f"tiles={len(paths)} sphere={is_sphere} "
        f"pitch=[{min(pitches):.1f},{max(pitches):.1f}] "
        f"yaw=[{min(yaws):.1f},{max(yaws):.1f}] "
        f"hfov={avg_hfov:.1f} px/deg={px_per_deg:.1f} "
        f"lon0={lon0:.1f} span={lon_span:.1f}x{lat_span:.1f} "
        f"out={out_w}x{out_h} mode=winner-takes-all",
        flush=True,
    )

    # uint8 canvas + float16 score — much lighter than float RGB accumulators.
    canvas = np.zeros((out_h, out_w, 3), dtype=np.uint8)
    score = np.zeros((out_h, out_w), dtype=np.float16)

    for idx, path in enumerate(paths):
        try:
            img, meta = load_tile(path)
        except Exception as exc:  # noqa: BLE001
            print(f"skip {path}: {exc}", file=sys.stderr)
            continue
        print(f"project {idx + 1}/{len(paths)} {Path(path).name}", flush=True)
        project_tile(
            img,
            meta,
            out_w,
            out_h,
            lon0,
            lon_span,
            lat_top,
            lat_span,
            canvas,
            score,
        )
        del img

    covered = score > 1e-4
    if not np.any(covered):
        print("no coverage after projection", file=sys.stderr)
        return 1

    pano = canvas
    if not is_sphere:
        gray = cv2.cvtColor(pano, cv2.COLOR_BGR2GRAY)
        mask = gray > 8
        if np.any(mask):
            ys, xs = np.where(mask)
            y0, y1 = max(0, int(ys.min()) - 4), min(out_h, int(ys.max()) + 5)
            x0, x1 = max(0, int(xs.min()) - 4), min(out_w, int(xs.max()) + 5)
            pano = pano[y0:y1, x0:x1]

    Path(output).parent.mkdir(parents=True, exist_ok=True)
    if not cv2.imwrite(output, pano, [int(cv2.IMWRITE_JPEG_QUALITY), 95]):
        print("failed to write output", file=sys.stderr)
        return 3

    # GPU-safe companion for the 360 viewer (max 16384 edge).
    view_path = str(Path(output).with_name(Path(output).stem + "-view.jpg"))
    max_view = 16384
    vh, vw = pano.shape[:2]
    if max(vw, vh) > max_view:
        scale = max_view / float(max(vw, vh))
        view = cv2.resize(
            pano,
            (max(1, int(vw * scale)), max(1, int(vh * scale))),
            interpolation=cv2.INTER_AREA,
        )
    else:
        view = pano
    cv2.imwrite(view_path, view, [int(cv2.IMWRITE_JPEG_QUALITY), 92])

    Path(output).with_suffix(".json").write_text(
        json.dumps(
            {
                "width": int(pano.shape[1]),
                "height": int(pano.shape[0]),
                "sphere": bool(is_sphere),
                "tileCount": len(metas),
                "pxPerDeg": round(px_per_deg, 2),
                "viewWidth": int(view.shape[1]),
                "viewHeight": int(view.shape[0]),
                "tiles": [
                    {
                        "file": Path(ok_paths[i]).name,
                        "yaw": float(m.get("GimbalYawDegree") or 0.0),
                        "pitch": float(m.get("GimbalPitchDegree") or 0.0),
                        "roll": float(m.get("GimbalRollDegree") or 0.0),
                        "hfovDeg": round(horizontal_fov_deg(m), 3),
                        "width": int(sizes[i][0]),
                        "height": int(sizes[i][1]),
                    }
                    for i, m in enumerate(metas)
                ],
            }
        ),
        encoding="utf-8",
    )
    print(
        f"ok size={pano.shape[1]}x{pano.shape[0]} "
        f"view={view.shape[1]}x{view.shape[0]} sphere={is_sphere}"
    )
    return 0


def main() -> int:
    if len(sys.argv) < 4:
        print(
            "usage: stitch_panorama.py <out.jpg> <tile1> <tile2> [...]",
            file=sys.stderr,
        )
        return 2
    return stitch(sys.argv[2:], sys.argv[1])


if __name__ == "__main__":
    raise SystemExit(main())
