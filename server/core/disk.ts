import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { FeedPayload } from '../../shared/feeds'

export interface StoredSnapshot {
  updatedAt: number
  payload: FeedPayload
}

export interface DiskStore {
  read(id: string): Promise<StoredSnapshot | null>
  write(id: string, snapshot: StoredSnapshot): Promise<void>
}

/**
 * Last-good copies of slow-changing feeds, so a process that was stopped for being idle
 * does not have to download them again the moment it wakes. Strictly best effort: the
 * host documents no persistent folder, so every failure here is ignored and the feed
 * simply falls back to its upstream.
 */
export function createDiskStore(dir = process.env.CACHE_DIR || join(tmpdir(), 'pwh-cache')): DiskStore {
  const fileFor = (id: string) => join(dir, `${id}.json`)

  return {
    async read(id) {
      try {
        const stored = JSON.parse(await readFile(fileFor(id), 'utf8')) as Partial<StoredSnapshot>
        if (typeof stored.updatedAt !== 'number' || !stored.payload) return null
        return { updatedAt: stored.updatedAt, payload: stored.payload }
      } catch {
        return null
      }
    },
    async write(id, snapshot) {
      try {
        await mkdir(dir, { recursive: true })
        // Write beside the target and rename, so a reader never sees half a file.
        const temp = `${fileFor(id)}.${process.pid}.tmp`
        await writeFile(temp, JSON.stringify(snapshot))
        await rename(temp, fileFor(id))
      } catch {
        // No writable folder: carry on without persistence.
      }
    },
  }
}
