import { getSetting, getSettings } from '../db.js'
import { getProvider } from '../providers/llm/index.js'
import { googleTranslate } from '../providers/translate/google-translate.js'
import { deeplTranslate } from '../providers/translate/deepl.js'
import { TASK_DEFAULTS } from '../../shared/models.js'
import { DEFAULT_LANGUAGE, languageName } from '../../shared/lang.js'
import { resolveLLMTaskConfig, type LLMTaskName } from '../llm-task-config.js'

export type AiBillingMode = 'anthropic' | 'gemini' | 'openai' | 'claude-code' | 'ollama' | 'google-translate' | 'deepl'

export interface AiTextResult {
  inputTokens: number
  outputTokens: number
  billingMode: AiBillingMode
  model: string
  monthlyChars?: number
}

export function detectLanguage(fullText: string): string {
  const sample = fullText.slice(0, 1000)
  const jaCount = (sample.match(/[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/g) || []).length
  return jaCount / sample.length > 0.1 ? 'ja' : 'en'
}


function buildSummarizePrompt(fullText: string, lang = getSetting('general.language') || DEFAULT_LANGUAGE): string {
  return `Summarize the following article in ${languageName(lang)}. Follow the format strictly.

## Format
Line 1: A concise 1-2 sentence summary of the article's main point (what the article is about and the author's key argument or conclusion)
Line 2: Empty line
Line 3+: Key points as bullet points. Each item should follow the format "**Point title** — supplementary explanation" (only the title in bold)

## Rules
- Each bullet point must faithfully reflect the article's arguments, claims, or facts
- Maintain the order of the article's flow
- Minimize the number of points (3-4 is ideal). Only add more if the content is truly wide-ranging, but never exceed 7
- Output in Markdown (bullet points start with "- ")
- Do not include any text other than the summary (no headings, preambles, or notes)

--- Article body ---
${fullText}`
}

function buildTranslatePrompt(fullText: string, targetLang: string): string {
  const resolvedTargetLang = languageName(targetLang)
  return `Translate the following article into ${resolvedTargetLang}.
Translate every word faithfully — do not summarize, compress, or omit anything.
The translation must be 1:1 with the original text in volume.
Preserve Markdown formatting. In particular, keep blockquote lines starting with ">".

--- Article body ---
${fullText}`
}

interface TranslateOptions {
  userId?: number | null
  targetLang?: string
}

interface ResolvedTranslateTask {
  userId?: number | null
  provider: string
  targetLang: string
  model: string
  apiKey?: string
  openaiConfig?: {
    apiKey: string
    baseURL: string
  }
}

interface AiTaskConfig {
  task: LLMTaskName
  defaultModel: string
  maxTokens: number
  buildPrompt: (text: string, userLanguage?: string) => string
}

async function runAiTask(
  config: AiTaskConfig,
  fullText: string,
  onText?: (delta: string) => void,
  userId?: number | null,
  userLanguage?: string,
): Promise<{ text: string } & AiTextResult> {
  const resolvedTask = resolveLLMTaskConfig(config.task, userId)
  const providerName = resolvedTask.provider
  const model = resolvedTask.model || config.defaultModel
  const provider = getProvider(providerName)
  const apiKey = provider.requireKey(userId, resolvedTask.openaiConfig)
  const prompt = config.buildPrompt(fullText, userLanguage)
  const result = onText
    ? await provider.streamMessage(
        { model, maxTokens: config.maxTokens, messages: [{ role: 'user', content: prompt }], userId, apiKey, openaiConfig: resolvedTask.openaiConfig },
        onText,
      )
    : await provider.createMessage({
        model,
        maxTokens: config.maxTokens,
        messages: [{ role: 'user', content: prompt }],
        userId,
        apiKey,
        openaiConfig: resolvedTask.openaiConfig,
      })
  return {
    text: result.text,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    billingMode: providerName as AiBillingMode,
    model,
  }
}

const SUMMARIZE_MAX_TOKENS = 2048
const TRANSLATE_MAX_TOKENS = 16384
const TRANSLATE_TARGET_SETTING_KEYS = ['translate.target_lang', 'general.language'] as const
const GOOGLE_TRANSLATE_SETTING_KEYS = [...TRANSLATE_TARGET_SETTING_KEYS, 'api_key.google_translate'] as const
const DEEPL_SETTING_KEYS = [...TRANSLATE_TARGET_SETTING_KEYS, 'api_key.deepl'] as const

const summarizeConfig: AiTaskConfig = {
  task: 'summary',
  defaultModel: TASK_DEFAULTS.summarize.model,
  maxTokens: SUMMARIZE_MAX_TOKENS,
  buildPrompt: buildSummarizePrompt,
}

export async function summarizeArticle(fullText: string, userLanguage?: string): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText, undefined, undefined, userLanguage)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function streamSummarizeArticle(
  fullText: string,
  onText: (delta: string) => void,
  userLanguage?: string,
): Promise<{ summary: string } & AiTextResult> {
  const r = await runAiTask(summarizeConfig, fullText, onText, undefined, userLanguage)
  return { summary: r.text, inputTokens: r.inputTokens, outputTokens: r.outputTokens, billingMode: r.billingMode, model: r.model }
}

export async function translateArticle(fullText: string, userId?: number | null): Promise<{ fullTextTranslated: string } & AiTextResult> {
  return runTranslateTask(fullText, undefined, { userId })
}

export async function streamTranslateArticle(
  fullText: string,
  onText: (delta: string) => void,
  userId?: number | null,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  return runTranslateTask(fullText, onText, { userId })
}

function getResolvedTranslateTargetLang(options?: TranslateOptions): string {
  if (options?.targetLang) return options.targetLang
  const settings = getSettings(TRANSLATE_TARGET_SETTING_KEYS, options?.userId)
  return settings['translate.target_lang'] || settings['general.language'] || DEFAULT_LANGUAGE
}

