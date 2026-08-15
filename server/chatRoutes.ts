import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import type { Message, TextBlock } from './chat/types.js'
import { requireAuth, requireJson, getRequestUserId } from './auth.js'
import { startSSE } from './lib/sse.js'
import { StringIdParams, parseOrBadRequest } from './lib/validation.js'
import type { ArticleDetail } from './db.js'
import type { ChatScope } from '../shared/types.js'

const ScopeFiltersSchema = z.object({
  feed_id: z.number().optional(),
  category_id: z.number().optional(),
  feed_view_type: z.enum(['article', 'social']).optional(),
  unread: z.boolean().optional(),
  bookmarked: z.boolean().optional(),
  liked: z.boolean().optional(),
  read: z.boolean().optional(),
  article_kind: z.enum(['original', 'repost', 'quote']).optional(),
  no_floor: z.boolean().optional(),
  since: z.string().optional(),
  until: z.string().optional(),
})

const ChatScopeSchema = z.union([
  z.object({
    type: z.literal('global'),
  }),
  z.object({
    type: z.literal('article'),
    article_id: z.number(),
  }),
  z.object({
    type: z.literal('list'),
    mode: z.literal('loaded_list'),
    label: z.string().min(1, 'label is required'),
    article_ids: z.array(z.number()),
    source_filters: ScopeFiltersSchema.optional(),
  }),
  z.object({
    type: z.literal('list'),
    mode: z.literal('filtered_list'),
    label: z.string().min(1, 'label is required'),
    source_filters: ScopeFiltersSchema.optional(),
  }),
])

const ChatBody = z.object({
  message: z.string().min(1, 'message is required'),
  conversation_id: z.string().optional(),
  retry: z.boolean().optional(),
  article_id: z.number().optional(),
  context: z.literal('home').optional(),
  scope: ChatScopeSchema.optional(),
  timeZone: z.string().optional(),
})

const ArticleIdQuery = z.object({
  article_id: z.preprocess(
    (val) => { const n = Number(val); return Number.isNaN(n) ? undefined : n },
    z.number().optional(),
  ),
})
import {
  createConversation,
  getConversations,
  getConversationById,
  deleteConversation,
  insertChatMessage,
  getChatMessages,
  replaceChatMessages,
  deleteChatMessagesFrom,
  updateConversation,
  getArticleById,
} from './db.js'
import { runChatTurn } from './chat/adapter.js'
import { normalizeChatError } from './chat/errors.js'
import { buildToolSummary, serializeTurnMetadata, parseTurnMetadata, type TurnStatus } from './chat/turn-metadata.js'
import { repairStoredConversation } from './chat/history.js'
import { buildSystemPrompt, appendArticleContext, getUserLanguage } from './chat/system-prompt.js'
import { generateConversationTitle } from './chat/title-generator.js'
import { generateSuggestions } from './chat/suggestions.js'
import { resolveLLMTaskConfig } from './llm-task-config.js'
import {
  getChatScopeSummary,
  normalizeChatScope,
  parseStoredChatScope,
  scopesEqual,
  serializeChatScope,
  type IncomingChatScope,
} from './chat/scope.js'
import { createChatDebugCollector } from './chat/debug.js'

const CONVERSATION_TITLE_MAX_LENGTH = 50

