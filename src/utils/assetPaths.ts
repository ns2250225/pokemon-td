/**
 * 素材公开路径工具。
 *
 * Vite 的 BASE_URL 在子路径部署时会带前缀，所有 public 资源引用都要经过这里，
 * 避免手写 '/assets/...' 在 GitHub Pages 子目录下 404。
 */
const BASE = import.meta.env.BASE_URL || '/';

function join(path: string): string {
  const b = BASE.endsWith('/') ? BASE : `${BASE}/`;
  return `${b}${path.replace(/^\//, '')}`;
}

export function texturePublicPath(
  kind: 'static' | 'portrait' | 'shiny' | 'icon',
  id: number,
): string {
  const dir = kind === 'static' ? 'sprites' : kind === 'portrait' ? 'portraits' : kind === 'shiny' ? 'shiny' : 'icons';
  return join(`assets/pokemon/${dir}/${id}.webp`);
}

export function atlasPath(id: number): string {
  return join(`assets/pokemon/atlases/${id}.webp`);
}

export function atlasMetaPath(id: number): string {
  return join(`assets/pokemon/atlases/${id}.json`);
}

export function effectPath(group: string, name: string): string {
  return join(`assets/effects/${group}/${name}.png`);
}

export function effectAtlasPath(): string {
  return join('assets/effects/atlas.json');
}

export function assetManifestPath(name: 'pokemon' | 'vfx-sources'): string {
  return join(`assets/manifest-${name}.json`);
}

export { join as joinPublicPath };
