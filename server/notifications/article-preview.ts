import { JSDOM } from 'jsdom'
import { DEFAULT_NOTIFICATION_MAX_BODY_CHARS, truncateNotificationText } from '../../shared/notification-message.js'

const MAX_NOTIFICATION_MEDIA = 3
const MARKDOWN_IMAGE_RE = /!\[([^\]]*)\]\(([^)\s]+(?:\s+"[^"]*")?)\)/g
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\(([^)]+)\)/g

function absolutizeUrl(rawUrl: string | null, articleUrl: string): string | null {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl, articleUrl).toString()
  } catch {
    return rawUrl
  }
}

function stripMarkdownToText(content: string): string {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/<video\b[\s\S]*?<\/video>/gi, ' ')
    .replace(/<picture\b[\s\S]*?<\/picture>/gi, ' ')
    .replace(/<img\b[^>]*\/?>/gi, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(MARKDOWN_LINK_RE, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n /g, '\n')
    .trim()
}

function normalizeBodyText(text: string | null): string | null {
  if (!text) return null
  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) return null
  return truncateNotificationText(normalized, DEFAULT_NOTIFICATION_MAX_BODY_CHARS)
}

function markdownImagesToHtml(content: string): string {
  return content.replace(MARKDOWN_IMAGE_RE, (_match, alt: string, rawUrl: string) => {
    const src = rawUrl.replace(/\s+"[^"]*"$/, '')
    return `<img src="${src}" alt="${alt}">`
  })
}

function extractMediaUrls(content: string, articleUrl: string, ogImage: string | null): string[] {
  const htmlish = markdownImagesToHtml(content)
  const dom = new JSDOM(`<body>${htmlish}</body>`)
  const urls: string[] = []
  const seen = new Set<string>()

  const push = (rawUrl: string | null) => {
    const absolute = absolutizeUrl(rawUrl, articleUrl)?.trim()
    if (!absolute || seen.has(absolute)) return
    seen.add(absolute)
    urls.push(absolute)
  }

  for (const node of dom.window.document.body.querySelectorAll('img, video')) {
    if (node.tagName.toLowerCase() === 'video') {
      push(node.getAttribute('poster'))
    } else {
      push(node.getAttribute('src'))
    }
    if (urls.length >= MAX_NOTIFICATION_MEDIA) break
  }

  if (urls.length === 0 && ogImage) {
    push(ogImage)
  }

  return urls.slice(0, MAX_NOTIFICATION_MEDIA)
}

export interface NotificationPreview {
  notification_body_text: string | null
  notification_media_json: string | null
  notification_media_extracted_at: string | null
}

export function buildNotificationPreview(args: {
  articleUrl: string
  fullText: string | null
  ogImage: string | null
}): NotificationPreview {
  const bodyText = normalizeBodyText(args.fullText ? stripMarkdownToText(args.fullText) : null)
  const mediaUrls = args.fullText ? extractMediaUrls(args.fullText, args.articleUrl, args.ogImage) : (args.ogImage ? [args.ogImage] : [])
  const hasPreview = bodyText !== null || mediaUrls.length > 0

  return {
    notification_body_text: bodyText,
    notification_media_json: mediaUrls.length > 0 ? JSON.stringify(mediaUrls) : null,
    notification_media_extracted_at: hasPreview ? new Date().toISOString() : null,
  }
}
