// The few Node built-ins the worker uses; the plugin ships without @types/node.
declare module 'node:fs/promises' {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function writeFile(path: string, data: string): Promise<void>
  export function access(path: string, mode?: number): Promise<void>
}
declare module 'node:path' {
  export function join(...parts: string[]): string
  export const delimiter: string
}
// Tests only.
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function readFileSync(path: string, encoding: 'utf8'): string
  export function existsSync(path: string): boolean
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
}
declare module 'node:os' {
  export function tmpdir(): string
}
declare module 'node:child_process' {
  export function execFile(
    file: string,
    args: string[],
    options: { timeout?: number; maxBuffer?: number; windowsHide?: boolean },
    callback: (error: (Error & { code?: unknown; killed?: boolean; signal?: string }) | null, stdout: string, stderr: string) => void
  ): void
}
