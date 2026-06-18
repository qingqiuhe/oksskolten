import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setupTestDb } from '../__tests__/helpers/testDb.js'
import {
  createFeed,
  insertArticle,
  createConversation,
  getConversations,
  getConversationById,
  updateConversation,
  deleteConversation,
  deleteChatMessage,
  insertChatMessage,
  getChatMessages,
  replaceChatMessages,
  searchArticles,
  getReadingStats,
  markArticleSeen,
  updateArticleContent,
  getDb,
} from '../db.js'

beforeEach(() => {
  setupTestDb()
})

function seedFeed(overrides: Partial<Parameters<typeof createFeed>[0]> = {}) {
  return createFeed({
    name: 'Test Feed',
    url: 'https://example.com',
    ...overrides,
  })
}

function seedArticle(feedId: number, overrides: Partial<Parameters<typeof insertArticle>[0]> = {}) {
  return insertArticle({
    feed_id: feedId,
    title: 'Test Article',
    url: `https://example.com/article/${Math.random()}`,
    published_at: '2025-01-01T00:00:00Z',
    ...overrides,
  })
}

// --- Conversations ---

describe('Conversations', () => {
  it('createConversation → getConversationById', () => {
    const conv = createConversation({ id: 'conv-1', title: 'Test Chat' })
    expect(conv.id).toBe('conv-1')
    expect(conv.title).toBe('Test Chat')
    expect(conv.article_id).toBeNull()

    const found = getConversationById('conv-1')
    expect(found).toBeDefined()
    expect(found!.title).toBe('Test Chat')
  })

  it('returns created conversation without a follow-up row query', () => {
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const conv = createConversation({ id: 'conv-returning', title: 'Returning Chat' })

    expect(conv.title).toBe('Returning Chat')
    expect(preparedSql.some(sql => sql.includes('INSERT INTO conversations') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM conversations WHERE id = ?'))).toBe(false)
  })

  it('createConversation with article_id', () => {
    const feed = seedFeed()
    const articleId = seedArticle(feed.id)

    const conv = createConversation({ id: 'conv-2', article_id: articleId })
    expect(conv.article_id).toBe(articleId)
  })

  it('stores and returns persisted scope metadata', () => {
    const scopePayload = JSON.stringify({
      type: 'list',
      mode: 'loaded_list',
      label: 'Current list',
      count_total: 2,
      count_scoped: 2,
      article_ids: [1, 2],
    })

    const conv = createConversation({
      id: 'conv-scope',
      scope_type: 'list',
      scope_payload_json: scopePayload,
    })

    expect(conv.scope_type).toBe('list')
    expect(conv.scope_payload_json).toBe(scopePayload)

    const found = getConversationById('conv-scope')
    expect(found?.scope_type).toBe('list')
    expect(found?.scope_payload_json).toBe(scopePayload)
  })

  it('getConversationById returns undefined for non-existent', () => {
    expect(getConversationById('nonexistent')).toBeUndefined()
  })

  it('getConversations returns list ordered by updated_at DESC', () => {
    createConversation({ id: 'conv-a', title: 'First' })
    insertChatMessage({ conversation_id: 'conv-a', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
    createConversation({ id: 'conv-b', title: 'Second' })
    insertChatMessage({ conversation_id: 'conv-b', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })

    // Update first conversation to make it more recent
    updateConversation('conv-a', { title: 'Updated First' })

    const convs = getConversations()
    expect(convs).toHaveLength(2)
    expect(convs[0].id).toBe('conv-a')
    expect(convs[1].id).toBe('conv-b')
  })

  it('getConversations excludes conversations with no messages', () => {
    createConversation({ id: 'conv-with-msg' })
    insertChatMessage({ conversation_id: 'conv-with-msg', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
    createConversation({ id: 'conv-empty' })

    const convs = getConversations()
    expect(convs).toHaveLength(1)
    expect(convs[0].id).toBe('conv-with-msg')
  })

  it('getConversations filters by article_id', () => {
    const feed = seedFeed()
    const articleId = seedArticle(feed.id)

    createConversation({ id: 'conv-with-article', article_id: articleId })
    insertChatMessage({ conversation_id: 'conv-with-article', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
    createConversation({ id: 'conv-without-article' })
    insertChatMessage({ conversation_id: 'conv-without-article', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })

    const filtered = getConversations({ article_id: articleId })
    expect(filtered).toHaveLength(1)
    expect(filtered[0].id).toBe('conv-with-article')
  })

  it('getConversations respects limit', () => {
    createConversation({ id: 'conv-1' })
    insertChatMessage({ conversation_id: 'conv-1', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
    createConversation({ id: 'conv-2' })
    insertChatMessage({ conversation_id: 'conv-2', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })
    createConversation({ id: 'conv-3' })
    insertChatMessage({ conversation_id: 'conv-3', role: 'user', content: JSON.stringify([{ type: 'text', text: 'Hi' }]) })

    const limited = getConversations({ limit: 2 })
    expect(limited).toHaveLength(2)
  })

  it('updateConversation updates title', () => {
    createConversation({ id: 'conv-1', title: 'Old Title' })

    const updated = updateConversation('conv-1', { title: 'New Title' })
    expect(updated).toBeDefined()
    expect(updated!.title).toBe('New Title')
    expect(updated!.updated_at).toBeDefined()
  })

  it('returns updated conversation without preselecting or rereading the row', () => {
    createConversation({ id: 'conv-update-returning', title: 'Old Title' })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const updated = updateConversation('conv-update-returning', { title: 'New Title' })

    expect(updated?.title).toBe('New Title')
    expect(preparedSql.some(sql => sql.includes('UPDATE conversations SET') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM conversations WHERE id = ?'))).toBe(false)
  })

  it('updateConversation returns undefined for non-existent', () => {
    expect(updateConversation('nonexistent', { title: 'X' })).toBeUndefined()
  })

  it('deleteConversation removes conversation and cascades messages', () => {
    createConversation({ id: 'conv-1' })
    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'hello' }]),
    })

    expect(deleteConversation('conv-1')).toBe(true)
    expect(getConversationById('conv-1')).toBeUndefined()
    expect(getChatMessages('conv-1')).toHaveLength(0)
  })

  it('deleteConversation returns false for non-existent', () => {
    expect(deleteConversation('nonexistent')).toBe(false)
  })

  it('article deletion sets conversation article_id to NULL', () => {
    const feed = seedFeed()
    const articleId = seedArticle(feed.id, { url: 'https://example.com/to-delete' })
    createConversation({ id: 'conv-1', article_id: articleId })

    // Delete article (ON DELETE SET NULL on conversations)
    getDb().prepare('DELETE FROM articles WHERE id = ?').run(articleId)

    const conv = getConversationById('conv-1')
    expect(conv).toBeDefined()
    expect(conv!.article_id).toBeNull()
  })
})

// --- Chat messages ---

describe('ChatMessages', () => {
  it('insertChatMessage and getChatMessages', () => {
    createConversation({ id: 'conv-1' })

    const msg1 = insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    })
    expect(msg1.role).toBe('user')
    expect(msg1.conversation_id).toBe('conv-1')

    const msg2 = insertChatMessage({
      conversation_id: 'conv-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: 'Hi there!' }]),
    })
    expect(msg2.role).toBe('assistant')

    const messages = getChatMessages('conv-1')
    expect(messages).toHaveLength(2)
    expect(messages[0].id).toBeLessThan(messages[1].id)
  })

  it('returns inserted chat message without a follow-up row query', () => {
    createConversation({ id: 'conv-returning-message' })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    const msg = insertChatMessage({
      conversation_id: 'conv-returning-message',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    })

    expect(msg.role).toBe('user')
    expect(preparedSql.some(sql => sql.includes('INSERT INTO chat_messages') && sql.includes('RETURNING *'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT * FROM chat_messages WHERE id = ?'))).toBe(false)
  })

  it('getChatMessages returns empty array for no messages', () => {
    createConversation({ id: 'conv-1' })
    expect(getChatMessages('conv-1')).toHaveLength(0)
  })

  it('deleteChatMessage removes a single message', () => {
    createConversation({ id: 'conv-1' })
    const msg = insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    })

    expect(deleteChatMessage(msg.id)).toBe(true)
    expect(getChatMessages('conv-1')).toHaveLength(0)
  })

  it('deletes chat message with returning conversation_id instead of a preselect', () => {
    createConversation({ id: 'conv-delete-returning' })
    const msg = insertChatMessage({
      conversation_id: 'conv-delete-returning',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'Hello' }]),
    })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    expect(deleteChatMessage(msg.id)).toBe(true)

    expect(preparedSql.some(sql => sql.includes('DELETE FROM chat_messages') && sql.includes('RETURNING conversation_id'))).toBe(true)
    expect(preparedSql.some(sql => sql.includes('SELECT conversation_id FROM chat_messages WHERE id = ?'))).toBe(false)
  })

  it('insertChatMessage updates conversation updated_at', () => {
    createConversation({ id: 'conv-1' })

    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: 'test' }]),
    })

    const updated = getConversationById('conv-1')
    expect(updated!.updated_at).toBeDefined()
  })

  it('stores Anthropic messages format with tool_use', () => {
    createConversation({ id: 'conv-1' })

    // Simulate a full turn
    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([{ type: 'text', text: '今週のおすすめは？' }]),
    })

    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'assistant',
      content: JSON.stringify([
        { type: 'text', text: '検索してみます。' },
        { type: 'tool_use', id: 'toolu_1', name: 'search_articles', input: { query: 'おすすめ' } },
      ]),
    })

    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'user',
      content: JSON.stringify([
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '[{"title":"Article 1"}]' },
      ]),
    })

    insertChatMessage({
      conversation_id: 'conv-1',
      role: 'assistant',
      content: JSON.stringify([{ type: 'text', text: '以下の記事がおすすめです。' }]),
    })

    const messages = getChatMessages('conv-1')
    expect(messages).toHaveLength(4)

    // Verify messages can be reconstructed for Anthropic API
    const apiMessages = messages.map(m => ({
      role: m.role,
      content: JSON.parse(m.content),
    }))
    expect(apiMessages[0].role).toBe('user')
    expect(apiMessages[1].role).toBe('assistant')
    expect(apiMessages[1].content[1].type).toBe('tool_use')
    expect(apiMessages[2].role).toBe('user')
    expect(apiMessages[2].content[0].type).toBe('tool_result')
    expect(apiMessages[3].role).toBe('assistant')
  })

  it('prepares replaceChatMessages insert statement once per replacement', () => {
    createConversation({ id: 'conv-replace-prepare' })
    const db = getDb()
    const originalPrepare = db.prepare.bind(db)
    const preparedSql: string[] = []
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      preparedSql.push(sql)
      return originalPrepare(sql)
    })

    replaceChatMessages('conv-replace-prepare', Array.from({ length: 5 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: JSON.stringify([{ type: 'text', text: `message ${index}` }]),
    })))

    expect(getChatMessages('conv-replace-prepare')).toHaveLength(5)
    expect(preparedSql.filter(sql => sql.includes('INSERT INTO chat_messages'))).toHaveLength(1)
  })
})

