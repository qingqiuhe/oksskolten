import {
  getNotificationChannelById,
  getPendingNotificationArticles,
  listDueNotificationRules,
  listRuleBindings,
  markNotificationBindingDelivered,
  markNotificationBindingError,
  markNotificationRuleChecked,
} from '../db.js'
import { logger } from '../logger.js'
import { sendFeishuDigestMessage } from './feishu.js'

const log = logger.child('notifications')

function formatArticleTime(value: string | null): string {
  const date = value ? new Date(value) : new Date()
  const formatter = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date).replace(/\//g, '-')
}

export async function runNotificationChecks(): Promise<void> {
  const dueRules = listDueNotificationRules()
  for (const rule of dueRules) {
    const bindings = listRuleBindings(rule.id)
    for (const binding of bindings) {
      const channel = getNotificationChannelById(binding.channel_id, rule.user_id)
      if (!channel || channel.enabled !== 1) continue

      const pending = getPendingNotificationArticles(rule.feed_id, binding.last_notified_article_id)
      if (pending.total === 0 || pending.maxArticleId == null) {
        continue
      }

      try {
        await sendFeishuDigestMessage({
          channel,
          feedName: rule.feed_name,
          totalCount: pending.total,
          restCount: Math.max(0, pending.total - pending.articles.length),
          articles: pending.articles.map(article => ({
            title: article.title,
            url: article.url,
            displayTime: formatArticleTime(article.published_at ?? article.fetched_at),
            bodyText: article.notification_body_text,
            mediaUrls: article.notification_media_json ? JSON.parse(article.notification_media_json) as string[] : [],
          })),
        })
        markNotificationBindingDelivered(rule.id, binding.channel_id, pending.maxArticleId)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        log.error({ err, ruleId: rule.id, channelId: binding.channel_id }, 'notification delivery failed')
        markNotificationBindingError(rule.id, binding.channel_id, message)
      }
    }

    markNotificationRuleChecked(rule.id, rule.check_interval_minutes)
  }
}
