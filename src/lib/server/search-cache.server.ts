import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { kv } from '@vercel/kv'

export interface SearchCache<T> {
  get(key: string): Promise<T | null>
  set(key: string, value: T, ttlSeconds: number): Promise<void>
}

type CacheEnvelope<T> = {
  value: T
  expiresAt: number
}

class MemoryCache<T> implements SearchCache<T> {
  private readonly store = new Map<string, CacheEnvelope<T>>()

  async get(key: string) {
    const record = this.store.get(key)
    if (!record) {
      return null
    }

    if (record.expiresAt <= Date.now()) {
      this.store.delete(key)
      return null
    }

    return record.value
  }

  async set(key: string, value: T, ttlSeconds: number) {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    })
  }
}

class BunSqliteCache<T> implements SearchCache<T> {
  private dbPromise: Promise<any> | null = null
  private readonly path: string

  constructor(path: string) {
    this.path = path
  }

  private async getDb() {
    if (this.dbPromise) {
      return this.dbPromise
    }

    this.dbPromise = (async () => {
      const sqlitePath = this.path
      mkdirSync(dirname(sqlitePath), { recursive: true })

      const { Database } = await import('bun:sqlite')
      const db = new Database(sqlitePath, { create: true })

      db.run(`
        CREATE TABLE IF NOT EXISTS search_cache (
          key TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          expires_at INTEGER NOT NULL
        )
      `)

      db.run('CREATE INDEX IF NOT EXISTS idx_search_cache_expires_at ON search_cache (expires_at)')

      return db
    })()

    return this.dbPromise
  }

  async get(key: string) {
    const db = await this.getDb()

    const row = db
      .query('SELECT payload, expires_at FROM search_cache WHERE key = ?')
      .get(key) as { payload: string; expires_at: number } | null

    if (!row) {
      return null
    }

    if (row.expires_at <= Date.now()) {
      db.query('DELETE FROM search_cache WHERE key = ?').run(key)
      return null
    }

    const parsed = JSON.parse(row.payload) as CacheEnvelope<T>
    return parsed.value
  }

  async set(key: string, value: T, ttlSeconds: number) {
    const db = await this.getDb()
    const expiresAt = Date.now() + ttlSeconds * 1000

    const payload = JSON.stringify({
      value,
      expiresAt,
    } satisfies CacheEnvelope<T>)

    db.query(
      `
      INSERT INTO search_cache (key, payload, expires_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key)
      DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at
      `
    ).run(key, payload, expiresAt)
  }
}

class VercelKvCache<T> implements SearchCache<T> {
  async get(key: string) {
    const payload = await kv.get<string>(key)
    if (!payload) {
      return null
    }

    const parsed = JSON.parse(payload) as CacheEnvelope<T>
    if (parsed.expiresAt <= Date.now()) {
      await kv.del(key)
      return null
    }

    return parsed.value
  }

  async set(key: string, value: T, ttlSeconds: number) {
    const payload = JSON.stringify({
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    } satisfies CacheEnvelope<T>)

    await kv.set(key, payload, { ex: ttlSeconds })
  }
}

const caches = new Map<string, SearchCache<unknown>>()

export function getSearchCache<T>() {
  const provider = process.env.CACHE_PROVIDER ?? 'sqlite'

  if (caches.has(provider)) {
    return caches.get(provider) as SearchCache<T>
  }

  let cache: SearchCache<T>

  if (provider === 'kv') {
    cache = new VercelKvCache<T>()
  } else if ((globalThis as { Bun?: unknown }).Bun) {
    const path = process.env.SQLITE_CACHE_PATH ?? '.cache/search-cache.sqlite'
    cache = new BunSqliteCache<T>(path)
  } else {
    cache = new MemoryCache<T>()
  }

  caches.set(provider, cache as SearchCache<unknown>)
  return cache
}