// --- Search ---

describe('searchArticles', () => {
  it('returns articles with structured filters', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/1', title: 'TypeScript Tips' })
    seedArticle(feed.id, { url: 'https://example.com/2', title: 'Python Guide' })

    const results = searchArticles({ feed_id: feed.id })
    expect(results).toHaveLength(2)
  })

  it('filters by unread', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })
    markArticleSeen(id1, true)

    const unread = searchArticles({ unread: true })
    expect(unread).toHaveLength(1)
  })

  it('filters by date range', () => {
    const feed = seedFeed()
    seedArticle(feed.id, {
      url: 'https://example.com/old',
      published_at: '2024-01-01T00:00:00Z',
    })
    seedArticle(feed.id, {
      url: 'https://example.com/new',
      published_at: '2025-06-01T00:00:00Z',
    })

    const results = searchArticles({ since: '2025-01-01T00:00:00Z' })
    expect(results).toHaveLength(1)
    expect(results[0].url).toBe('https://example.com/new')
  })

  it('FTS search matches title', () => {
    const feed = seedFeed()
    seedArticle(feed.id, { url: 'https://example.com/ts', title: 'TypeScript Advanced' })
    seedArticle(feed.id, { url: 'https://example.com/py', title: 'Python Basics' })

    const results = searchArticles({ query: 'TypeScript' })
    expect(results).toHaveLength(1)
    expect(results[0].title).toBe('TypeScript Advanced')
  })

  it('FTS search matches full_text', () => {
    const feed = seedFeed()
    const id = seedArticle(feed.id, { url: 'https://example.com/1', title: 'Article One' })
    updateArticleContent(id, { full_text: 'This article discusses Kubernetes deployment strategies' })

    const results = searchArticles({ query: 'Kubernetes' })
    expect(results).toHaveLength(1)
  })

  it('respects limit', () => {
    const feed = seedFeed()
    for (let i = 0; i < 5; i++) {
      seedArticle(feed.id, { url: `https://example.com/${i}` })
    }

    const results = searchArticles({ limit: 3 })
    expect(results).toHaveLength(3)
  })
})

