import { getDb, getNamed, allNamed } from './connection.js'
import type { Conversation, ChatMessage } from './types.js'
import { getCurrentUserId } from '../identity.js'

function resolveUserId(userId?: number | null): number | null {
  return userId ?? getCurrentUserId()
}

export function createConversation(data: {
  id: string
  title?: string | null
  article_id?: number | null
  scope_type?: 'global' | 'article' | 'list' | null
  scope_payload_json?: string | null
  user_id?: number | null
}): Conversation {
  const scopedUserId = data.user_id ?? resolveUserId()
  return getNamed<Conversation>(`
    INSERT INTO conversations (id, user_id, title, article_id, scope_type, scope_payload_json)
    VALUES (@id, @user_id, @title, @article_id, @scope_type, @scope_payload_json)
    RETURNING *
  `, {
    id: data.id,
    user_id: scopedUserId ?? null,
    title: data.title ?? null,
    article_id: data.article_id ?? null,
    scope_type: data.scope_type ?? null,
    scope_payload_json: data.scope_payload_json ?? null,
  })
}

export function getConversations(opts?: {
  article_id?: number
  limit?: number
  userId?: number | null
}): Conversation[] {
  const conditions: string[] = []
  const params: Record<string, unknown> = {}
  const scopedUserId = resolveUserId(opts?.userId)

  if (scopedUserId != null) {
    conditions.push('c.user_id = @user_id')
    params.user_id = scopedUserId
  }

  if (opts?.article_id) {
    conditions.push('c.article_id = @article_id')
    params.article_id = opts.article_id
  }

  conditions.push('EXISTS (SELECT 1 FROM chat_messages m WHERE m.conversation_id = c.id)')

  const where = 'WHERE ' + conditions.join(' AND ')
  const limit = opts?.limit ?? 50

  return allNamed<Conversation & {
    message_count: number
    article_title: string | null
    article_url: string | null
    article_og_image: string | null
    first_user_message: string | null
    first_assistant_preview: string | null
  }>(`
    SELECT c.*,
           (SELECT COUNT(*) FROM chat_messages m WHERE m.conversation_id = c.id AND m.content LIKE '%"type":"text"%') AS message_count,
           a.title AS article_title,
           a.url AS article_url,
           a.og_image AS article_og_image,
           (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'user' ORDER BY m.id ASC LIMIT 1) AS first_user_message,
           (SELECT content FROM chat_messages m WHERE m.conversation_id = c.id AND m.role = 'assistant' AND content LIKE '%"type":"text"%' ORDER BY m.id ASC LIMIT 1) AS first_assistant_preview
    FROM conversations c
    LEFT JOIN active_articles a ON c.article_id = a.id
    ${where}
    ORDER BY c.updated_at DESC
    LIMIT ${Number(limit)}
  `, params)
}

export function getConversationById(id: string, userId?: number | null): Conversation | undefined {
  const scopedUserId = resolveUserId(userId)
  return getDb().prepare(
    `SELECT * FROM conversations WHERE id = ? ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
  ).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as Conversation | undefined
}

export function updateConversation(
  id: string,
  data: { title?: string },
  userId?: number | null,
): Conversation | undefined {
  const scopedUserId = resolveUserId(userId)

  const fields: string[] = ["updated_at = datetime('now')"]
  const params: Record<string, unknown> = { id }

  if (data.title !== undefined) {
    fields.push('title = @title')
    params.title = data.title
  }

  if (scopedUserId != null) {
    params.user_id = scopedUserId
    return getNamed<Conversation>(`UPDATE conversations SET ${fields.join(', ')} WHERE id = @id AND user_id = @user_id RETURNING *`, params)
  }
  return getNamed<Conversation>(`UPDATE conversations SET ${fields.join(', ')} WHERE id = @id RETURNING *`, params)
}

export function deleteConversation(id: string, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  const result = getDb().prepare(
    `DELETE FROM conversations WHERE id = ? ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
  ).run(...(scopedUserId == null ? [id] : [id, scopedUserId]))
  return result.changes > 0
}

// --- Chat message queries ---

export function insertChatMessage(data: {
  conversation_id: string
  role: 'user' | 'assistant'
  content: string
  metadata?: string | null
  user_id?: number | null
}): ChatMessage {
  const scopedUserId = data.user_id
    ?? resolveUserId()
    ?? (getDb().prepare('SELECT user_id FROM conversations WHERE id = ?').get(data.conversation_id) as { user_id: number | null } | undefined)?.user_id
  return getDb().transaction(() => {
    const message = getNamed<ChatMessage>(`
      INSERT INTO chat_messages (user_id, conversation_id, role, content, metadata)
      VALUES (@user_id, @conversation_id, @role, @content, @metadata)
      RETURNING *
    `, {
      user_id: scopedUserId ?? null,
      conversation_id: data.conversation_id,
      role: data.role,
      content: data.content,
      metadata: data.metadata ?? null,
    })
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(data.conversation_id)
    return message
  })()
}

export function getChatMessages(conversationId: string, userId?: number | null): ChatMessage[] {
  const scopedUserId = resolveUserId(userId)
  return getDb().prepare(
    `SELECT * FROM chat_messages
     WHERE conversation_id = ?
       ${scopedUserId == null ? '' : 'AND user_id = ?'}
     ORDER BY id ASC`,
  ).all(...(scopedUserId == null ? [conversationId] : [conversationId, scopedUserId])) as ChatMessage[]
}

export function deleteChatMessage(id: number, userId?: number | null): boolean {
  const scopedUserId = resolveUserId(userId)
  return getDb().transaction(() => {
    const deleted = getDb().prepare(
      `DELETE FROM chat_messages
       WHERE id = ?
         ${scopedUserId == null ? '' : 'AND user_id = ?'}
       RETURNING conversation_id`,
    ).get(...(scopedUserId == null ? [id] : [id, scopedUserId])) as { conversation_id: string } | undefined
    if (!deleted) return false
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(deleted.conversation_id)
    return true
  })()
}

export function replaceChatMessages(
  conversationId: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string; metadata?: string | null }>,
  userId?: number | null,
): void {
  const scopedUserId = resolveUserId(userId)
  const tx = getDb().transaction(() => {
    getDb().prepare(
      `DELETE FROM chat_messages WHERE conversation_id = ? ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
    ).run(...(scopedUserId == null ? [conversationId] : [conversationId, scopedUserId]))
    const insertMessage = getDb().prepare(`
      INSERT INTO chat_messages (user_id, conversation_id, role, content, metadata)
      VALUES (?, ?, ?, ?, ?)
    `)
    for (const message of messages) {
      insertMessage.run(scopedUserId ?? null, conversationId, message.role, message.content, message.metadata ?? null)
    }
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId)
  })
  tx()
}

/**
 * Delete every message from `fromId` (inclusive) to the end of the conversation.
 * Used to replace a failed/interrupted turn when the user retries it.
 */
export function deleteChatMessagesFrom(conversationId: string, fromId: number, userId?: number | null): number {
  const scopedUserId = resolveUserId(userId)
  const result = getDb().prepare(
    `DELETE FROM chat_messages
     WHERE conversation_id = ?
       AND id >= ?
       ${scopedUserId == null ? '' : 'AND user_id = ?'}`,
  ).run(...(scopedUserId == null ? [conversationId, fromId] : [conversationId, fromId, scopedUserId]))
  if (result.changes > 0) {
    getDb().prepare("UPDATE conversations SET updated_at = datetime('now') WHERE id = ?").run(conversationId)
  }
  return result.changes
}
