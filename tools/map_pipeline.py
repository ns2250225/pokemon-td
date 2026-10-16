#!/usr/bin/env python3
"""Crop/recolor the downloaded CC0 packs into the game's small Phaser map atlas.

Run: python tools/map_pipeline.py
Source packs are kept in .assets-cache/map-art; use --help to override their paths.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageStat

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / ".assets-cache" / "map-art"
TINY_ARCHIVE_SHA256 = "e4d79bd4514bad153cfa1cc8f4c8d8bf10ed39bf69bd98b83bdc46c03d14bb9c"
THEMES = {
    # Ground, path, foliage; muted terrain keeps moving Pokemon easy to read.
    "forest": ("739761", "d9bf8d", None),
    "beach": ("e7d6a5", "c8b385", "6ba58a"),
    "volcano": ("554b59", "a27762", "a66452"),
    "snow": ("d7e5e9", "a7c8d3", "bbd9dd"),
    "manor": ("615c7a", "a598b5", "8779a6"),
    "desert": ("d9ba7d", "b29360", "b7a05e"),
    "sky": ("bdd8d4", "e3dfca", "9dcfc5"),
    "champion": ("7e8795", "c6c2ad", "c4b276"),
}
STONE_COLORS = {
    "forest": None, "beach": "8faaa2", "volcano": "786b71", "snow": "b1ced7",
    "manor": "847a9b", "desert": "b8a07d", "sky": "c3d9d7", "champion": "939caa",
}
CRYSTAL_COLORS = {
    "forest": "7ebee0", "beach": "7ebee0", "volcano": "f0a15b", "snow": "a8d8ed",
    "manor": "b994e1", "desert": "e3c277", "sky": "b2def0", "champion": "e3c277",
}


def rgb(hex_color: str) -> tuple[int, int, int]:
    return tuple(bytes.fromhex(hex_color))


def trimmed(image: Image.Image) -> Image.Image:
    image = image.convert("RGBA")
    box = image.getchannel("A").getbbox()
    assert box, "Cannot pack an empty frame"
    return image.crop(box)


def tint_texture(image: Image.Image, color: str, contrast: float, mean: float | None = None) -> Image.Image:
    """Keep the artist's value texture at low contrast around a biome color."""
    alpha = image.getchannel("A")
    gray = image.convert("L")
    if mean is None:
        mean = ImageStat.Stat(gray, mask=alpha).mean[0]
    target = rgb(color)
    pixels = [tuple(max(0, min(255, round(c + (v - mean) * contrast))) for c in target)
              for v in gray.getdata()]
    result = Image.new("RGB", image.size)
    result.putdata(pixels)
    result.putalpha(alpha)
    return result


def foliage_variant(image: Image.Image, color: str | None) -> Image.Image:
    if color is None:
        return image.copy()
    target = rgb(color)
    pixels = []
    for r, g, b, a in image.getdata():
        if a and g > r * 1.08 and g > b * 0.82:
            # The warm brown trunk and the original silhouette are preserved.
            value = (r * 0.299 + g * 0.587 + b * 0.114) / 130
            pixels.append((*[max(0, min(255, round(c * value))) for c in target], a))
        else:
            pixels.append((r, g, b, a))
    result = Image.new("RGBA", image.size)
    result.putdata(pixels)
    return result


