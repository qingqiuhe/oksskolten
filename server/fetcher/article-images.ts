import path from 'node:path'
import fs from 'node:fs'
import crypto from 'node:crypto'
import { safeFetch } from './ssrf.js'
import { USER_AGENT } from './http.js'
import { getSetting, getSettings } from '../db/settings.js'
import { updateArticleContent, markImagesArchived, clearImagesArchived } from '../db/articles.js'
import { logger } from '../logger.js'
import { dataPath } from '../paths.js'

const log = logger.child('fetcher')

const ARTICLE_IMAGE_SETTING_KEYS = [
  'images.enabled',
  'images.storage_path',
  'images.max_size_mb',
  'images.storage',
  'images.upload_url',
  'images.upload_resp_path',
  'images.upload_field',
  'images.upload_headers',
] as const
type ArticleImageSettingKey = typeof ARTICLE_IMAGE_SETTING_KEYS[number]
type ArticleImageSettings = Record<ArticleImageSettingKey, string | undefined>

export function getArticleImageSettings(): ArticleImageSettings {
  return getSettings(ARTICLE_IMAGE_SETTING_KEYS) as ArticleImageSettings
}

// Default images directory, can be overridden by settings
function getImagesDir(settings?: Pick<ArticleImageSettings, 'images.storage_path'>): string {
  const custom = settings?.['images.storage_path'] ?? getSetting('images.storage_path')
  return custom || dataPath('articles', 'images')
}

function getMaxSizeBytes(settings?: Pick<ArticleImageSettings, 'images.max_size_mb'>): number {
  const val = settings?.['images.max_size_mb'] ?? getSetting('images.max_size_mb')
  return (val ? Number(val) : 10) * 1024 * 1024
}

export function isImageArchivingEnabled(settings?: Pick<ArticleImageSettings, 'images.enabled'>): boolean {
  const enabled = settings?.['images.enabled'] ?? getSetting('images.enabled')
  return enabled === '1' || enabled === 'true'
}

export interface RemoteUploadConfig {
  uploadUrl: string
  headers: Record<string, string>
  fieldName: string
  respPath: string
}

export function getRemoteConfig(settings: ArticleImageSettings = getArticleImageSettings()): RemoteUploadConfig | null {
  const mode = settings['images.storage']
  if (mode !== 'remote') return null

  const uploadUrl = settings['images.upload_url']
  const respPath = settings['images.upload_resp_path']
  if (!uploadUrl || !respPath) return null

  const fieldName = settings['images.upload_field'] ?? 'image'
  let headers: Record<string, string> = {}
  const headersRaw = settings['images.upload_headers']
  if (headersRaw) {
    try {
      headers = JSON.parse(headersRaw)
    } catch {
      return null
    }
  }

  return { uploadUrl, headers, fieldName, respPath }
}

export function extractByDotPath(obj: unknown, dotPath: string): unknown {
  const keys = dotPath.split('.')
  let current: unknown = obj
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[key]
  }
  return current
}

function extFromUrl(url: string): string {
  try {
    const pathname = new URL(url).pathname
    const ext = path.extname(pathname).split('?')[0].toLowerCase()
    if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.avif'].includes(ext)) {
      return ext
    }
  } catch {
    // ignore
  }
  return '.jpg'
}

async function uploadImageToRemote(
  buffer: Buffer,
  filename: string,
  config: RemoteUploadConfig,
): Promise<string | null> {
  try {
    const ext = path.extname(filename).toLowerCase()
    const mimeMap: Record<string, string> = {
      '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.avif': 'image/avif',
    }
    const mime = mimeMap[ext] ?? 'image/jpeg'
    const formData = new FormData()
    formData.append(config.fieldName, new Blob([new Uint8Array(buffer)], { type: mime }), filename)

    const res = await safeFetch(config.uploadUrl, {
      method: 'POST',
      headers: config.headers,
      body: formData,
      signal: AbortSignal.timeout(30_000),
    })

    if (!res.ok) {
      log.warn(`Remote image upload failed: ${res.status}`)
      return null
    }

    const json = await res.json()
    const url = extractByDotPath(json, config.respPath)
    if (!url || typeof url !== 'string') {
      log.warn(`Could not extract URL from remote response at path "${config.respPath}"`)
      return null
    }
    return url
  } catch (err) {
    log.warn('Remote image upload error:', err)
    return null
  }
}

