import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SERVER_DIR } from './paths'

export interface BuildInfo {
  commit: string
  builtAt: string | null
}

/** Written next to the server bundle by scripts/postbuild.mjs; absent when run from source. */
export function readBuildInfo(): BuildInfo {
  for (const dir of [SERVER_DIR, resolve(SERVER_DIR, '..')]) {
    try {
      const info = JSON.parse(readFileSync(join(dir, 'build-info.json'), 'utf8')) as Partial<BuildInfo>
      return { commit: String(info.commit ?? 'unknown'), builtAt: info.builtAt ?? null }
    } catch {
      // not here, try the next candidate
    }
  }
  return { commit: 'dev', builtAt: null }
}
