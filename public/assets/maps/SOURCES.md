# Map artwork sources

All map frames in `world.png` are derived from the following CC0 artwork.
Downloaded on 2026-10-16. Atlas key: `map-world`; Phaser JSON hash: `world.json`.

## Pixel Frog — Tiny Swords OLD CC0 version

- Official page: https://pixelfrog-assets.itch.io/tiny-swords
- Official download flow: https://pixelfrog-assets.itch.io/tiny-swords/purchase
- Exact official file label: **TS_old version_CC0 Licensed** (2.6 MB), released 2024-01-03.
- Official file: https://pixelfrog-assets.itch.io/tiny-swords/file/9428013?source=game_download
- Downloaded archive: `TS-old-CC0.zip`, containing `Tiny Swords (Update 010)`.
- Archive SHA-256: `e4d79bd4514bad153cfa1cc8f4c8d8bf10ed39bf69bd98b83bdc46c03d14bb9c`.
- License: [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/), as explicitly identified by the official file label.
- This is the OLD CC0 archive, separate from the newer pack with a custom license. The old archive does not contain a separate license text.
- Used: grass/sand tiles, elevation cliff, water/foam, pine tree/stump, bushes, mushrooms, rocks, grass, bones, the blue tower and its ruined stone foundation.

## Kenney — Tiny Dungeon

- Official page: https://kenney.nl/assets/tiny-dungeon
- License: CC0 1.0. Used closed wooden chest (packed sheet column 6, row 7); coordinates are zero-based.
- Original `License.txt` retained below:

```text
Tiny Dungeon (1.0)

	Created/distributed by Kenney (www.kenney.nl)
	Creation date: 05-07-2022

			------------------------------

	License: (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	This content is free to use in personal, educational and commercial projects.

	Support us by crediting Kenney or www.kenney.nl (this is not mandatory)

			------------------------------

	Donate:   http://support.kenney.nl
	Patreon:  http://patreon.com/kenney/

	Follow on Twitter for updates:
	http://twitter.com/KenneyNL
```

## Kenney — Tower Defense (top-down)

- Official page: https://kenney.nl/assets/tower-defense-top-down
- License: CC0 1.0. Used the blue faceted diamond at pixel rectangle (1408, 448, 64, 64).
- Original `License.txt` retained below:

```text
Tower Defense (top-down) Pack

	by  Kenney Vleugels (Kenney.nl)

			------------------------------

	License (Creative Commons Zero, CC0)
	http://creativecommons.org/publicdomain/zero/1.0/

	You may use these assets in personal and commercial projects.
	Credit (Kenney or www.kenney.nl) would be nice but is not mandatory.

			------------------------------

	Donate:   http://support.kenney.nl
	Request:  http://request.kenney.nl

	Follow on Twitter for updates:
	@KenneyNL
```

## Processing

`tools/map_pipeline.py` crops original tiles and animation frames, removes transparent margins, scales the 16 px Kenney Dungeon chest with nearest-neighbor sampling, and creates biome color variants while preserving original light/detail and tree trunks. Ground uses 22% original value contrast in the forest and 20% elsewhere; paths retain 35%. Shore frames use the artist's original transparent top/bottom silhouettes with exactly the same color transfer as their ground. Rocks, ruins, grass and crystals have coherent biome variants with their original silhouettes and shading. No AI-generated artwork is used. The packed lossless PNG has 2 px padding and edge extrusion around every frame. Original download archives are kept outside the public runtime bundle in `.assets-cache/map-art/`.

Rebuild with `python tools/map_pipeline.py`; optional `--tiny-swords`, `--tiny-dungeon`, and `--tower-defense` arguments accept alternate extracted source directories.