/**
 * Archive images from an article's markdown full_text.
 * Downloads each image, saves locally or uploads remotely, and rewrites the markdown URLs.
 */
export async function archiveArticleImages(
  articleId: number,
  fullText: string,
  settings: ArticleImageSettings = getArticleImageSettings(),
): Promise<{ rewrittenText: string; downloaded: number; errors: number }> {
  const maxSize = getMaxSizeBytes(settings)
  const remoteConfig = getRemoteConfig(settings)
  const isRemoteMode = settings['images.storage'] === 'remote'
  const imagesDir = isRemoteMode ? null : getImagesDir(settings)

  // Remote mode but config is incomplete → skip
  if (isRemoteMode && !remoteConfig) {
    clearImagesArchived(articleId)
    return { rewrittenText: fullText, downloaded: 0, errors: 0 }
  }

  if (imagesDir) {
    fs.mkdirSync(imagesDir, { recursive: true })
  }

  // Match markdown images: ![alt](url)
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g
  let match: RegExpExecArray | null
  const replacements: Array<{ original: string; replacement: string }> = []
  let downloaded = 0
  let errors = 0

  while ((match = imageRegex.exec(fullText)) !== null) {
    const [fullMatch, alt, imageUrl] = match

    // Skip already-local URLs
    if (imageUrl.startsWith('/api/articles/images/')) continue
    // Skip data URIs
    if (imageUrl.startsWith('data:')) continue

    try {
      const res = await safeFetch(imageUrl, {
        headers: { 'User-Agent': USER_AGENT },
        signal: AbortSignal.timeout(30_000),
      })

      if (!res.ok) {
        errors++
        continue
      }

      const contentLength = res.headers.get('content-length')
      if (contentLength && Number(contentLength) > maxSize) {
        errors++
        continue
      }

      const buffer = Buffer.from(await res.arrayBuffer())
      if (buffer.length > maxSize) {
        errors++
        continue
      }

      const hash = crypto.createHash('sha256').update(imageUrl).digest('hex').slice(0, 12)
      const ext = extFromUrl(imageUrl)
      const filename = `${articleId}_${hash}${ext}`

      if (remoteConfig) {
        const remoteUrl = await uploadImageToRemote(buffer, filename, remoteConfig)
        if (remoteUrl) {
          replacements.push({ original: fullMatch, replacement: `![${alt}](${remoteUrl})` })
          downloaded++
        }
        // If upload fails, keep original URL
      } else {
        // Local mode
        const filepath = path.join(imagesDir!, filename)
        fs.writeFileSync(filepath, buffer)
        downloaded++
        const localUrl = `/api/articles/images/${filename}`
        replacements.push({ original: fullMatch, replacement: `![${alt}](${localUrl})` })
      }
    } catch {
      errors++
    }
  }

  let rewrittenText = fullText
  for (const { original, replacement } of replacements) {
    rewrittenText = rewrittenText.replace(original, replacement)
  }

  // Update article content and mark as archived
  if (replacements.length > 0) {
    updateArticleContent(articleId, { full_text: rewrittenText })
  }
  markImagesArchived(articleId)

  return { rewrittenText, downloaded, errors }
}

/**
 * Delete archived images for an article.
 */
export function deleteArticleImages(articleId: number): number {
  const imagesDir = getImagesDir()
  if (!fs.existsSync(imagesDir)) return 0

  const prefix = `${articleId}_`
  const files = fs.readdirSync(imagesDir).filter(f => f.startsWith(prefix))
  for (const file of files) {
    fs.unlinkSync(path.join(imagesDir, file))
  }
  return files.length
}
