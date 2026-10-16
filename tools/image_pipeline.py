#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assets:process —— 图片转换、尺寸统一、GIF 拆帧与 Sprite Sheet 生成。

输入： public/assets/pokemon/{sprites,portraits,shiny,icons,animated}
输出：
  pokemon/atlases/<id>.webp         —— 战斗用动态精灵图集（横向排列）
  pokemon/atlases/<id>.json         —— 图集元数据（帧尺寸 / 帧数 / 帧时长）
  pokemon/sprites/<id>.webp         —— 静态精灵（统一缩放）
  pokemon/portraits/<id>.webp       —— 图鉴立绘
  processed-index.json              —— 处理结果索引

用法：
  python tools/image_pipeline.py --stage pokemon [--max-id N] [--force]
"""
from __future__ import annotations

import argparse
import io
import json
import os
import sys
import time
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from PIL import Image, ImageSequence

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
POKEMON = ASSETS / "pokemon"

# 战斗精灵在场景中的目标显示尺寸（像素，逻辑分辨率下的最大边）
SPRITE_MAX = 72
PORTRAIT_MAX = 160

POKEMON_TYPES = {
    "normal", "fire", "water", "electric", "grass", "ice", "fighting", "poison",
    "ground", "flying", "psychic", "bug", "rock", "ghost", "dragon", "dark", "steel", "fairy",
}


def log(*a):
    print("[pipeline]", *a, flush=True)


def load_rgba(path: Path) -> Image.Image:
    im = Image.open(path)
    im.load()
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    return im


def trim_alpha(im: Image.Image) -> Image.Image:
    """裁掉整列/整行全透明的边缘，让每帧大小一致且没有多余留白。"""
    if im.mode != "RGBA":
        im = im.convert("RGBA")
    bbox = im.getbbox()
    if bbox is None:
        return im
    return im.crop(bbox)


def fit_into(im: Image.Image, max_side: int) -> Image.Image:
    """等比缩放到最长边不超过 max_side，使用最近邻保持像素风锐利。"""
    w, h = im.size
    if max(w, h) <= max_side:
        return im
    scale = max_side / float(max(w, h))
    return im.resize((max(1, round(w * scale)), max(1, round(h * scale))), Image.NEAREST)


def save_webp(im: Image.Image, out: Path, quality: int = 90) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    im.save(out, "WEBP", quality=quality, method=4, exact=True)


# --------------------------------------------------------------------------- #
# 静态资源：front / portrait / shiny / icon
# --------------------------------------------------------------------------- #

def process_static(jobs: list[tuple[str, Path, Path, int, int]]) -> list[dict]:
    results = []
    for kind, src, dst, max_side, quality in jobs:
        try:
            if not src.exists():
                results.append({"kind": kind, "src": str(src), "ok": False, "reason": "missing-source"})
                continue
            im = load_rgba(src)
            orig = im.size
            im = fit_into(trim_alpha(im), max_side)
            save_webp(im, dst, quality)
            results.append({
                "kind": kind, "src": str(src.relative_to(ASSETS)), "out": str(dst.relative_to(ASSETS)),
                "ok": True, "original": list(orig), "size": list(im.size),
                "bytes": dst.stat().st_size,
            })
        except Exception as exc:  # noqa: BLE001
            results.append({"kind": kind, "src": str(src), "ok": False, "reason": f"{type(exc).__name__}: {exc}"})
    return results


# --------------------------------------------------------------------------- #
# 动态资源：GIF -> 图集
# --------------------------------------------------------------------------- #

def process_animated(task: dict) -> dict:
    src = Path(task["src"])
    atlas_out = Path(task["atlas"])
    meta_out = Path(task["meta"])
    if not src.exists():
        return {"id": task["id"], "ok": False, "reason": "missing-source"}

    try:
        gif = Image.open(src)
        frames: list[Image.Image] = []
        durations: list[int] = []
        for frame in ImageSequence.Iterator(gif):
            durations.append(frame.info.get("duration", 100) or 100)
            rgba = frame.convert("RGBA")
            # GIF 调色板没有真正的 alpha，用索引透明色转换出的 0 透明度即可
            frames.append(rgba)

        if not frames:
            return {"id": task["id"], "ok": False, "reason": "no-frames"}

        # 统一裁切：以所有帧的并集包围盒裁切，保持帧间相对位置不抖动
        union = None
        for f in frames:
            bbox = f.getbbox()
            if bbox is None:
                continue
            union = bbox if union is None else (
                min(union[0], bbox[0]), min(union[1], bbox[1]),
                max(union[2], bbox[2]), max(union[3], bbox[3]),
            )
        if union is not None:
            frames = [f.crop(union) for f in frames]

        # 统一缩放到同一目标尺寸
        w, h = frames[0].size
        scale = min(SPRITE_MAX / max(w, 1), SPRITE_MAX / max(h, 1))
        tw = max(1, round(w * scale))
        th = max(1, round(h * scale))
        frames = [f.resize((tw, th), Image.NEAREST) for f in frames]

        # 横向拼接成图集
        sheet = Image.new("RGBA", (tw * len(frames), th), (0, 0, 0, 0))
        for i, f in enumerate(frames):
            sheet.paste(f, (i * tw, 0))

        atlas_out.parent.mkdir(parents=True, exist_ok=True)
        sheet.save(atlas_out, "WEBP", quality=82, method=5, exact=True)

        total = sum(durations)
        meta = {
            "key": src.stem,
            "frameWidth": tw,
            "frameHeight": th,
            "frameCount": len(frames),
            "durations": durations,
            "totalDuration": total,
            "columns": len(frames),
            "source": f"pokemon/animated/{src.name}",
            "atlas": f"pokemon/atlases/{atlas_out.name}",
        }
        meta_out.parent.mkdir(parents=True, exist_ok=True)
        meta_out.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

        return {
            "id": task["id"], "ok": True,
            "atlas": str(atlas_out.relative_to(ASSETS)),
            "meta": str(meta_out.relative_to(ASSETS)),
            "frameWidth": tw, "frameHeight": th, "frameCount": len(frames),
            "totalDuration": total,
            "atlasBytes": atlas_out.stat().st_size,
            "sourceBytes": src.stat().st_size,
        }
    except Exception as exc:  # noqa: BLE001
        return {"id": task["id"], "ok": False, "reason": f"{type(exc).__name__}: {exc}"}


# --------------------------------------------------------------------------- #

SOURCE_KINDS = ("sprites", "portraits", "shiny", "icons", "animated")


def archive_sources(pokemon_dir: Path) -> int:
    """把已处理过的 PNG/GIF 源文件移出 public，避免部署包体积翻倍。"""
    import shutil
    archive = ROOT / ".assets-cache" / "source"
    moved = 0
    for kind in SOURCE_KINDS:
        src_dir = pokemon_dir / kind
        if not src_dir.exists():
            continue
        dst_dir = archive / kind
        dst_dir.mkdir(parents=True, exist_ok=True)
        for f in src_dir.iterdir():
            if f.suffix.lower() not in (".png", ".gif"):
                continue
            # 只归档已有对应 webp 产物的
            if kind == "animated":
                if not (pokemon_dir / "atlases" / f"{f.stem}.webp").exists():
                    continue
                if not (pokemon_dir / "atlases" / f"{f.stem}.json").exists():
                    continue
            else:
                if not (src_dir / f"{f.stem}.webp").exists():
                    continue
            target = dst_dir / f.name
            if target.exists():
                target.unlink()
            shutil.move(str(f), str(target))
            moved += 1
    return moved


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--max-id", type=int, default=0)
    ap.add_argument("--skip-animated", action="store_true")
    ap.add_argument("--keep-sources", action="store_true",
                    help="保留 public 下的 PNG/GIF 源图（默认归档到 .assets-cache/source）")
    ap.add_argument("--workers", type=int, default=max(2, (os.cpu_count() or 4) - 1))
    args = ap.parse_args()

    pokedex_path = ROOT / "src" / "data" / "pokemon" / "pokedex.json"
    pokedex = json.loads(pokedex_path.read_text(encoding="utf-8"))
    ids = sorted(int(k) for k in pokedex)
    if args.max_id:
        ids = [i for i in ids if i <= args.max_id]

    log(f"处理 {len(ids)} 只精灵")
    started = time.time()

    # ---- 静态资源（单进程，Pillow 释放好）----
    static_jobs = []
    for pid in ids:
        static_jobs.append(("front", POKEMON / "sprites" / f"{pid}.png", POKEMON / "sprites" / f"{pid}.webp", 96, 88))
        static_jobs.append(("portrait", POKEMON / "portraits" / f"{pid}.png", POKEMON / "portraits" / f"{pid}.webp", PORTRAIT_MAX, 80))
        static_jobs.append(("shiny", POKEMON / "shiny" / f"{pid}.png", POKEMON / "shiny" / f"{pid}.webp", 96, 88))
        static_jobs.append(("icon", POKEMON / "icons" / f"{pid}.png", POKEMON / "icons" / f"{pid}.webp", 48, 90))

    log(f"静态资源：{len(static_jobs)} 个")
    static_results = []
    chunk = max(1, len(static_jobs) // args.workers)
    chunks = [static_jobs[i:i + chunk] for i in range(0, len(static_jobs), chunk)]
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(process_static, c) for c in chunks]
        for n, fut in enumerate(as_completed(futures), 1):
            static_results.extend(fut.result())
            log(f"  静态批次 {n}/{len(futures)}")

    static_ok = [r for r in static_results if r.get("ok")]
    log(f"静态资源完成 {len(static_ok)}/{len(static_results)}")

    # ---- 动态资源 ----
    animated_results = []
    if not args.skip_animated:
        tasks = []
        for pid in ids:
            src = POKEMON / "animated" / f"{pid}.gif"
            tasks.append({
                "id": pid,
                "src": str(src),
                "atlas": str(POKEMON / "atlases" / f"{pid}.webp"),
                "meta": str(POKEMON / "atlases" / f"{pid}.json"),
            })
        log(f"动态资源：{len(tasks)} 个 GIF 待拆帧")
        with ProcessPoolExecutor(max_workers=args.workers) as pool:
            futures = {pool.submit(process_animated, t): t["id"] for t in tasks}
            done = 0
            for fut in as_completed(futures):
                animated_results.append(fut.result())
                done += 1
                if done % 200 == 0:
                    log(f"  动态 {done}/{len(tasks)}")
    anim_ok = [r for r in animated_results if r.get("ok")]
    log(f"动态资源完成 {len(anim_ok)}/{len(animated_results)}")

    # ---- 索引 ----
    archived = 0
    if not args.keep_sources:
        archived = archive_sources(POKEMON)
        log(f"已归档源文件 {archived} 个到 .assets-cache/source（public 只保留 webp 产物）")

    index = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "elapsedSeconds": round(time.time() - started, 1),
        "archivedSources": archived,
        "static": {
            "total": len(static_results),
            "ok": len(static_ok),
            "failed": [r for r in static_results if not r.get("ok")],
            "byKind": {},
        },
        "animated": {
            "total": len(animated_results),
            "ok": len(anim_ok),
            "failed": [r for r in animated_results if not r.get("ok")],
            "items": {str(r["id"]): {k: v for k, v in r.items() if k != "id"} for r in anim_ok},
        },
    }
    for kind in ("front", "portrait", "shiny", "icon"):
        rs = [r for r in static_results if r["kind"] == kind]
        index["static"]["byKind"][kind] = {
            "total": len(rs), "ok": sum(1 for r in rs if r.get("ok")),
            "items": {Path(r["src"]).stem: r.get("size") for r in rs if r.get("ok")},
        }

    out = ROOT / "processed-index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"✔ 处理完成，用时 {index['elapsedSeconds']}s → {out}")
    log(f"  静态 {index['static']['ok']}/{index['static']['total']} / 动态 {index['animated']['ok']}/{index['animated']['total']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