def build_frames(tiny: Path, dungeon: Path, tower_defense: Path) -> dict[str, Image.Image]:
    def load(relative: str) -> Image.Image:
        return Image.open(tiny / relative).convert("RGBA")

    terrain = load("Terrain/Ground/Tilemap_Flat.png")
    assert terrain.size == (640, 256), "Expected the OLD CC0 Tiny Swords terrain"
    grass = terrain.crop((64, 64, 128, 128))
    sand = terrain.crop((384, 64, 448, 128))
    trees = load("Resources/Trees/Tree.png")
    assert trees.size == (768, 576), "Unexpected old-pack tree sheet"
    tree = trimmed(trees.crop((0, 0, 192, 192)))
    bush = trimmed(load("Deco/09.png"))
    frames = {}
    for theme, (ground_color, path_color, leaf_color) in THEMES.items():
        source = sand if theme in ("beach", "desert") else grass
        contrast = .22 if theme == "forest" else .20
        mean = ImageStat.Stat(source.convert("L")).mean[0]
        frames[f"ground-{theme}"] = tint_texture(source, ground_color, contrast, mean)
        tile_x = 384 if theme in ("beach", "desert") else 64
        for direction, tile_y in (("top", 0), ("bottom", 128)):
            edge = terrain.crop((tile_x, tile_y, tile_x + 64, tile_y + 64))
            frames[f"shore-{direction}-{theme}"] = tint_texture(edge, ground_color, contrast, mean)
        frames[f"path-{theme}"] = tint_texture(sand, path_color, .35)
        frames[f"tree-{theme}"] = foliage_variant(tree, leaf_color)
        frames[f"bush-{theme}"] = foliage_variant(bush, leaf_color)

    for name, source in {
        "rock": "Deco/06.png", "rock-small": "Deco/05.png",
        "mushroom-1": "Deco/01.png", "mushroom-2": "Deco/02.png", "mushroom-3": "Deco/03.png",
        "grass": "Deco/11.png", "bones": "Deco/14.png",
        "base": "Factions/Knights/Buildings/Tower/Tower_Blue.png",
        "ruin": "Factions/Knights/Buildings/Tower/Tower_Destroyed.png",
    }.items():
        frames[name] = trimmed(load(source))
    frames["stump"] = trimmed(trees.crop((0, 384, 192, 576)))
    dungeon_sheet = Image.open(dungeon / "Tilemap/tilemap_packed.png").convert("RGBA")
    assert dungeon_sheet.size == (192, 176), "Unexpected Kenney Tiny Dungeon sheet"
    for name, col, row in (("chest", 6, 7),):
        tile = trimmed(dungeon_sheet.crop((col * 16, row * 16, (col + 1) * 16, (row + 1) * 16)))
        frames[name] = tile.resize((tile.width * 4, tile.height * 4), Image.Resampling.NEAREST)
    defense_sheet = Image.open(tower_defense / "Tilesheet/towerDefense_tilesheet.png").convert("RGBA")
    assert defense_sheet.width >= 1472 and defense_sheet.height >= 512
    frames["crystal"] = trimmed(defense_sheet.crop((1408, 448, 1472, 512)))
    for theme, (_, _, leaf_color) in THEMES.items():
        for kind in ("rock", "rock-small", "ruin"):
            stone_color = STONE_COLORS[theme]
            frames[f"{kind}-{theme}"] = tint_texture(frames[kind], stone_color, .90) if stone_color else frames[kind].copy()
        frames[f"grass-{theme}"] = foliage_variant(frames["grass"], leaf_color)
        frames[f"crystal-{theme}"] = tint_texture(frames["crystal"], CRYSTAL_COLORS[theme], 1.0)
    frames["water"] = load("Terrain/Water/Water.png")
    frames["water-beach"] = frames["water"].copy()
    frames["water-volcano"] = tint_texture(frames["water"], "d9693d", .5)
    frames["water-sky"] = tint_texture(frames["water"], "81bad9", .5)
    frames["cliff"] = load("Terrain/Ground/Tilemap_Elevation.png").crop((64, 192, 128, 256))
    frames["foam"] = trimmed(load("Terrain/Water/Foam/Foam.png").crop((0, 0, 192, 192)))
    assert all(image.width > 0 and image.height > 0 for image in frames.values())
    assert all(frames[f"{kind}-{theme}"].size == (64, 64) for theme in THEMES
               for kind in ("ground", "path", "shore-top", "shore-bottom"))
    assert all(frames[f"{kind}-{theme}"].getchannel("A").tobytes() == frames[kind].getchannel("A").tobytes()
               for theme in THEMES for kind in ("rock", "rock-small", "ruin", "grass", "crystal"))
    return frames


