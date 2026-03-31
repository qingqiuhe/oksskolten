import { describe, expect, it } from 'vitest'
import { rewriteBlockedXVideos } from './x-video-fallback'

describe('rewriteBlockedXVideos', () => {
  it('rewrites amplify_video tags to poster links that open the article', () => {
    const html = '<p>Intro</p><video src="https://video.twimg.com/amplify_video/123/vid/avc1/1920x1080/demo.mp4?tag=21" poster="https://pbs.twimg.com/amplify_video_thumb/123/poster.jpg" controls></video>'
    const result = rewriteBlockedXVideos(html, {
      articleUrl: 'https://x.com/example/status/123',
      ogImage: null,
    })

    expect(result).toContain('class="video-fallback-link"')
    expect(result).toContain('href="https://x.com/example/status/123"')
    expect(result).toContain('class="video-fallback-poster"')
    expect(result).toContain('src="https://pbs.twimg.com/amplify_video_thumb/123/poster.jpg"')
    expect(result).not.toContain('<video')
  })

  it('falls back to og_image when amplify_video has no poster', () => {
    const html = '<video src="https://video.twimg.com/amplify_video/123/vid/avc1/1920x1080/demo.mp4?tag=21" controls></video>'
    const result = rewriteBlockedXVideos(html, {
      articleUrl: 'https://x.com/example/status/123',
      ogImage: 'https://pbs.twimg.com/fallback.jpg',
    })

    expect(result).toContain('src="https://pbs.twimg.com/fallback.jpg"')
    expect(result).toContain('Open video on X')
  })

  it('renders a text link when no poster image is available', () => {
    const html = '<video src="https://video.twimg.com/amplify_video/123/vid/avc1/1920x1080/demo.mp4?tag=21" controls></video>'
    const result = rewriteBlockedXVideos(html, {
      articleUrl: 'https://x.com/example/status/123',
      ogImage: null,
    })

    expect(result).toContain('class="video-fallback-text"')
    expect(result).toContain('Open video on X')
    expect(result).not.toContain('<img')
  })

  it('rewrites amplify_video source children', () => {
    const html = '<video controls poster="https://pbs.twimg.com/poster.jpg"><source src="https://video.twimg.com/amplify_video/123/vid/avc1/1920x1080/demo.mp4?tag=21" type="video/mp4"></video>'
    const result = rewriteBlockedXVideos(html, {
      articleUrl: 'https://x.com/example/status/123',
      ogImage: null,
    })

    expect(result).toContain('class="video-fallback-link"')
    expect(result).not.toContain('<video')
  })

  it('keeps ext_tw_video tags unchanged', () => {
    const html = '<video src="https://video.twimg.com/ext_tw_video/123/pu/vid/avc1/1280x720/demo.mp4?tag=19" poster="https://pbs.twimg.com/poster.jpg" controls></video>'
    const result = rewriteBlockedXVideos(html, {
      articleUrl: 'https://x.com/example/status/123',
      ogImage: null,
    })

    expect(result).toContain('<video')
    expect(result).not.toContain('video-fallback-link')
  })
})
