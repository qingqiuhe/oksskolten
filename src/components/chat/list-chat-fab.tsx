import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { BookOpenText, ChevronDown, MessagesSquare } from 'lucide-react'
import useSWR, { useSWRConfig } from 'swr'
import { useChat } from '../../hooks/use-chat'
import { useI18n } from '../../lib/i18n'
import { fetcher } from '../../lib/fetcher'
import {
  buildFilteredListScope,
  buildLoadedListScope,
  formatScopeSummaryDetail,
} from '../../lib/chat-scope'
import { ChatPanel, type ChatState } from './chat-panel'
import { ConfirmDialog } from '../ui/confirm-dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu'
import type { ChatScope, ListChatScopeFilters, ScopeSummary } from '../../../shared/types'

interface ListChatFabProps {
  listLabel: string
  articleIds: number[]
  sourceFilters: ListChatScopeFilters
  renderTrigger?: (args: { open: boolean; toggle: () => void }) => ReactNode
  hideDefaultTrigger?: boolean
  openSignal?: number
}

interface ConversationSummaryResponse {
  conversations: Array<{
    id: string
    scope_summary?: ScopeSummary | null
  }>
}

interface ListScopePreset {
  key: string
  label: string
  scope: ChatScope
  summary: ScopeSummary
}

interface ListChatSessionProps {
  scope: ChatScope
  scopeSummary: ScopeSummary | null
  scopeControl: ReactNode
  onClose: () => void
  onConversationIdChange: (id: string | null) => void
  onStreamingChange: (streaming: boolean) => void
}

function ListChatSession({
  scope,
  scopeSummary,
  scopeControl,
  onClose,
  onConversationIdChange,
  onStreamingChange,
}: ListChatSessionProps) {
  const chatState = useChat(scope)

  useEffect(() => {
    onConversationIdChange(chatState.conversationId)
  }, [chatState.conversationId, onConversationIdChange])

  useEffect(() => {
    onStreamingChange(chatState.streaming)
  }, [chatState.streaming, onStreamingChange])

  return (
    <ChatPanel
      variant="inline"
      chatState={chatState as ChatState}
      scope={scope}
      scopeSummary={scopeSummary}
      scopeControl={scopeControl}
      onClose={onClose}
    />
  )
}

function hoursAgoIso(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString()
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
}

function makeScopeLabel(listLabel: string, presetLabel: string): string {
  return `${listLabel} · ${presetLabel}`
}

function buildPresetSummary(label: string, detail: string | null = null): ScopeSummary {
  return { type: 'list', label, detail }
}