def pack(frames: dict[str, Image.Image], output: Path) -> dict:
    padding, width = 2, 1024
    positions, x, y, row_height = {}, 0, 0, 0
    for name, image in sorted(frames.items(), key=lambda item: (-item[1].height, item[0])):
        w, h = image.size
        if x + w + padding * 2 > width:
            x, y, row_height = 0, y + row_height, 0
        positions[name] = (x + padding, y + padding)
        x += w + padding * 2
        row_height = max(row_height, h + padding * 2)
    height = ((y + row_height + 63) // 64) * 64
    atlas = Image.new("RGBA", (width, height))
    metadata = {}
    for name, image in frames.items():
        x, y = positions[name]
        w, h = image.size
        # Extrude each frame's edge two pixels so texture sampling cannot bleed.
        atlas.paste(image, (x, y))
        atlas.paste(image.crop((0, 0, w, 1)).resize((w, padding)), (x, y - padding))
        atlas.paste(image.crop((0, h - 1, w, h)).resize((w, padding)), (x, y + h))
        atlas.paste(image.crop((0, 0, 1, h)).resize((padding, h)), (x - padding, y))
        atlas.paste(image.crop((w - 1, 0, w, h)).resize((padding, h)), (x + w, y))
        for dx, sx in ((-padding, 0), (w, w - 1)):
            for dy, sy in ((-padding, 0), (h, h - 1)):
                atlas.paste(Image.new("RGBA", (padding, padding), image.getpixel((sx, sy))), (x + dx, y + dy))
        metadata[name] = {
            "frame": {"x": x, "y": y, "w": w, "h": h},
            "rotated": False, "trimmed": False,
            "spriteSourceSize": {"x": 0, "y": 0, "w": w, "h": h},
            "sourceSize": {"w": w, "h": h},
        }
        assert x + w <= width and y + h <= height
    output.mkdir(parents=True, exist_ok=True)
    atlas.save(output / "world.png", optimize=True)
    assert (output / "world.png").stat().st_size < 1_000_000, "Atlas exceeds 1 MB budget"
    result = {"frames": metadata, "meta": {
        "app": "map-world", "version": "1", "image": "world.png", "format": "RGBA8888",
        "size": {"w": width, "h": height}, "scale": "1",
    }}
    (output / "world.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    # The round-trip also checks the emitted Phaser rectangles against the PNG.
    saved = Image.open(output / "world.png")
    for name, image in frames.items():
        x, y = positions[name]
        assert saved.crop((x, y, x + image.width, y + image.height)).tobytes() == image.tobytes(), name
    return result


def write_sources(output: Path, dungeon: Path, tower_defense: Path) -> None:
    dungeon_license = (dungeon / "License.txt").read_text(encoding="utf-8-sig").strip()
    defense_license = (tower_defense / "License.txt").read_text(encoding="utf-8-sig").strip()
    content = f"""# Map artwork sources

All map frames in `world.png` are derived from the following CC0 artwork.
Downloaded on 2026-10-16. Atlas key: `map-world`; Phaser JSON hash: `world.json`.

## Pixel Frog — Tiny Swords OLD CC0 version

- Official page: https://pixelfrog-assets.itch.io/tiny-swords
- Official download flow: https://pixelfrog-assets.itch.io/tiny-swords/purchase
- Exact official file label: **TS_old version_CC0 Licensed** (2.6 MB), released 2024-01-03.
- Official file: https://pixelfrog-assets.itch.io/tiny-swords/file/9428013?source=game_download
- Downloaded archive: `TS-old-CC0.zip`, containing `Tiny Swords (Update 010)`.
- Archive SHA-256: `{TINY_ARCHIVE_SHA256}`.
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as explicitly identified by the official file label.
- This is the OLD CC0 archive, separate from the newer pack with a custom license. The old archive does not contain a separate license text.
- Used: grass/sand tiles, elevation cliff, water/foam, pine tree/stump, bushes, mushrooms, rocks, grass, bones, the blue tower and its ruined stone foundation.

## Kenney — Tiny Dungeon

- Official page: https://kenney.nl/assets/tiny-dungeon
- License: CC0 1.0. Used closed wooden chest (packed sheet column 6, row 7); coordinates are zero-based.
- Original `License.txt` retained below:

```text
{dungeon_license}
```

## Kenney — Tower Defense (top-down)

- Official page: https://kenney.nl/assets/tower-defense-top-down
- License: CC0 1.0. Used the blue faceted diamond at pixel rectangle (1408, 448, 64, 64).
- Original `License.txt` retained below:

```text
{defense_license}
```

## Processing

`tools/map_pipeline.py` crops original tiles and animation frames, removes transparent margins, scales the 16 px Kenney Dungeon chest with nearest-neighbor sampling, and creates biome color variants while preserving original light/detail and tree trunks. Ground uses 22% original value contrast in the forest and 20% elsewhere; paths retain 35%. Shore frames use the artist's original transparent top/bottom silhouettes with exactly the same color transfer as their ground. Rocks, ruins, grass and crystals have coherent biome variants with their original silhouettes and shading. No AI-generated artwork is used. The packed lossless PNG has 2 px padding and edge extrusion around every frame. Original download archives are kept outside the public runtime bundle in `.assets-cache/map-art/`.

Rebuild with `python tools/map_pipeline.py`; optional `--tiny-swords`, `--tiny-dungeon`, and `--tower-defense` arguments accept alternate extracted source directories.
"""
    (output / "SOURCES.md").write_text(content, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tiny-swords", type=Path, default=CACHE / "tiny-swords/official-old-cc0/Tiny Swords (Update 010)")
    parser.add_argument("--tiny-dungeon", type=Path, default=CACHE / "kenney-tiny-dungeon")
    parser.add_argument("--tower-defense", type=Path, default=CACHE / "kenney-tower-defense")
    parser.add_argument("--output", type=Path, default=ROOT / "public/assets/maps")
    args = parser.parse_args()
    archive = CACHE / "tiny-swords/TS-old-CC0.zip"
    if archive.exists() and args.tiny_swords == parser.get_default("tiny_swords"):
        assert hashlib.sha256(archive.read_bytes()).hexdigest() == TINY_ARCHIVE_SHA256, "Wrong Tiny Swords archive"
    frames = build_frames(args.tiny_swords, args.tiny_dungeon, args.tower_defense)
    result = pack(frames, args.output)
    write_sources(args.output, args.tiny_dungeon, args.tower_defense)
    print(f"Packed {len(frames)} frames, {result['meta']['size']}, {(args.output / 'world.png').stat().st_size:,} bytes")
    print(json.dumps({name: list(im.size) for name, im in frames.items()}, indent=2))


if __name__ == "__main__":
    main()
