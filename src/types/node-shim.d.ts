/**
 * vite.config.ts 只用到 node:url 的 fileURLToPath / URL，不需要完整 @types/node。
 */
declare module 'node:url' {
  export function fileURLToPath(url: string | URL): string;
  export class URL {
    constructor(input: string, base?: string | URL);
    toString(): string;
  }
}
