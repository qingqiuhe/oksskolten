import { useState, useCallback, useRef } from 'react'
import { fetcher, streamPostChat, type ChatSSEEvent } from '../lib/fetcher'
import type { ChatDebugTrace, ChatScope } from '../../shared/types'

export type TurnStatus = 'complete' | 'error' | 'interrupted'
export type ChatErrorCategory = 'scope_mismatch' | 'provider_setup_required' | 'provider_failure' | 'network_interrupted' | 'unknown'

export interface ChatUsage {
  input_tokens: number
  output_tokens: number
  elapsed_ms: number
  model?: string
}

export interface ToolSummaryItem {
  name: string
  count: number
}

export interface ChatMessage {
  role: 'user' | 'assistant'
  text: string
  usage?: ChatUsage
  debugTrace?: ChatDebugTrace
  /** Turn outcome for assistant messages (persisted server-side, issue #8). */
  status?: TurnStatus
  errorCategory?: ChatErrorCategory
  errorMessage?: string
  toolSummary?: ToolSummaryItem[]
}

interface ToolStatus {
  name: string
  tool_use_id: string
}

const DRAFT_PREFIX = 'chat:draft'

/** localStorage key for chat drafts, scoped by conversation context. */
export function draftKeyFor(scope?: ChatScope, conversationId?: string | null): string {
  let scopePart: string
  if (scope?.type === 'article') scopePart = `article:${scope.article_id}`
  else if (scope?.type === 'list') scopePart = `list:${scope.label}`
  else scopePart = 'global'
  return `${DRAFT_PREFIX}:${scopePart}:${conversationId ?? 'new'}`
}

interface StoredAssistantMetadata {
  status?: TurnStatus
  model?: string
  elapsed_ms?: number
  usage?: { input_tokens: number; output_tokens: number }
  tool_summary?: ToolSummaryItem[]
  error_category?: ChatErrorCategory
  error_message?: string
}

