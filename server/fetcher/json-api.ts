import { createHash } from 'node:crypto'
import vm from 'node:vm'
import type { FeedViewType } from '../../shared/article-kind.js'
import { resolveFeedViewType } from '../../shared/article-kind.js'
import { TASK_DEFAULTS } from '../../shared/models.js'
import { decodeResponse, DEFAULT_TIMEOUT, USER_AGENT } from './http.js'
import { getProvider } from '../providers/llm/index.js'
import { resolveLLMTaskConfig } from '../llm-task-config.js'
import { parseHttpCacheInterval } from './schedule.js'
import { safeFetch } from './ssrf.js'
import { normalizeDate } from './util.js'
import { cleanUrl } from './url-cleaner.js'

const TRANSFORM_TIMEOUT_MS = 100

export interface JsonApiSourceConfig {
  version: 1
  transform_script: string
}

export interface JsonApiItem {
  url: string
  title: string
  published_at: string | null
  excerpt: string | null
  content_html: string | null
  content_text: string | null
  og_image: string | null
}

export interface JsonApiFeedMeta {
  title: string | null
  icon_url: string | null
  view_type: FeedViewType | null
}

export interface JsonApiTransformResult {
  meta: JsonApiFeedMeta
  items: JsonApiItem[]
  warnings: string[]
  receivedCount: number
}

export interface FetchJsonApiResult extends JsonApiTransformResult {
  notModified: boolean
  etag: string | null
  lastModified: string | null
  contentHash: string | null
  httpCacheSeconds: number | null
}

export interface GeneratedJsonApiTransform {
  transform_script: string
  provider: string
  model: string
}

function normalizeText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeHttpsUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  try {
    const parsed = new URL(trimmed)
    return parsed.protocol === 'https:' ? parsed.toString() : null
  } catch {
    return null
  }
}

function normalizeItem(rawItem: unknown, index: number, warnings: string[]): JsonApiItem | null {
  if (!rawItem || typeof rawItem !== 'object') {
    warnings.push(`items[${index}] must be an object`)
    return null
  }

  const item = rawItem as Record<string, unknown>
  const title = normalizeText(item.title)
  if (!title) {
    warnings.push(`items[${index}] is missing title`)
    return null
  }

  const rawUrl = normalizeText(item.url)
  if (!rawUrl) {
    warnings.push(`items[${index}] is missing url`)
    return null
  }

  const cleanedUrl = cleanUrl(rawUrl)
  if (!cleanedUrl.startsWith('https://')) {
    warnings.push(`items[${index}] url must use https://`)
    return null
  }

  return {
    url: cleanedUrl,
    title,
    published_at: normalizeDate(normalizeText(item.published_at)),
    excerpt: normalizeText(item.excerpt),
    content_html: normalizeText(item.content_html),
    content_text: normalizeText(item.content_text),
    og_image: normalizeHttpsUrl(item.og_image),
  }
}

function normalizeMeta(raw: unknown, warnings: string[]): JsonApiFeedMeta {
  if (!raw || typeof raw !== 'object') {
    return { title: null, icon_url: null, view_type: null }
  }

  const record = raw as Record<string, unknown>
  const rawViewType = record.view_type
  const view_type = rawViewType === 'article' || rawViewType === 'social'
    ? rawViewType
    : null

  if (rawViewType != null && view_type == null) {
    warnings.push('transform output view_type must be "article" or "social"')
  }

  return {
    title: normalizeText(record.title),
    icon_url: normalizeHttpsUrl(record.icon_url),
    view_type,
  }
}

export function stringifyJsonApiSourceConfig(config: JsonApiSourceConfig): string {
  return JSON.stringify(config)
}

export function parseJsonApiSourceConfig(raw: string | null | undefined): JsonApiSourceConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (parsed.version !== 1 || typeof parsed.transform_script !== 'string' || !parsed.transform_script.trim()) {
      return null
    }
    return {
      version: 1,
      transform_script: parsed.transform_script,
    }
  } catch {
    return null
  }
}

export function inferJsonApiViewType(items: JsonApiItem[]): FeedViewType | null {
  if (items.length === 0) return null
  const socialCount = items.reduce((count, item) => (
    resolveFeedViewType({ url: item.url }) === 'social' ? count + 1 : count
  ), 0)
  return socialCount > items.length / 2 ? 'social' : 'article'
}

function sampleJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, 3).map(sampleJsonValue)
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).slice(0, 20)
    return Object.fromEntries(entries.map(([key, entryValue]) => [key, sampleJsonValue(entryValue)]))
  }
  return value
}

function stringifySampleJson(value: unknown): string {
  const sampled = sampleJsonValue(value)
  const text = JSON.stringify(sampled, null, 2)
  return text.length > 12_000 ? `${text.slice(0, 12_000)}\n...` : text
}

function buildGenerateTransformPrompt(endpointUrl: string, response: unknown): string {
  return `You are generating a JavaScript transform function for Oksskolten JSON API feeds.

Return only a JavaScript function expression. Do not use markdown fences.

Feed endpoint:
${endpointUrl}

The function must have this signature:
({ response, endpointUrl, fetchedAt, helpers }) => ...

It may return either:
1. an array of items
2. an object like { title?, icon_url?, view_type?, items: [...] }

Each item should use these fields:
- url: string, required, final article URL, must be https://
- title: string, required
- published_at: string | null
- excerpt: string | null
- content_text: string | null
- content_html: string | null
- og_image: string | null

Rules:
- Be defensive. If response is unusable, return []
- Prefer content_text for plain text/full body fields
- Prefer content_html only when the API clearly returns rich HTML
- Use null for missing optional fields
- If dates are inconsistent, use helpers.normalizeDate(...)
- If URLs may contain tracking params, use helpers.cleanUrl(...)
- Do not use fetch, imports, timers, or external libraries
- Keep the function compact and readable

Sample response JSON:
${stringifySampleJson(response)}`
}