export function registerChatApi(app: FastifyInstance): void {
  app.register(async function chatRoutes(api) {
    api.addHook('preHandler', requireAuth)

    // --- POST /api/chat — SSE streaming chat ---
    api.post('/api/chat', { preHandler: [requireJson] }, async (request, reply) => {
      const body = parseOrBadRequest(ChatBody, request.body, reply)
      if (!body) return

      const userId = getRequestUserId(request)
      const resolvedTask = resolveLLMTaskConfig('chat', userId)
      const model = resolvedTask.model
      const requestedScope = normalizeChatScope({
        scope: body.scope as IncomingChatScope | undefined,
        article_id: body.article_id,
        context: body.context,
        userId,
      })
      let scope: ChatScope = requestedScope

      // Get or create conversation
      let conversationId = body.conversation_id
      if (!conversationId) {
        conversationId = randomUUID()
        const serializedScope = serializeChatScope(scope)
        createConversation({
          id: conversationId,
          article_id: serializedScope.article_id,
          scope_type: serializedScope.scope_type,
          scope_payload_json: serializedScope.scope_payload_json,
        })
      } else {
        const existing = getConversationById(conversationId)
        if (!existing) {
          reply.status(404).send({ error: 'Conversation not found' })
          return
        }
        scope = parseStoredChatScope(existing)
        if (body.scope && !scopesEqual(scope, requestedScope)) {
          reply.status(409).send({ error: 'Conversation scope mismatch' })
          return
        }
      }

      // Retry: replace the last failed/interrupted turn instead of appending a duplicate
      if (body.retry) {
        const existingMessages = getChatMessages(conversationId)
        let lastUserIndex = -1
        for (let i = existingMessages.length - 1; i >= 0; i--) {
          if (existingMessages[i].role === 'user') {
            lastUserIndex = i
            break
          }
        }
        if (lastUserIndex >= 0) {
          deleteChatMessagesFrom(conversationId, existingMessages[lastUserIndex].id)
        }
      }

      // Restore and repair previous messages so both backends see a valid history.
      const dbMessages = getChatMessages(conversationId)
      const backend = resolvedTask.provider
      const repairedHistory = repairStoredConversation(dbMessages)
      if (repairedHistory.changed) {
        replaceChatMessages(
          conversationId,
          repairedHistory.storedMessages.map(message => ({
            role: message.role,
            content: JSON.stringify(message.content),
            metadata: message.metadata ?? null,
          })),
        )
      }
      const normalizedMessages: Message[] = repairedHistory.messages

      // Add new user message
      const userContent: TextBlock[] = [{ type: 'text', text: body.message }]
      normalizedMessages.push({ role: 'user', content: userContent })
      insertChatMessage({
        conversation_id: conversationId,
        role: 'user',
        content: JSON.stringify(userContent),
      })

      // Build system prompt, optionally with article context
      const userLanguage = getUserLanguage()
      let systemPrompt = buildSystemPrompt(scope, userLanguage)
      if (scope.type === 'article') {
        systemPrompt = appendArticleContext(systemPrompt, scope.article_id)
      }
      const debugScopeArticle = scope.type === 'article'
        ? getArticleById(scope.article_id, userId) as ArticleDetail | undefined
        : undefined
      const debugCollector = createChatDebugCollector({
        provider: backend,
        model,
        system: systemPrompt,
        messages: normalizedMessages,
        scope,
        scopeSummary: getChatScopeSummary(scope, debugScopeArticle),
      })

      // SSE response
      const sse = startSSE(reply)

      // Send conversation_id first
      sse.send({ type: 'conversation_id', conversation_id: conversationId })

      const startTime = Date.now()

      // Detect client abort so an interrupted turn is persisted (not saved as complete)
      const abortController = new AbortController()
      const markClientAborted = () => abortController.abort()
      reply.raw.once('close', markClientAborted)

      try {
        const result = await runChatTurn(backend, {
          messages: normalizedMessages,
          system: systemPrompt,
          model,
          userId,
          openaiConfig: resolvedTask.openaiConfig,
          timeZone: body.timeZone,
          scope,
          userLanguage,
          debugCollector,
          signal: abortController.signal,
          onEvent: (event) => {
            if (event.type === 'done') {
              sse.send({ ...event, elapsed_ms: Date.now() - startTime, model })
            } else {
              sse.send(event as Record<string, unknown>)
            }
          },
        })
        const assistantText = result.allMessages
          .filter(m => m.role === 'assistant')
          .flatMap(m => Array.isArray(m.content) ? m.content : [])
          .filter((b): b is TextBlock => typeof b === 'object' && 'type' in b && b.type === 'text')
          .map(b => b.text)
          .join('')
        sse.send({
          type: 'debug_trace',
          trace: debugCollector.finalize({
            elapsed_ms: Date.now() - startTime,
            text: assistantText,
            usage: result.usage,
          }),
        })

        // Save all new messages from the turn (after the user message we already saved)
        // The result.allMessages starts from our full messages array,
        // so new messages are those after our original count
        const originalCount = normalizedMessages.length
        const turnMessages = result.allMessages.slice(originalCount)
        const turnStatus: TurnStatus = abortController.signal.aborted ? 'interrupted' : 'complete'
        for (let i = 0; i < turnMessages.length; i++) {
          const msg = turnMessages[i]
          const isLastAssistant = msg.role === 'assistant'
            && turnMessages.slice(i + 1).every(m => m.role !== 'assistant')
          insertChatMessage({
            conversation_id: conversationId,
            role: msg.role as 'user' | 'assistant',
            content: JSON.stringify(msg.content),
            metadata: isLastAssistant ? serializeTurnMetadata({
              provider: backend,
              model,
              status: turnStatus,
              elapsed_ms: Date.now() - startTime,
              usage: result.usage,
              tool_summary: buildToolSummary(turnMessages),
            }) : null,
          })
        }

        // Auto-title: if this is the first user message, generate title with sub-agent
        const conv = getConversationById(conversationId)
        if (conv && !conv.title) {
          // Set fallback title immediately
          const fallback = body.message.slice(0, CONVERSATION_TITLE_MAX_LENGTH) + (body.message.length > CONVERSATION_TITLE_MAX_LENGTH ? '…' : '')
          updateConversation(conversationId, { title: fallback })

          // Fire-and-forget: overwrite with AI-generated title
          const assistantText = result.allMessages
            .filter(m => m.role === 'assistant')
            .flatMap(m => Array.isArray(m.content) ? m.content : [])
            .filter((b): b is TextBlock => typeof b === 'object' && 'type' in b && b.type === 'text')
            .map(b => b.text)
            .join('')
          if (assistantText) {
            generateConversationTitle(conversationId, body.message, assistantText, backend, userId, resolvedTask.openaiConfig)
              .catch(() => {/* fallback title already set */})
          }
        }
      } catch (err) {
        const normalized = normalizeChatError(err)
        const aborted = abortController.signal.aborted
        sse.send({
          type: 'debug_trace',
          trace: debugCollector.finalize({
            elapsed_ms: Date.now() - startTime,
            text: '',
            error: normalized.message,
          }),
        })
        // Persist the failed/interrupted turn (keeping the user message) so the
        // conversation can be retried and reloads show the turn outcome.
        const status: TurnStatus = aborted ? 'interrupted' : 'error'
        insertChatMessage({
          conversation_id: conversationId,
          role: 'assistant',
          content: '[]',
          metadata: serializeTurnMetadata({
            provider: backend,
            model,
            status,
            elapsed_ms: Date.now() - startTime,
            error_category: aborted ? 'network_interrupted' : normalized.category,
            error_message: normalized.message,
          }),
        })
        sse.send({
          type: 'error',
          error: normalized.message,
          error_category: aborted ? 'network_interrupted' : normalized.category,
        })
      }

      sse.end()
    })

    // --- GET /api/chat/claude-code-status ---
    api.get('/api/chat/claude-code-status', async (_req, reply) => {
      try {
        const { execFile } = await import('node:child_process')
        const { promisify } = await import('node:util')
        const execFileAsync = promisify(execFile)
        const { stdout } = await execFileAsync('claude', ['auth', 'status', '--json'], {
          timeout: 5000,
          env: { ...process.env, CLAUDECODE: '' },
        })
        reply.send(JSON.parse(stdout))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        if (message.includes('ENOENT') || message.includes('not found')) {
          reply.send({ loggedIn: false, error: 'claude CLI not found' })
        } else {
          reply.send({ loggedIn: false, error: message })
        }
      }
    })

    // --- GET /api/chat/suggestions ---
    api.get('/api/chat/suggestions', async (_request, reply) => {
      const suggestions = generateSuggestions()
      reply.send({ suggestions })
    })

    // --- GET /api/chat/conversations ---
    api.get('/api/chat/conversations', async (request, reply) => {
      const query = ArticleIdQuery.parse(request.query)
      const articleId = query.article_id ?? undefined
      const userId = getRequestUserId(request)
      const conversations = getConversations({ article_id: articleId })
      reply.send({
        conversations: conversations.map((conversation) => {
          const scope = parseStoredChatScope(conversation)
          const article = conversation.article_id != null
            ? getArticleById(conversation.article_id, userId) as ArticleDetail | undefined
            : undefined
          return {
            ...conversation,
            scope_type: scope.type,
            scope_summary: getChatScopeSummary(scope, article),
          }
        }),
      })
    })

    // --- GET /api/chat/:id/messages ---
    api.get('/api/chat/:id/messages', async (request, reply) => {
      const { id } = StringIdParams.parse(request.params)
      const conv = getConversationById(id)
      if (!conv) {
        reply.status(404).send({ error: 'Conversation not found' })
        return
      }
      const dbMessages = getChatMessages(id)
      const repairedHistory = repairStoredConversation(dbMessages)
      if (repairedHistory.changed) {
        replaceChatMessages(
          id,
          repairedHistory.storedMessages.map(message => ({
            role: message.role,
            content: JSON.stringify(message.content),
            metadata: message.metadata ?? null,
          })),
        )
      }
      const messages = repairedHistory.storedMessages.map(message => ({
        role: message.role,
        content: JSON.stringify(message.content),
        metadata: parseTurnMetadata(message.metadata),
      }))
      reply.send({ messages })
    })

    // --- DELETE /api/chat/:id ---
    api.delete('/api/chat/:id', async (request, reply) => {
      const { id } = StringIdParams.parse(request.params)
      const deleted = deleteConversation(id)
      if (!deleted) {
        reply.status(404).send({ error: 'Conversation not found' })
        return
      }
      reply.status(204).send()
    })
  })
}