export function useChat(scope?: ChatScope) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [streaming, setStreaming] = useState(false)
  const [thinking, setThinking] = useState(false)
  const [activeTool, setActiveTool] = useState<ToolStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [errorCategory, setErrorCategory] = useState<ChatErrorCategory | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const toolCountsRef = useRef<Map<string, number>>(new Map())

  const runTurn = useCallback(async (
    text: string,
    opts?: { suggestionKey?: string; appendUserMessage?: boolean; replaceLastTurn?: boolean },
  ) => {
    const appendUserMessage = opts?.appendUserMessage ?? true
    const replaceLastTurn = opts?.replaceLastTurn ?? false
    if (!text.trim() || streaming) return

    setError(null)
    setErrorCategory(null)
    setStreaming(true)
    setThinking(false)
    toolCountsRef.current = new Map()

    if (appendUserMessage) {
      // Add user message
      setMessages(prev => [...prev, { role: 'user', text }])
    }

    // Add placeholder assistant message
    setMessages(prev => [...prev, { role: 'assistant', text: '' }])

    const controller = new AbortController()
    abortRef.current = controller
    const currentScope = scopeRef.current

    const updateLastAssistant = (update: (msg: ChatMessage) => ChatMessage) => {
      setMessages(prev => {
        const updated = [...prev]
        for (let i = updated.length - 1; i >= 0; i--) {
          if (updated[i]?.role === 'assistant') {
            updated[i] = update(updated[i])
            break
          }
        }
        return updated
      })
    }

    try {
      await streamPostChat(
        '/api/chat',
        {
          message: text,
          retry: replaceLastTurn,
          conversation_id: conversationId ?? undefined,
          article_id: currentScope?.type === 'article' ? currentScope.article_id : undefined,
          context: currentScope?.type === 'global' ? 'home' : undefined,
          scope: currentScope,
          suggestion_key: opts?.suggestionKey,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        (event: ChatSSEEvent) => {
          if (controller.signal.aborted) return

          switch (event.type) {
            case 'conversation_id':
              setConversationId(event.conversation_id!)
              break
            case 'text_delta':
              setThinking(false)
              setMessages(prev => {
                const updated = [...prev]
                const last = updated[updated.length - 1]
                if (last?.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, text: last.text + event.text }
                }
                return updated
              })
              break
            case 'thinking_start':
              setThinking(true)
              break
            case 'thinking_end':
              setThinking(false)
              break
            case 'tool_use_start':
              setThinking(false)
              setActiveTool({ name: event.name!, tool_use_id: event.tool_use_id! })
              toolCountsRef.current.set(event.name!, (toolCountsRef.current.get(event.name!) ?? 0) + 1)
              break
            case 'tool_use_end':
              setActiveTool(null)
              break
            case 'debug_trace':
              updateLastAssistant(msg => ({ ...msg, debugTrace: event.trace }))
              break
            case 'error':
              setThinking(false)
              setError(event.error || 'Unknown error')
              setErrorCategory((event.error_category as ChatErrorCategory) ?? null)
              updateLastAssistant(msg => ({
                ...msg,
                status: 'error',
                errorCategory: (event.error_category as ChatErrorCategory) ?? 'unknown',
                errorMessage: event.error,
              }))
              break
            case 'done':
              setThinking(false)
              if (event.usage && event.elapsed_ms) {
                const usage: ChatUsage = {
                  input_tokens: event.usage.input_tokens,
                  output_tokens: event.usage.output_tokens,
                  elapsed_ms: event.elapsed_ms,
                  model: event.model,
                }
                updateLastAssistant(msg => ({
                  ...msg,
                  usage,
                  status: 'complete',
                  toolSummary: [...toolCountsRef.current.entries()]
                    .map(([name, count]) => ({ name, count }))
                    .sort((a, b) => b.count - a.count),
                }))
              }
              break
          }
        },
        controller.signal,
      )
    } catch (err) {
      const aborted = controller.signal.aborted
      if (aborted) {
        // User stopped the turn: keep partial text, mark as interrupted
        updateLastAssistant(msg => ({ ...msg, status: 'interrupted' }))
        setErrorCategory('network_interrupted')
        setError(null)
      } else {
        setError(err instanceof Error ? err.message : 'Unknown error')
        setErrorCategory('unknown')
        // Remove the empty assistant placeholder on unexpected failure
        setMessages(prev => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant' && !last.text && !last.status) {
            return prev.slice(0, -1)
          }
          return prev
        })
      }
    } finally {
      setStreaming(false)
      setThinking(false)
      setActiveTool(null)
      abortRef.current = null
    }
  }, [conversationId, streaming])

  const sendMessage = useCallback((text: string, opts?: { suggestionKey?: string }) => {
    void runTurn(text, { suggestionKey: opts?.suggestionKey })
  }, [runTurn])

  /** Abort the in-flight generation. The current turn is marked interrupted. */
  const stop = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  /** Re-run the last user message, replacing the trailing failed/interrupted turn. */
  const retryLast = useCallback(() => {
    if (streaming) return
    let text: string | null = null
    let userIdx = -1
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        text = messages[i].text
        userIdx = i
        break
      }
    }
    if (text == null || userIdx < 0) return
    // Remove the failed turn (its user message and trailing assistant messages),
    // then re-run it fresh. The server replaces the old turn via retry=true.
    setMessages(prev => {
      let idx = -1
      for (let j = prev.length - 1; j >= 0; j--) {
        if (prev[j].role === 'user') { idx = j; break }
      }
      return idx >= 0 ? prev.slice(0, idx) : prev
    })
    void runTurn(text, { appendUserMessage: true, replaceLastTurn: true })
  }, [messages, streaming, runTurn])

  const loadConversation = useCallback(async (id: string) => {
    let data: { messages: Array<{ role: string; content: string; metadata?: StoredAssistantMetadata | null }> }
    try {
      data = await fetcher(`/api/chat/${id}/messages`) as typeof data
    } catch {
      return
    }
    if (!data?.messages) return
    setConversationId(id)

    // Convert DB messages to display messages
    // Only show user text and assistant final text (skip tool_use / tool_result)
    const displayMessages: ChatMessage[] = []
    for (const msg of data.messages) {
      const content = JSON.parse(msg.content)
      if (msg.role === 'user') {
        // Find text content (skip tool_result)
        const textBlock = content.find((b: { type: string; text?: string }) => b.type === 'text')
        if (textBlock) {
          displayMessages.push({ role: 'user', text: textBlock.text })
        }
      } else if (msg.role === 'assistant') {
        const textBlock = content.find((b: { type: string; text?: string }) => b.type === 'text')
        const meta = msg.metadata
        const status = meta?.status === 'error' || meta?.status === 'interrupted' ? meta.status : undefined
        const hasRestorableMeta = meta != null && (status || meta.usage || meta.tool_summary)
        if (textBlock || hasRestorableMeta) {
          displayMessages.push({
            role: 'assistant',
            text: textBlock ? textBlock.text : '',
            ...(hasRestorableMeta ? {
              status,
              errorCategory: meta.error_category,
              errorMessage: meta.error_message,
              usage: meta.usage ? {
                input_tokens: meta.usage.input_tokens,
                output_tokens: meta.usage.output_tokens,
                elapsed_ms: meta.elapsed_ms ?? 0,
                model: meta.model,
              } : undefined,
              toolSummary: meta.tool_summary,
            } : {}),
          })
        }
      }
    }
    setMessages(displayMessages)
  }, [])

  const reset = useCallback(() => {
    setMessages([])
    setConversationId(null)
    setError(null)
    setErrorCategory(null)
    setStreaming(false)
    setThinking(false)
    setActiveTool(null)
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  return {
    messages,
    conversationId,
    streaming,
    thinking,
    activeTool,
    error,
    errorCategory,
    sendMessage,
    stop,
    retryLast,
    loadConversation,
    reset,
  }
}