function runTransformScript(response: unknown, endpointUrl: string, transformScript: string): unknown {
  const sandbox = {
    response,
    endpointUrl,
    fetchedAt: new Date().toISOString(),
    helpers: Object.freeze({
      cleanUrl,
      normalizeDate,
    }),
    __result: undefined as unknown,
  }

  const code = `
"use strict";
const __transform = (${transformScript});
if (typeof __transform !== 'function') {
  throw new Error('transform_script must evaluate to a function');
}
__result = __transform({ response, endpointUrl, fetchedAt, helpers });
`

  vm.createContext(sandbox)
  new vm.Script(code).runInContext(sandbox, { timeout: TRANSFORM_TIMEOUT_MS })
  return sandbox.__result
}

export function normalizeJsonApiOutput(rawOutput: unknown): JsonApiTransformResult {
  let rawItems: unknown[]
  let metaSource: unknown = null

  if (Array.isArray(rawOutput)) {
    rawItems = rawOutput
  } else if (rawOutput && typeof rawOutput === 'object' && Array.isArray((rawOutput as { items?: unknown[] }).items)) {
    rawItems = (rawOutput as { items: unknown[] }).items
    metaSource = rawOutput
  } else {
    throw new Error('transform_script must return an array or an object with an items array')
  }

  const warnings: string[] = []
  const seenUrls = new Set<string>()
  const items: JsonApiItem[] = []

  rawItems.forEach((rawItem, index) => {
    const normalized = normalizeItem(rawItem, index, warnings)
    if (!normalized) return
    if (seenUrls.has(normalized.url)) {
      warnings.push(`items[${index}] has duplicate url`)
      return
    }
    seenUrls.add(normalized.url)
    items.push(normalized)
  })

  return {
    meta: normalizeMeta(metaSource, warnings),
    items,
    warnings,
    receivedCount: rawItems.length,
  }
}

export async function fetchAndTransformJsonApiFeed(input: {
  endpointUrl: string
  transformScript: string
  etag?: string | null
  lastModified?: string | null
  lastContentHash?: string | null
  skipCache?: boolean
}): Promise<FetchJsonApiResult> {
  const headers: Record<string, string> = {
    'Accept': 'application/json',
    'User-Agent': USER_AGENT,
  }

  if (!input.skipCache && input.etag) headers['If-None-Match'] = input.etag
  if (!input.skipCache && input.lastModified) headers['If-Modified-Since'] = input.lastModified

  const res = await safeFetch(input.endpointUrl, {
    headers,
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })

  if (res.status === 304) {
    return {
      meta: { title: null, icon_url: null, view_type: null },
      items: [],
      warnings: [],
      receivedCount: 0,
      notModified: true,
      etag: input.etag ?? null,
      lastModified: input.lastModified ?? null,
      contentHash: input.lastContentHash ?? null,
      httpCacheSeconds: null,
    }
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const body = await decodeResponse(res)
  const contentHash = createHash('sha256').update(body).digest('hex')
  if (!input.skipCache && input.lastContentHash && input.lastContentHash === contentHash) {
    return {
      meta: { title: null, icon_url: null, view_type: null },
      items: [],
      warnings: [],
      receivedCount: 0,
      notModified: true,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      contentHash,
      httpCacheSeconds: parseHttpCacheInterval(res.headers),
    }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('Response is not valid JSON')
  }

  const transformed = runTransformScript(parsed, input.endpointUrl, input.transformScript)
  const normalized = normalizeJsonApiOutput(transformed)
  if (normalized.items.length === 0) {
    throw new Error('transform_script produced no valid items')
  }

  return {
    ...normalized,
    notModified: false,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    contentHash,
    httpCacheSeconds: parseHttpCacheInterval(res.headers),
  }
}

export async function generateJsonApiTransformScript(
  endpointUrl: string,
  userId?: number | null,
): Promise<GeneratedJsonApiTransform> {
  const resolvedTask = resolveLLMTaskConfig('chat', userId)
  const providerName = resolvedTask.provider
  const model = resolvedTask.model || TASK_DEFAULTS.chat.model
  const provider = getProvider(providerName)
  provider.requireKey(userId, resolvedTask.openaiConfig)

  const res = await safeFetch(endpointUrl, {
    headers: {
      'Accept': 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT),
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`)
  }

  const body = await decodeResponse(res)
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('Response is not valid JSON')
  }

  const result = await provider.createMessage({
    model,
    maxTokens: 1600,
    userId,
    openaiConfig: resolvedTask.openaiConfig,
    messages: [
      {
        role: 'user',
        content: buildGenerateTransformPrompt(endpointUrl, parsed),
      },
    ],
  })

  const transform_script = result.text.trim()
  if (!transform_script) {
    throw new Error('Model returned an empty transform script')
  }

  return {
    transform_script,
    provider: providerName,
    model,
  }
}
