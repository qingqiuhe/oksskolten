import {
  getNotificationChannelById,
  getPendingNotificationArticles,
  listImmediateNotificationRulesByFeedIds,
  listDueNotificationRules,
  listRuleBindings,
  markNotificationBindingDelivered,
  markNotificationBindingError,
  markNotificationRuleDigestChecked,
  markNotificationRuleImmediateChecked,
  type DueNotificationRule,
} from '../db.js'
import { logger } from '../logger.js'
import { sendFeishuDigestMessage } from './feishu.js'
import { translateNotificationBodyText } from './translation.js'

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

async function deliverRule(rule: DueNotificationRule): Promise<void> {
  const bindings = listRuleBindings(rule.id)
  const pendingByBinding = new Map<number, ReturnType<typeof getPendingNotificationArticles>>()
  let pendingForTranslation: ReturnType<typeof getPendingNotificationArticles> | null = null

  for (const binding of bindings) {
    const channel = getNotificationChannelById(binding.channel_id, rule.user_id)
    if (!channel || channel.enabled !== 1) continue

    const pending = getPendingNotificationArticles(rule.feed_id, binding.last_notified_article_id)
    pendingByBinding.set(binding.channel_id, pending)
    if (pending.total === 0 || pending.maxArticleId == null) continue
    if (!pendingForTranslation || pending.total > pendingForTranslation.total) {
      pendingForTranslation = pending
    }
  }

  const translationCache = new Map<number, string | null>()
  if (rule.translate_enabled === 1 && pendingForTranslation) {
    await Promise.all(pendingForTranslation.articles.map(async (article) => {
      if (!article.notification_body_text) {
        translationCache.set(article.id, null)
        return
      }

      try {
        translationCache.set(
          article.id,
          await translateNotificationBodyText(article.notification_body_text, rule.user_id),
        )
      } catch (err) {
        translationCache.set(article.id, null)
        log.warn({ err, ruleId: rule.id, articleId: article.id }, 'notification translation failed, falling back to source text')
      }
    }))
  }

  let retryPending = false
  for (const binding of bindings) {
    const channel = getNotificationChannelById(binding.channel_id, rule.user_id)
    if (!channel || channel.enabled !== 1) continue

    const pending = pendingByBinding.get(binding.channel_id) ?? getPendingNotificationArticles(rule.feed_id, binding.last_notified_article_id)
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
          bodyTextTranslated: translationCache.get(article.id) ?? null,
          mediaUrls: article.notification_media_json ? JSON.parse(article.notification_media_json) as string[] : [],
        })),
      })
      markNotificationBindingDelivered(rule.id, binding.channel_id, pending.maxArticleId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      log.error({ err, ruleId: rule.id, channelId: binding.channel_id }, 'notification delivery failed')
      markNotificationBindingError(rule.id, binding.channel_id, message)
      retryPending = true
    }
  }

  if (rule.delivery_mode === 'digest') {
    markNotificationRuleDigestChecked(rule.id, rule.check_interval_minutes)
  } else {
    markNotificationRuleImmediateChecked(rule.id, retryPending)
  }
}

export async function runNotificationChecks(): Promise<void> {
  const dueRules = listDueNotificationRules()
  for (const rule of dueRules) {
    await deliverRule(rule)
  }
}

export async function deliverImmediateNotificationsForFeeds(feedIds: number[]): Promise<void> {
  const uniqueFeedIds = [...new Set(feedIds)]
  const rules = listImmediateNotificationRulesByFeedIds(uniqueFeedIds)
  for (const rule of rules) {
    await deliverRule(rule)
  }
}