// --- Reading stats ---

describe('getReadingStats', () => {
  it('returns aggregate stats', () => {
    const feed = seedFeed()
    const id1 = seedArticle(feed.id, { url: 'https://example.com/1' })
    seedArticle(feed.id, { url: 'https://example.com/2' })
    seedArticle(feed.id, { url: 'https://example.com/3' })
    markArticleSeen(id1, true)

    const stats = getReadingStats()
    expect(stats.total).toBe(3)
    expect(stats.read).toBe(1)
    expect(stats.unread).toBe(2)
  })

  it('returns by_feed breakdown', () => {
    const feed1 = seedFeed({ url: 'https://a.com', name: 'Feed A' })
    const feed2 = seedFeed({ url: 'https://b.com', name: 'Feed B' })
    seedArticle(feed1.id, { url: 'https://a.com/1' })
    seedArticle(feed1.id, { url: 'https://a.com/2' })
    seedArticle(feed2.id, { url: 'https://b.com/1' })

    const stats = getReadingStats()
    expect(stats.by_feed).toHaveLength(2)
    expect(stats.by_feed[0].total).toBe(2) // Feed A has more articles
  })

  it('filters by date range', () => {
    const feed = seedFeed()
    seedArticle(feed.id, {
      url: 'https://example.com/old',
      published_at: '2024-01-01T00:00:00Z',
    })
    seedArticle(feed.id, {
      url: 'https://example.com/new',
      published_at: '2025-06-01T00:00:00Z',
    })

    const stats = getReadingStats({ since: '2025-01-01T00:00:00Z' })
    expect(stats.total).toBe(1)
  })
})
