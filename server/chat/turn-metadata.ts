import type { ContentBlock, ToolUseBlock, Message } from './types.js'
import type { ChatErrorCategory } from './errors.js'

/**
 * Display-safe assistant-turn metadata persisted alongside chat messages
 * so conversation reloads can restore turn status, usage and tool activity
 * without reparsing ephemeral SSE state (issue #8).
 */
export type TurnStatus = 'complete' | 'error' | 'interrupted'

export interface AssistantTurnMetadata {
  provider: string
  model: string
  status: TurnStatus
  elapsed_ms: number
  usage?: { input_tokens: number; output_tokens: number }
  tool_summary?: Array<{ name: string; count: number }>
  error_category?: ChatErrorCategory
  error_message?: string
}

/** Compact per-tool call counts across the given messages. */
export function buildToolSummary(messages: Message[]): Array<{ name: string; count: number }> {
  const counts = new Map<string, number>()
  for (const message of messages) {
    const blocks = Array.isArray(message.content) ? message.content : []
    for (const block of blocks as ContentBlock[]) {
      if (block.type === 'tool_use') {
        const toolUse = block as ToolUseBlock
        counts.set(toolUse.name, (counts.get(toolUse.name) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

export function serializeTurnMetadata(metadata: AssistantTurnMetadata): string {
  return JSON.stringify(metadata)
}

export function parseTurnMetadata(raw: string | null | undefined): AssistantTurnMetadata | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as AssistantTurnMetadata
    if (parsed && typeof parsed === 'object' && typeof parsed.status === 'string') return parsed
    return null
  } catch {
    return null
  }
}
