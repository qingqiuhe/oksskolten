import type { OpenAICompatibleConfig } from '../../llm-task-config.js'

export interface LLMMessageParams {
  model: string
  maxTokens: number
  messages: Array<{ role: string; content: string }>
  systemInstruction?: string
  userId?: number | null
  openaiConfig?: OpenAICompatibleConfig
}

export interface LLMStreamResult {
  text: string
  inputTokens: number
  outputTokens: number
}

export interface LLMProvider {
  name: string
  requireKey(userId?: number | null, openaiConfig?: OpenAICompatibleConfig): void
  createMessage(params: LLMMessageParams): Promise<LLMStreamResult>
  streamMessage(params: LLMMessageParams, onText: (delta: string) => void): Promise<LLMStreamResult>
}
