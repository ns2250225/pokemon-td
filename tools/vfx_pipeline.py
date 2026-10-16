#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assets:process 的 VFX 部分 —— 生成技能特效所需的粒子与光效纹理。

为什么程序化生成（而不是只用下载来的素材）：
  PRD 5.4 要求特效"支持技能颜色、大小、持续时间、方向参数化"和"同一技能效果被
  不同精灵复用"。因此这里生成的是**白色 / 灰度 + alpha** 的基础纹理，运行时由
  EffectSystem 按招式配置着色（setTint）与缩放，一套纹理覆盖 18 种属性的全部招式。
  Kenney CC0 粒子包（若可下载）会额外注册为可选纹理。

输出： public/assets/effects/<group>/<name>.png
      public/assets/effects/atlas.json  —— 纹理索引（尺寸 / 分组 / 用途）
"""
from __future__ import annotations

import json
import math
import random
import sys
import time
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "public" / "assets"
FX = ASSETS / "effects"

SIZE = 128


def new_layer(size: int = SIZE) -> Image.Image:
    return Image.new("RGBA", (size, size), (0, 0, 0, 0))


def radial(size: int, inner=(255, 255, 255, 255), outer=(255, 255, 255, 0), radius_ratio=0.5):
    """径向渐变圆点：所有柔和粒子的基础"""
    img = new_layer(size)
    px = img.load()
    c = size / 2
    r = size * radius_ratio
    for y in range(size):
        for x in range(size):
            d = math.hypot(x - c + 0.5, y - c + 0.5) / r
            if d >= 1:
                continue
            t = d ** 1.6
            px[x, y] = (
                round(inner[0] + (outer[0] - inner[0]) * t),
                round(inner[1] + (outer[1] - inner[1]) * t),
                round(inner[2] + (outer[2] - inner[2]) * t),
                round(inner[3] + (outer[3] - inner[3]) * t),
            )
    return img


def ring(size: int, thickness: float = 0.12, color=(255, 255, 255, 255)):
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    pad = size * 0.06
    w = max(1, int(size * thickness))
    d.ellipse([pad, pad, size - pad, size - pad], outline=color, width=w)
    return img.filter(ImageFilter.GaussianBlur(w * 0.35))


def star(size: int, points: int = 4, inner_ratio: float = 0.18, color=(255, 255, 255, 255), blur: float = 1.2):
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    outer = size * 0.46
    inner = outer * inner_ratio
    verts = []
    for i in range(points * 2):
        ang = -math.pi / 2 + i * math.pi / points
        r = outer if i % 2 == 0 else inner
        verts.append((c + math.cos(ang) * r, c + math.sin(ang) * r))
    d.polygon(verts, fill=color)
    return img.filter(ImageFilter.GaussianBlur(blur))


def soft_circle(size: int, color=(255, 255, 255, 255), blur: float = 6.0, radius_ratio: float = 0.34):
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    r = size * radius_ratio
    d.ellipse([c - r, c - r, c + r, c + r], fill=color)
    return img.filter(ImageFilter.GaussianBlur(blur))


def spark(size: int, length: float = 0.9, width: float = 0.07, color=(255, 255, 255, 255)):
    """细长火花 / 拖尾"""
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    L = size * length
    w = max(1, int(size * width))
    d.line([c - L / 2, c, c + L / 2, c], fill=color, width=w)
    d.line([c, c - L / 2, c, c + L / 2], fill=color, width=max(1, w // 2))
    return img.filter(ImageFilter.GaussianBlur(w * 0.6))


def bolt(size: int, seed: int = 7, segments: int = 9, jitter: float = 0.16, width: int = 3,
         color=(255, 255, 255, 255)) -> Image.Image:
    """闪电链段：从左上到右下的折线"""
    rnd = random.Random(seed)
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    pts = []
    for i in range(segments + 1):
        t = i / segments
        x = size * (0.06 + t * 0.88)
        y = size / 2 + math.sin(t * math.pi * 2.2 + seed) * size * jitter * (1 - abs(t - 0.5) * 1.2)
        y += rnd.uniform(-1, 1) * size * 0.03
        pts.append((x, y))
    d.line(pts, fill=color, width=width, joint="curve")
    return img.filter(ImageFilter.GaussianBlur(width * 0.7))


def flame(size: int, seed: int = 3, hue_shift: float = 0.0):
    """火焰粒子：上部尖、下部圆的水滴形"""
    rnd = random.Random(seed)
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    r = size * 0.32
    d.ellipse([c - r, c + size * 0.02, c + r, c + size * 0.02 + r * 2], fill=(255, 255, 255, 255))
    d.polygon(
        [(c - r * 0.75, c + size * 0.06), (c, c - size * 0.42), (c + r * 0.75, c + size * 0.06)],
        fill=(255, 255, 255, 255),
    )
    for _ in range(6):
        rr = rnd.uniform(size * 0.03, size * 0.08)
        x = c + rnd.uniform(-r, r) * 0.8
        y = c + rnd.uniform(-size * 0.3, size * 0.2)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255, 200))
    return img.filter(ImageFilter.GaussianBlur(size * 0.035))


def shard(size: int, seed: int = 1, points: int = 5, sharp: float = 0.55):
    """冰晶 / 岩石碎片"""
    rnd = random.Random(seed)
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    verts = []
    for i in range(points):
        ang = -math.pi / 2 + i * 2 * math.pi / points
        r = size * (sharp + rnd.uniform(-0.1, 0.14))
        verts.append((c + math.cos(ang) * r, c + math.sin(ang) * r))
    d.polygon(verts, fill=(255, 255, 255, 235))
    d.line(verts + [verts[0]], fill=(255, 255, 255, 255), width=2)
    return img.filter(ImageFilter.GaussianBlur(0.8))


def leaf(size: int, seed: int = 2):
    """叶片刃：两端尖的椭圆"""
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    d.ellipse([c - size * 0.4, c - size * 0.16, c + size * 0.4, c + size * 0.16], fill=(255, 255, 255, 240))
    d.line([c - size * 0.42, c, c + size * 0.42, c], fill=(255, 255, 255, 255), width=2)
    return img.filter(ImageFilter.GaussianBlur(0.7))


def smoke(size: int, seed: int = 5):
    """烟雾 / 孢子：多个重叠模糊圆"""
    rnd = random.Random(seed)
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    for _ in range(9):
        rr = rnd.uniform(size * 0.12, size * 0.26)
        x = c + rnd.uniform(-size * 0.2, size * 0.2)
        y = c + rnd.uniform(-size * 0.2, size * 0.2)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=(255, 255, 255, rnd.randint(90, 170)))
    return img.filter(ImageFilter.GaussianBlur(size * 0.06))


def trail_streak(size: int, width: int = 14):
    """拖尾长条：水平渐变"""
    img = new_layer(size)
    px = img.load()
    for x in range(size):
        t = x / (size - 1)
        a = int(255 * (1 - t) ** 1.5)
        for y in range(size):
            d = abs(y - size / 2) / (width / 2)
            if d >= 1:
                continue
            px[x, y] = (255, 255, 255, int(a * (1 - d) ** 1.4))
    return img


def ground_crack(size: int, seed: int = 11):
    """地面裂纹"""
    rnd = random.Random(seed)
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    for i in range(7):
        ang = i * 2 * math.pi / 7 + rnd.uniform(-0.2, 0.2)
        pts = [(c, c)]
        r = size * 0.12
        while r < size * 0.46:
            pts.append((c + math.cos(ang) * r + rnd.uniform(-3, 3), c + math.sin(ang) * r + rnd.uniform(-3, 3)))
            r += size * 0.1
        d.line(pts, fill=(255, 255, 255, 230), width=3, joint="curve")
    return img.filter(ImageFilter.GaussianBlur(0.8))


def beam(size: int, width_ratio: float = 0.22):
    """光束条：中间亮两侧渐隐"""
    img = new_layer(size)
    px = img.load()
    w = size * width_ratio
    for y in range(size):
        d = abs(y - size / 2) / w
        a = 0 if d >= 1 else int(255 * (1 - d) ** 0.8)
        for x in range(size):
            fade = 1.0
            if x > size * 0.65:
                fade = max(0.0, 1 - (x - size * 0.65) / (size * 0.35))
            if x < size * 0.1:
                fade = x / (size * 0.1)
            px[x, y] = (255, 255, 255, int(a * fade))
    return img


def nova(size: int, spikes: int = 16, seed: int = 4):
    """爆发新星：中心亮点 + 放射尖刺"""
    img = soft_circle(size, radius_ratio=0.2, blur=size * 0.05)
    d = ImageDraw.Draw(img)
    c = size / 2
    rnd = random.Random(seed)
    for i in range(spikes):
        ang = i * 2 * math.pi / spikes + rnd.uniform(-0.06, 0.06)
        r0 = size * 0.1
        r1 = size * rnd.uniform(0.34, 0.47)
        w = max(1, int(rnd.uniform(1.5, 4)))
        d.line(
            [c + math.cos(ang) * r0, c + math.sin(ang) * r0, c + math.cos(ang) * r1, c + math.sin(ang) * r1],
            fill=(255, 255, 255, 235), width=w,
        )
    return img.filter(ImageFilter.GaussianBlur(1.4))


def swirl(size: int, arms: int = 3, seed: int = 9):
    """漩涡 / 龙卷"""
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    for arm in range(arms):
        off = arm * 2 * math.pi / arms
        pts = []
        for i in range(64):
            t = i / 63
            ang = off + t * math.pi * 2.4
            r = size * (0.06 + t * 0.42)
            pts.append((c + math.cos(ang) * r, c + math.sin(ang) * r))
        d.line(pts, fill=(255, 255, 255, 200), width=4, joint="curve")
    return img.filter(ImageFilter.GaussianBlur(2.0))


def heart(size: int):
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    s = size * 0.26
    d.ellipse([c - s * 1.1, c - s * 1.2, c + s * 0.1, c + s * 0.1], fill=(255, 255, 255, 245))
    d.ellipse([c - s * 0.1, c - s * 1.2, c + s * 1.1, c + s * 0.1], fill=(255, 255, 255, 245))
    d.polygon([(c - s * 1.05, c - s * 0.35), (c + s * 1.05, c - s * 0.35), (c, c + s * 1.25)], fill=(255, 255, 255, 245))
    return img.filter(ImageFilter.GaussianBlur(0.9))


def fist(size: int):
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    r = size * 0.3
    d.rounded_rectangle([c - r, c - r * 0.9, c + r, c + r * 0.9], radius=r * 0.4, fill=(255, 255, 255, 240))
    for i in range(3):
        x = c - r * 0.6 + i * r * 0.6
        d.line([x, c - r * 0.9, x, c - r * 0.2], fill=(255, 255, 255, 255), width=3)
    return img.filter(ImageFilter.GaussianBlur(1.0))


def meteor(size: int, seed: int = 12):
    img = shard(size, seed=seed, points=6, sharp=0.38)
    d = ImageDraw.Draw(img)
    c = size / 2
    for i in range(5):
        a = math.pi * 0.75 + (i - 2) * 0.22
        d.line([c, c, c + math.cos(a) * size * 0.46, c + math.sin(a) * size * 0.46],
               fill=(255, 255, 255, 130), width=2)
    return img.filter(ImageFilter.GaussianBlur(1.2))


def portal(size: int, seed: int = 21):
    """暗影 / 光环：多层同心环"""
    img = new_layer(size)
    d = ImageDraw.Draw(img)
    c = size / 2
    for i in range(4):
        r = size * (0.14 + i * 0.085)
        a = int(220 - i * 45)
        d.ellipse([c - r, c - r, c + r, c + r], outline=(255, 255, 255, a), width=max(2, int(size * 0.025)))
    return img.filter(ImageFilter.GaussianBlur(2.2))


def orb(size: int, seed: int = 31):
    """能量球：亮核 + 光晕"""
    core = soft_circle(size, radius_ratio=0.18, blur=size * 0.03)
    halo = soft_circle(size, radius_ratio=0.34, blur=size * 0.09)
    return Image.alpha_composite(halo, core)


def shockwave(size: int):
    return ring(size, thickness=0.17).filter(ImageFilter.GaussianBlur(1.6))


# --------------------------------------------------------------------------- #
# 纹理清单：分组 → 名称 → 生成器
# --------------------------------------------------------------------------- #

TEXTURES: dict[str, dict[str, callable]] = {
    "common": {
        "dot": lambda: radial(128),
        "dot_soft": lambda: soft_circle(128, radius_ratio=0.3, blur=9),
        "spark": lambda: spark(128),
        "streak": lambda: trail_streak(128),
        "smoke": lambda: smoke(128),
        "star": lambda: star(128, points=4),
        "star6": lambda: star(128, points=6, inner_ratio=0.26),
        "ring": lambda: ring(128),
        "shockwave": lambda: shockwave(128),
        "nova": lambda: nova(128),
        "flame": lambda: flame(128),
        "shard": lambda: shard(128),
        "leaf": lambda: leaf(128),
        "beam": lambda: beam(128),
        "crack": lambda: ground_crack(128),
        "swirl": lambda: swirl(128),
        "portal": lambda: portal(128),
        "orb": lambda: orb(128),
        "heart": lambda: heart(128),
        "fist": lambda: fist(128),
        "meteor": lambda: meteor(128),
        "bolt_a": lambda: bolt(128, seed=7),
        "bolt_b": lambda: bolt(128, seed=19, segments=11, jitter=0.2),
        "bolt_c": lambda: bolt(128, seed=33, segments=8, jitter=0.13, width=2),
    },
    "fire": {
        "flame_large": lambda: flame(128, seed=41, hue_shift=0.0),
        "fireball": lambda: orb(128, seed=42),
        "ember": lambda: radial(128, radius_ratio=0.4),
    },
    "water": {
        "drop": lambda: orb(128, seed=51),
        "splash": lambda: nova(128, spikes=10, seed=52),
        "wave": lambda: trail_streak(128, width=44),
    },
    "electric": {
        "bolt_long": lambda: bolt(128, seed=61, segments=13, jitter=0.22, width=4),
        "spark_ring": lambda: nova(128, spikes=20, seed=62),
    },
    "ice": {
        "crystal": lambda: shard(128, seed=71, points=6, sharp=0.46),
        "frost": lambda: swirl(128, arms=4, seed=72),
    },
    "grass": {
        "blade": lambda: leaf(128),
        "seed": lambda: radial(128, radius_ratio=0.28),
        "root": lambda: bolt(128, seed=81, segments=7, jitter=0.3, width=5),
    },
    "psychic": {
        "psy_orb": lambda: orb(128, seed=91),
        "psy_wave": lambda: ring(128, thickness=0.1),
        "psy_field": lambda: portal(128, seed=92),
    },
    "ultimate": {
        "charged": lambda: nova(128, spikes=24, seed=101),
        "beam_core": lambda: beam(128, width_ratio=0.3),
        "explosion": lambda: nova(128, spikes=18, seed=102),
        "vortex": lambda: swirl(128, arms=5, seed=103),
        "rune": lambda: portal(128, seed=104),
        "prism": lambda: star(128, points=8, inner_ratio=0.3),
    },
}


def main() -> int:
    started = time.time()
    index: dict = {
        "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "note": "白色 + alpha 的基础纹理，运行时由 EffectSystem 按招式配置着色与缩放，实现一套纹理覆盖全部属性",
        "size": SIZE,
        "groups": {},
    }
    total = 0
    for group, items in TEXTURES.items():
        out_dir = FX / group
        out_dir.mkdir(parents=True, exist_ok=True)
        group_index = {}
        for name, factory in items.items():
            img = factory()
            if img.size != (SIZE, SIZE):
                img = img.resize((SIZE, SIZE), Image.LANCZOS)
            path = out_dir / f"{name}.png"
            img.save(path, "PNG", optimize=True)
            group_index[name] = {
                "file": f"effects/{group}/{name}.png",
                "key": f"{group}_{name}",
                "size": [SIZE, SIZE],
                "bytes": path.stat().st_size,
            }
            total += 1
        index["groups"][group] = group_index
        print(f"[vfx] {group}: {len(group_index)} 张", flush=True)

    (FX / "atlas.json").write_text(json.dumps(index, ensure_ascii=False, indent=2), encoding="utf-8")
    elapsed = round(time.time() - started, 1)
    print(f"[vfx] ✔ 共 {total} 张纹理，用时 {elapsed}s → {FX / 'atlas.json'}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
