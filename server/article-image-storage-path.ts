import { getSetting } from './db/settings.js'
import { dataPath } from './paths.js'

const IMAGE_STORAGE_PATH_CACHE_MS = 5_000

let cachedStoragePath: string | null = null
let cachedUntil = 0

export function invalidateArticleImageStoragePathCache(): void {
  cachedStoragePath = null
  cachedUntil = 0
}

export function getArticleImageStoragePath(now = Date.now()): string {
  if (cachedStoragePath && now < cachedUntil) return cachedStoragePath
  cachedStoragePath = getSetting('images.storage_path') || dataPath('articles', 'images')
  cachedUntil = now + IMAGE_STORAGE_PATH_CACHE_MS
  return cachedStoragePath
}
