import type { ChatDebugTrace } from '../../../shared/types'
import { useI18n } from '../../lib/i18n'

function JsonSection({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="space-y-1">
      <h4 className="text-[11px] font-medium text-text">{title}</h4>
      <pre className="max-h-64 overflow-auto rounded-lg border border-border bg-bg-subtle p-3 text-[11px] text-text whitespace-pre-wrap break-all">
        {JSON.stringify(value, null, 2)}
      </pre>
    </div>
  )
}

export function ChatDebugPanel({ trace }: { trace: ChatDebugTrace }) {
  const { t } = useI18n()

  return (
    <details className="mt-3 rounded-lg border border-border bg-bg-subtle/40">
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-muted hover:text-text">
        {t('chat.debug.panelTitle')}
      </summary>
      <div className="space-y-4 border-t border-border px-3 py-3">
        <div className="rounded-lg border border-border bg-bg-subtle px-3 py-2 text-[11px] text-muted">
          <p>{t('chat.debug.liveOnlyNote')}</p>
          <p className="mt-1">
            {trace.meta.provider} · {trace.meta.model} · {trace.meta.elapsed_ms}ms
          </p>
        </div>

        <JsonSection title={t('chat.debug.requestContext')} value={{
          meta: trace.meta,
          system: trace.system,
          input: trace.input,
        }} />
        <JsonSection title={t('chat.debug.providerRequest')} value={trace.provider_request} />
        <JsonSection title={t('chat.debug.toolTimeline')} value={trace.tool_rounds} />
        <JsonSection title={t('chat.debug.providerResponse')} value={trace.provider_response} />
        <JsonSection title={t('chat.debug.output')} value={trace.output} />
      </div>
    </details>
  )
}
