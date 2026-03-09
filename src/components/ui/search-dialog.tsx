import { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import useSWR from 'swr'
import { X, Bookmark, ThumbsUp, Circle, CalendarDays, CalendarRange, CalendarFold } from 'lucide-react'
import { fetcher } from '../../lib/fetcher'
import { searchArticles } from '../../lib/search'

/** Maximum number of search results returned from API */
const SEARCH_RESULTS_LIMIT = 20
import { articleUrlToPath } from '../../lib/url'
import { formatRelativeDate } from '../../lib/dateFormat'
import { useI18n } from '../../lib/i18n'
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './command'

interface SearchResult {
  id: number
  title: string
  url: string
  feed_name: string
  published_at: string | null
}

interface SearchDialogProps {
  onClose: () => void
}

export function SearchDialog({ onClose }: SearchDialogProps) {
  const navigate = useNavigate()
  const { t, locale } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [hasSearched, setHasSearched] = useState(false)
  const [indexBuilding, setIndexBuilding] = useState(false)
  const [filterBookmarked, setFilterBookmarked] = useState(false)
  const [filterLiked, setFilterLiked] = useState(false)
  const [filterUnread, setFilterUnread] = useState(false)
  const [datePeriod, setDatePeriod] = useState<'today' | 'week' | 'month' | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined)
  const abortRef = useRef<AbortController>(undefined)

  const { data: recentData } = useSWR<{ articles: SearchResult[] }>(
    '/api/articles?read=1&limit=10',
    fetcher,
  )
  const recentArticles = recentData?.articles ?? []

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const doSearch = useCallback(async (q: string, filters: { bookmarked: boolean; liked: boolean; unread: boolean; since?: string }) => {
    abortRef.current?.abort()
    if (!q.trim()) {
      setResults([])
      setHasSearched(false)
      return
    }
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const data = await searchArticles(q, filters, SEARCH_RESULTS_LIMIT, controller.signal)
      if (data.indexBuilding) {
        setIndexBuilding(true)
        setTimeout(() => doSearch(q, filters), 3000)
        return
      }
      setIndexBuilding(false)
      setResults(data.articles)
      setHasSearched(true)
    } catch {
      // aborted or network error
    }
  }, [])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    let since: string | undefined
    if (datePeriod) {
      const now = new Date()
      if (datePeriod === 'today') {
        since = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
      } else if (datePeriod === 'week') {
        const d = new Date(now)
        d.setDate(d.getDate() - 7)
        since = d.toISOString()
      } else if (datePeriod === 'month') {
        const d = new Date(now)
        d.setMonth(d.getMonth() - 1)
        since = d.toISOString()
      }
    }
    const filters = { bookmarked: filterBookmarked, liked: filterLiked, unread: filterUnread, since }
    debounceRef.current = setTimeout(() => doSearch(query, filters), 300)
    return () => clearTimeout(debounceRef.current)
  }, [query, filterBookmarked, filterLiked, filterUnread, datePeriod, doSearch])

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  function handleSelect(article: SearchResult) {
    onClose()
    void navigate(articleUrlToPath(article.url))
  }

  const displayItems = query.trim() ? results : recentArticles

  return (
    <div className="fixed inset-0 bg-overlay z-[70] flex items-end md:items-start justify-center md:pt-[15vh]" onClick={onClose}>
      <div
        className="w-full max-w-lg md:rounded-xl rounded-t-xl border border-border shadow-xl overflow-hidden select-none max-h-[85vh] md:max-h-none"
        onClick={e => e.stopPropagation()}
      >
        <Command shouldFilter={false}>
          <div className="relative">
            <CommandInput
              value={query}
              onValueChange={setQuery}
              placeholder={t('search.placeholder')}
              autoFocus
            />
            {query && (
              <button
                onClick={() => { setQuery(''); setResults([]); setHasSearched(false) }}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-muted hover:text-text transition-colors"
              >
                <X size={14} strokeWidth={1.5} />
              </button>
            )}
          </div>

          {/* Filter toggles */}
          <div className="flex flex-nowrap gap-1.5 px-3 py-2 border-b border-border select-none overflow-x-auto scrollbar-none">
            <button
              onClick={() => setFilterBookmarked(v => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border whitespace-nowrap shrink-0 ${
                filterBookmarked
                  ? 'border-border bg-bg-subtle text-text'
                  : 'border-border bg-text/15 text-muted hover:text-text'
              }`}
            >
              <Bookmark size={12} strokeWidth={1.5} fill={filterBookmarked ? 'currentColor' : 'none'} />
              {t('search.filterBookmarked')}
            </button>
            <button
              onClick={() => setFilterLiked(v => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border whitespace-nowrap shrink-0 ${
                filterLiked
                  ? 'border-border bg-bg-subtle text-text'
                  : 'border-border bg-text/15 text-muted hover:text-text'
              }`}
            >
              <ThumbsUp size={12} strokeWidth={1.5} fill={filterLiked ? 'currentColor' : 'none'} />
              {t('search.filterLiked')}
            </button>
            <button
              onClick={() => setFilterUnread(v => !v)}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border whitespace-nowrap shrink-0 ${
                filterUnread
                  ? 'border-border bg-bg-subtle text-text'
                  : 'border-border bg-text/15 text-muted hover:text-text'
              }`}
            >
              <Circle size={12} strokeWidth={1.5} fill={filterUnread ? 'currentColor' : 'none'} />
              {t('search.filterUnread')}
            </button>
            <span className="w-px h-4 bg-border/50 self-center mx-0.5 shrink-0" />
            {([
              { key: 'today', Icon: CalendarDays },
              { key: 'week', Icon: CalendarRange },
              { key: 'month', Icon: CalendarFold },
            ] as const).map(({ key, Icon }) => {
              const active = datePeriod === key
              return (
                <button
                  key={key}
                  onClick={() => setDatePeriod(v => v === key ? null : key)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border whitespace-nowrap shrink-0 ${
                    active
                      ? 'border-border bg-bg-subtle text-text'
                      : 'border-border bg-text/15 text-muted hover:text-text'
                  }`}
                >
                  <Icon size={12} strokeWidth={1.5} />
                  {t(`search.period.${key}`)}
                </button>
              )
            })}
          </div>

          <CommandList>
            {indexBuilding && (
              <CommandEmpty>{t('search.indexBuilding')}</CommandEmpty>
            )}
            {!indexBuilding && hasSearched && results.length === 0 && (
              <CommandEmpty>{t('search.noResults')}</CommandEmpty>
            )}
            {displayItems.length > 0 && (
              <CommandGroup>
                {displayItems.map(article => (
                  <CommandItem
                    key={article.id}
                    value={String(article.id)}
                    onSelect={() => handleSelect(article)}
                    className="flex-col items-start gap-0.5"
                  >
                    <span className="text-sm text-text truncate w-full">{article.title}</span>
                    <span className="text-xs text-muted truncate w-full">
                      {article.feed_name}
                      {article.published_at && ` · ${formatRelativeDate(article.published_at, locale, { justNow: t('date.justNow') })}`}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>

          {/* Footer hint */}
          <div className="px-4 py-2 border-t border-border text-[11px] text-muted text-center">
            {t('search.hint')}
          </div>
        </Command>
      </div>
    </div>
  )
}