function getResolvedTranslateTargetLangFromSettings(settings: Record<string, string | undefined>): string {
  return settings['translate.target_lang'] || settings['general.language'] || DEFAULT_LANGUAGE
}

async function runTranslateTask(
  fullText: string,
  onText?: (delta: string) => void,
  options?: TranslateOptions,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const resolved = resolveTranslateTask(options)
  return executeTranslateTask(resolved, fullText, onText)
}

function resolveTranslateTask(options?: TranslateOptions): ResolvedTranslateTask {
  const resolvedTask = resolveLLMTaskConfig('translate', options?.userId)
  const provider = resolvedTask.provider
  if (provider === 'google-translate') {
    const settings = options?.targetLang
      ? getSettings(['api_key.google_translate'], options?.userId)
      : getSettings(GOOGLE_TRANSLATE_SETTING_KEYS, options?.userId)
    const targetLang = options?.targetLang || getResolvedTranslateTargetLangFromSettings(settings)
    const apiKey = settings['api_key.google_translate']
    if (!apiKey) {
      const err = new Error('Google Translate API key is not configured')
      ;(err as any).code = 'GOOGLE_TRANSLATE_KEY_NOT_SET'
      throw err
    }
    return { userId: options?.userId, provider, targetLang, model: 'google-translate-v2', apiKey }
  }
  if (provider === 'deepl') {
    const settings = options?.targetLang
      ? getSettings(['api_key.deepl'], options?.userId)
      : getSettings(DEEPL_SETTING_KEYS, options?.userId)
    const targetLang = options?.targetLang || getResolvedTranslateTargetLangFromSettings(settings)
    const apiKey = settings['api_key.deepl']
    if (!apiKey) {
      const err = new Error('DeepL API key is not configured')
      ;(err as any).code = 'DEEPL_KEY_NOT_SET'
      throw err
    }
    return { userId: options?.userId, provider, targetLang, model: 'deepl-v2', apiKey }
  }
  const targetLang = getResolvedTranslateTargetLang(options)
  const model = resolvedTask.model || TASK_DEFAULTS.translate.model
  const llmProvider = getProvider(provider)
  const apiKey = llmProvider.requireKey(options?.userId, resolvedTask.openaiConfig)
  return { userId: options?.userId, provider, targetLang, model, apiKey, openaiConfig: resolvedTask.openaiConfig }
}

async function executeTranslateTask(
  resolved: ResolvedTranslateTask,
  fullText: string,
  onText?: (delta: string) => void,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  if (resolved.provider === 'google-translate') {
    return runGoogleTranslate(fullText, resolved.targetLang, resolved.userId, resolved.apiKey)
  }
  if (resolved.provider === 'deepl') {
    return runDeepl(fullText, resolved.targetLang, resolved.userId, resolved.apiKey)
  }

  const llmProvider = getProvider(resolved.provider)
  const prompt = buildTranslatePrompt(fullText, resolved.targetLang)
  try {
    const r = onText
      ? await llmProvider.streamMessage(
          { model: resolved.model, maxTokens: TRANSLATE_MAX_TOKENS, messages: [{ role: 'user', content: prompt }], userId: resolved.userId, apiKey: resolved.apiKey, openaiConfig: resolved.openaiConfig },
          onText,
        )
      : await llmProvider.createMessage({
          model: resolved.model,
          maxTokens: TRANSLATE_MAX_TOKENS,
          messages: [{ role: 'user', content: prompt }],
          userId: resolved.userId,
          apiKey: resolved.apiKey,
          openaiConfig: resolved.openaiConfig,
        })
    return {
      fullTextTranslated: r.text,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      billingMode: resolved.provider as AiBillingMode,
      model: resolved.model,
    }
  } catch (err) {
    // Enrich error with provider context for debugging
    const baseUrl = resolved.openaiConfig?.baseURL
    const suffix = baseUrl ? ` [provider: ${baseUrl}]` : ` [provider: ${resolved.provider}]`
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(message + suffix)
  }
}

export function createTextTranslator(
  targetLang: string,
  userId?: number | null,
): (fullText: string) => Promise<{ fullTextTranslated: string } & AiTextResult> {
  const resolved = resolveTranslateTask({ targetLang, userId })
  return (fullText: string) => executeTranslateTask(resolved, fullText)
}

export async function translateText(
  fullText: string,
  targetLang: string,
  userId?: number | null,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  return runTranslateTask(fullText, undefined, { targetLang, userId })
}

export async function streamTranslateText(
  fullText: string,
  onText: (delta: string) => void,
  targetLang: string,
  userId?: number | null,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  return runTranslateTask(fullText, onText, { targetLang, userId })
}

async function runGoogleTranslate(
  fullText: string,
  targetLang: string,
  userId?: number | null,
  apiKey?: string,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const result = await googleTranslate(fullText, targetLang, userId, apiKey)
  return {
    fullTextTranslated: result.translatedText,
    inputTokens: result.characters,
    outputTokens: result.translatedText.length,
    billingMode: 'google-translate',
    model: 'google-translate-v2',
    monthlyChars: result.monthlyChars,
  }
}

async function runDeepl(
  fullText: string,
  targetLang: string,
  userId?: number | null,
  apiKey?: string,
): Promise<{ fullTextTranslated: string } & AiTextResult> {
  const result = await deeplTranslate(fullText, targetLang, userId, apiKey)
  return {
    fullTextTranslated: result.translatedText,
    inputTokens: result.characters,
    outputTokens: result.translatedText.length,
    billingMode: 'deepl',
    model: 'deepl-v2',
    monthlyChars: result.monthlyChars,
  }
}