export function ListChatFab({ listLabel, articleIds, sourceFilters, renderTrigger, hideDefaultTrigger = false, openSignal }: ListChatFabProps) {
  const { t } = useI18n()
  const { mutate: globalMutate } = useSWRConfig()
  const [panelOpen, setPanelOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [selectedPresetKey, setSelectedPresetKey] = useState('loaded')
  const [sessionKey, setSessionKey] = useState(0)
  const [pendingPresetKey, setPendingPresetKey] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [frozenScope, setFrozenScope] = useState<ChatScope | null>(null)
  const [streaming, setStreaming] = useState(false)
  const currentScopeRef = useRef<ChatScope | null>(null)
  const lastOpenSignalRef = useRef<number | null>(null)

  const presets = useMemo<ListScopePreset[]>(() => {
    const loadedLabel = t('chat.scope.loadedList')
    const allLabel = t('chat.scope.all')
    const entries: Array<{ key: string; label: string; filters?: ListChatScopeFilters }> = [
      { key: 'loaded', label: loadedLabel },
      { key: 'all', label: allLabel, filters: sourceFilters },
      { key: '6h', label: t('chat.scope.last6Hours'), filters: { ...sourceFilters, since: hoursAgoIso(6) } },
      { key: '1d', label: t('chat.scope.last1Day'), filters: { ...sourceFilters, since: daysAgoIso(1) } },
      { key: '3d', label: t('chat.scope.last3Days'), filters: { ...sourceFilters, since: daysAgoIso(3) } },
      { key: '7d', label: t('chat.scope.last7Days'), filters: { ...sourceFilters, since: daysAgoIso(7) } },
      { key: '15d', label: t('chat.scope.last15Days'), filters: { ...sourceFilters, since: daysAgoIso(15) } },
    ]

    return entries.map((entry) => {
      if (entry.key === 'loaded') {
        const scope = buildLoadedListScope(makeScopeLabel(listLabel, entry.label), articleIds, sourceFilters)
        return {
          key: entry.key,
          label: entry.label,
          scope,
          summary: buildPresetSummary(
            entry.label,
            articleIds.length > 0 ? t('chat.scope.countSingle', { count: String(articleIds.length) }) : null,
          ),
        }
      }

      const scope = buildFilteredListScope(makeScopeLabel(listLabel, entry.label), entry.filters)
      return {
        key: entry.key,
        label: entry.label,
        scope,
        summary: buildPresetSummary(entry.label, null),
      }
    })
  }, [articleIds, listLabel, sourceFilters, t])

  const selectedPreset = presets.find(preset => preset.key === selectedPresetKey) ?? presets[0]
  const activeScope = frozenScope ?? selectedPreset.scope
  const activeSummary = selectedPreset.summary

  currentScopeRef.current = activeScope

  const { data: conversationData } = useSWR<ConversationSummaryResponse>(
    conversationId ? '/api/chat/conversations' : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const persistedSummary = useMemo(
    () => conversationData?.conversations.find(conv => conv.id === conversationId)?.scope_summary ?? null,
    [conversationData, conversationId],
  )

  const detailText = formatScopeSummaryDetail(persistedSummary ?? activeSummary, t)

  useEffect(() => {
    if (!presets.some(preset => preset.key === selectedPresetKey)) {
      setSelectedPresetKey('loaded')
    }
  }, [presets, selectedPresetKey])

  useEffect(() => {
    if (openSignal == null) return
    if (lastOpenSignalRef.current === null) {
      lastOpenSignalRef.current = openSignal
      return
    }
    if (lastOpenSignalRef.current === openSignal) return
    lastOpenSignalRef.current = openSignal
    setMounted(true)
    setPanelOpen(true)
  }, [openSignal])

  const handleToggle = () => {
    setPanelOpen(prev => !prev)
    if (!mounted) setMounted(true)
  }

  const resetSession = (nextPresetKey: string) => {
    setSelectedPresetKey(nextPresetKey)
    setConversationId(null)
    setFrozenScope(null)
    setStreaming(false)
    setSessionKey(prev => prev + 1)
  }

  const handlePresetChange = (nextPresetKey: string) => {
    if (nextPresetKey === selectedPresetKey || streaming) return
    if (conversationId) {
      setPendingPresetKey(nextPresetKey)
      return
    }
    setSelectedPresetKey(nextPresetKey)
  }

  const scopeControl = (
    <div className="flex min-w-0 max-w-full items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild disabled={streaming}>
          <button
            type="button"
            className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-muted transition-colors hover:bg-hover disabled:opacity-50"
          >
            <span className="truncate">{selectedPreset.label}</span>
            <ChevronDown className="h-3 w-3 shrink-0" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={8}>
          <DropdownMenuRadioGroup value={selectedPreset.key} onValueChange={handlePresetChange}>
            {presets.map(preset => (
              <DropdownMenuRadioItem key={preset.key} value={preset.key}>
                {preset.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {detailText && (
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-bg-subtle px-2 py-0.5 text-[11px] text-muted">
          <BookOpenText className="h-3.5 w-3.5 shrink-0" />
          {detailText}
        </span>
      )}
    </div>
  )

  return (
    <>
      {mounted && (
        <div className={`fixed bottom-[calc(5rem+var(--safe-area-inset-bottom))] left-4 right-4 md:left-auto md:right-6 md:w-[380px] z-50 max-h-[500px] flex flex-col bg-bg-card rounded-xl border border-border shadow-lg ${panelOpen ? '' : 'hidden'}`}>
          <ListChatSession
            key={sessionKey}
            scope={activeScope}
            scopeSummary={persistedSummary ?? activeSummary}
            scopeControl={scopeControl}
            onClose={() => setPanelOpen(false)}
            onConversationIdChange={(id) => {
              setConversationId(id)
              if (id && !frozenScope) {
                setFrozenScope(currentScopeRef.current)
                void globalMutate('/api/chat/conversations')
              }
            }}
            onStreamingChange={setStreaming}
          />
        </div>
      )}

      {renderTrigger?.({ open: panelOpen, toggle: handleToggle })}

      {!hideDefaultTrigger && (
        <button
          type="button"
          onClick={handleToggle}
          className="fixed bottom-[calc(1.5rem+var(--safe-area-inset-bottom))] right-6 z-50 w-12 h-12 rounded-full bg-accent text-accent-text flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity select-none"
          aria-label={t('chat.title')}
        >
          <MessagesSquare className="w-5 h-5" />
        </button>
      )}

      {pendingPresetKey && (
        <ConfirmDialog
          title={t('chat.scope.switchTitle')}
          message={t('chat.scope.switchMessage')}
          confirmLabel={t('chat.scope.switchConfirm')}
          onConfirm={() => {
            resetSession(pendingPresetKey)
            setPendingPresetKey(null)
          }}
          onCancel={() => setPendingPresetKey(null)}
        />
      )}
    </>
  )
}
