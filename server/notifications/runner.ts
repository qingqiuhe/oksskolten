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
import { DEFAULT_NOTIFICATION_TIMEZONE, parseNotificationTimezoneOffsetMinutes } from '../../shared/notification-timezone.js'
import { truncateNotificationText } from '../../shared/notification-message.js'

const log = logger.child('notifications')

function parseUtcLikeDate(value: string | null): Date {
  const normalized = value
    ? (/(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`)
    : new Date().toISOString()
  return new Date(normalized)
}

function formatArticleTime(value: string | null, timezone: string): string {
  const offsetMinutes = parseNotificationTimezoneOffsetMinutes(timezone) ?? parseNotificationTimezoneOffsetMinutes(DEFAULT_NOTIFICATION_TIMEZONE) ?? 0
  const base = parseUtcLikeDate(value)
  const shifted = new Date(base.getTime() + offsetMinutes * 60_000)
  const month = String(shifted.getUTCMonth() + 1).padStart(2, '0')
  const day = String(shifted.getUTCDate()).padStart(2, '0')
  const hour = String(shifted.getUTCHours()).padStart(2, '0')
  const minute = String(shifted.getUTCMinutes()).padStart(2, '0')
  return `${month}-${day} ${hour}:${minute}`
}

async function deliverRule(rule: DueNotificationRule): Promise<void> {
  const bindings = listRuleBindings(rule.id)
  const pendingByBinding = new Map<number, ReturnType<typeof getPendingNotificationArticles>>()
  let pendingForTranslation: ReturnType<typeof getPendingNotificationArticles> | null = null

  for (const binding of bindings) {
    const channel = getNotificationChannelById(binding.channel_id, rule.user_id)
    if (!channel || channel.enabled !== 1) continue

    const pending = getPendingNotificationArticles(rule.feed_id, binding.last_notified_article_id, rule.max_articles_per_message)
    pendingByBinding.set(binding.channel_id, pending)
    if (pending.total === 0 || pending.maxArticleId == null) continue
    if (!pendingForTranslation || pending.total > pendingForTranslation.total) {
      pendingForTranslation = pending
    }
  }

  const translationCache = new Map<number, string | null>()
  if (rule.content_mode === 'title_and_body' && rule.translate_enabled === 1 && pendingForTranslation) {
    await Promise.all(pendingForTranslation.articles.map(async (article) => {
      const truncatedBody = truncateNotificationText(article.notification_body_text, rule.max_body_chars)
      if (!truncatedBody) {
        translationCache.set(article.id, null)
        return
      }

      try {
        translationCache.set(
          article.id,
          truncateNotificationText(
            await translateNotificationBodyText(truncatedBody, rule.user_id),
            rule.max_body_chars,
          ),
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

    const pending = pendingByBinding.get(binding.channel_id) ?? getPendingNotificationArticles(rule.feed_id, binding.last_notified_article_id, rule.max_articles_per_message)
    if (pending.total === 0 || pending.maxArticleId == null) {
      continue
    }

    try {
      await sendFeishuDigestMessage({
        channel,
        feedName: rule.feed_name,
        totalCount: pending.total,
        restCount: Math.max(0, pending.total - pending.articles.length),
        contentMode: rule.content_mode,
        articles: pending.articles.map(article => ({
          title: truncateNotificationText(article.title, rule.max_title_chars) ?? '',
          url: article.url,
          displayTime: formatArticleTime(article.published_at ?? article.fetched_at, channel.timezone),
          bodyText: truncateNotificationText(article.notification_body_text, rule.max_body_chars),
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
