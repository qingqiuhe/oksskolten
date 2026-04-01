import crypto from 'node:crypto'

export interface FeishuWebhookChannel {
  name: string
  webhook_url: string
  secret: string | null
}

function buildSignature(secret: string): { timestamp: string; sign: string } {
  const timestamp = String(Math.floor(Date.now() / 1000))
  const key = `${timestamp}\n${secret}`
  const sign = crypto
    .createHmac('sha256', key)
    .update(Buffer.alloc(0))
    .digest('base64')

  return { timestamp, sign }
}

async function sendFeishuPayload(channel: FeishuWebhookChannel, payload: Record<string, unknown>): Promise<void> {
  const requestBody = channel.secret
    ? { ...payload, ...buildSignature(channel.secret) }
    : payload

  const response = await fetch(channel.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: AbortSignal.timeout(10_000),
  })

  const json = await response.json().catch(() => null) as { code?: number; msg?: string; StatusCode?: number; StatusMessage?: string } | null
  if (!response.ok) {
    throw new Error(`Feishu webhook failed: HTTP ${response.status}`)
  }
  if ((json?.code ?? json?.StatusCode ?? 0) !== 0) {
    throw new Error(json?.msg || json?.StatusMessage || 'Feishu webhook failed')
  }
}

export async function sendFeishuTestMessage(channel: FeishuWebhookChannel): Promise<void> {
  await sendFeishuPayload(channel, {
    msg_type: 'text',
    content: {
      text: 'Oksskolten 提醒测试\n该渠道已配置成功。',
    },
  })
}

export interface FeishuNotificationArticle {
  title: string
  url: string
  displayTime: string
  bodyText: string | null
  bodyTextTranslated: string | null
  mediaUrls: string[]
}

export async function sendFeishuDigestMessage(args: {
  channel: FeishuWebhookChannel
  feedName: string
  totalCount: number
  restCount: number
  articles: FeishuNotificationArticle[]
}): Promise<void> {
  const elements: Array<Record<string, unknown>> = []

  for (const [index, article] of args.articles.entries()) {
    const lines = [
      `**[${article.title}](${article.url})**`,
      `发布时间：${article.displayTime}`,
      article.bodyText ?? '',
      article.bodyTextTranslated ?? '',
      ...article.mediaUrls.map(url => `![](${url})`),
    ].filter(Boolean)

    elements.push({
      tag: 'div',
      text: {
        tag: 'lark_md',
        content: lines.join('\n'),
      },
    })

    if (index < args.articles.length - 1) {
      elements.push({ tag: 'hr' })
    }
  }

  if (args.restCount > 0) {
    elements.push({ tag: 'hr' })
    elements.push({
      tag: 'div',
      text: {
        tag: 'plain_text',
        content: `以及另外 ${args.restCount} 篇，请在 Oksskolten 查看`,
      },
    })
  }

  await sendFeishuPayload(args.channel, {
    msg_type: 'interactive',
    card: {
      schema: '2.0',
      config: { wide_screen_mode: true },
      header: {
        title: {
          tag: 'plain_text',
          content: `${args.feedName} · ${args.totalCount} 条`,
        },
        template: 'blue',
      },
      body: {
        elements,
      },
    },
  })
}
