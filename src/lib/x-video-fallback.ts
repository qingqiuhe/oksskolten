const X_VIDEO_FALLBACK_LINK_CLASS = 'video-fallback-link'
const X_VIDEO_FALLBACK_POSTER_CLASS = 'video-fallback-poster'
const X_VIDEO_FALLBACK_CAPTION_CLASS = 'video-fallback-caption'
const X_VIDEO_FALLBACK_TEXT_CLASS = 'video-fallback-text'
const X_VIDEO_FALLBACK_LABEL = 'Open video on X'

function getVideoSource(video: Element): string | null {
  const directSrc = video.getAttribute('src')
  if (directSrc) return directSrc

  for (const source of video.querySelectorAll('source')) {
    const src = source.getAttribute('src')
    if (src) return src
  }

  return null
}

function isBlockedXVideoSource(src: string | null): boolean {
  if (!src) return false

  try {
    const url = new URL(src)
    return url.hostname === 'video.twimg.com' && url.pathname.includes('/amplify_video/')
  } catch {
    return false
  }
}

function buildFallbackLink(
  doc: Document,
  articleUrl: string,
  posterUrl: string | null,
): HTMLAnchorElement {
  const link = doc.createElement('a')
  link.href = articleUrl
  link.target = '_blank'
  link.rel = 'noopener noreferrer'
  link.className = X_VIDEO_FALLBACK_LINK_CLASS

  if (posterUrl) {
    const poster = doc.createElement('img')
    poster.src = posterUrl
    poster.alt = X_VIDEO_FALLBACK_LABEL
    poster.className = X_VIDEO_FALLBACK_POSTER_CLASS
    link.appendChild(poster)

    const caption = doc.createElement('span')
    caption.className = X_VIDEO_FALLBACK_CAPTION_CLASS
    caption.textContent = X_VIDEO_FALLBACK_LABEL
    link.appendChild(caption)
    return link
  }

  const text = doc.createElement('span')
  text.className = X_VIDEO_FALLBACK_TEXT_CLASS
  text.textContent = X_VIDEO_FALLBACK_LABEL
  link.appendChild(text)
  return link
}

export function rewriteBlockedXVideos(
  html: string,
  options: {
    articleUrl: string
    ogImage: string | null
  },
): string {
  const parser = new DOMParser()
  const doc = parser.parseFromString(html, 'text/html')
  let replaced = false

  for (const video of doc.querySelectorAll('video')) {
    const src = getVideoSource(video)
    if (!isBlockedXVideoSource(src)) continue

    const posterUrl = video.getAttribute('poster') || options.ogImage
    const fallback = buildFallbackLink(doc, options.articleUrl, posterUrl)
    video.replaceWith(fallback)
    replaced = true
  }

  return replaced ? doc.body.innerHTML : html
}
