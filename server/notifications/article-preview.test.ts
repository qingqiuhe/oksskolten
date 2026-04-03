import { describe, it, expect } from 'vitest'
import { buildNotificationPreview } from './article-preview.js'

describe('buildNotificationPreview', () => {
  it('extracts body text and keeps it within 1000 characters', () => {
    const preview = buildNotificationPreview({
      articleUrl: 'https://example.com/post',
      fullText: `# Title

Hello [world](https://example.com/world)

![cover](https://cdn.example.com/cover.jpg)

${'A'.repeat(1200)}`,
      ogImage: null,
    })

    expect(preview.notification_body_text).toContain('Hello world')
    expect(preview.notification_body_text).not.toContain('![')
    expect(Array.from(preview.notification_body_text!).length).toBeLessThanOrEqual(1000)
    expect(preview.notification_body_text!.endsWith('…')).toBe(true)
  })

  it('extracts images in order, including video posters, and falls back to og image', () => {
    const preview = buildNotificationPreview({
      articleUrl: 'https://example.com/post',
      fullText: `
![first](/img/1.jpg)
<video poster="https://cdn.example.com/poster.jpg"></video>
<img src="https://cdn.example.com/third.jpg">
<img src="https://cdn.example.com/fourth.jpg">
      `,
      ogImage: 'https://cdn.example.com/og.jpg',
    })

    expect(JSON.parse(preview.notification_media_json!)).toEqual([
      'https://example.com/img/1.jpg',
      'https://cdn.example.com/poster.jpg',
      'https://cdn.example.com/third.jpg',
    ])
  })

  it('uses og image when no inline media exists', () => {
    const preview = buildNotificationPreview({
      articleUrl: 'https://example.com/post',
      fullText: 'Plain text only',
      ogImage: 'https://cdn.example.com/og.jpg',
    })

    expect(JSON.parse(preview.notification_media_json!)).toEqual([
      'https://cdn.example.com/og.jpg',
    ])
  })
})
