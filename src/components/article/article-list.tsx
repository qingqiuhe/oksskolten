import { useState, useRef, useEffect, useCallback, useImperativeHandle, forwardRef, useMemo } from 'react'
import { Fragment } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import useSWRInfinite from 'swr/infinite'
import { useSWRConfig } from 'swr'
import { Languages, Loader2, MessageSquare, Plus, RefreshCw } from 'lucide-react'
import { fetcher } from '../../lib/fetcher'
import { markSeenOnServer } from '../../lib/markSeenWithQueue'
import { useI18n } from '../../lib/i18n'
import { trackRead } from '../../lib/readTracker'
import { articleUrlToPath } from '../../lib/url'
import { useIsTouchDevice } from '../../hooks/use-is-touch-device'
import { useClipFeedId } from '../../hooks/use-clip-feed-id'
import { useAppLayout } from '../../app'
import { ArticleCard, type ArticleDisplayConfig } from './article-card'
import { FeedMetricsBar } from '../feed/feed-metrics-bar'
import { SwipeableArticleCard } from './swipeable-article-card'
import { ArticleOverlay } from './article-overlay'
import { PullToRefresh } from '../layout/pull-to-refresh'
import { useFetchProgressContext } from '../../contexts/fetch-progress-context'
import { toast } from 'sonner'
import { Mascot } from '../ui/mascot'
import { FeedErrorBanner } from '../feed/feed-error-banner'
import { Skeleton } from '../ui/skeleton'
import { ActionChip } from '../ui/action-chip'
import { ListChatFab } from '../chat/list-chat-fab'
import { useKeyboardNavigationContext } from '../../contexts/keyboard-navigation-context'
import { useKeyboardNavigation } from '../../hooks/use-keyboard-navigation'
import { apiDelete, apiPatch, apiPost } from '../../lib/fetcher'
import type { ArticleListItem, FeedWithCounts, InboxSummary } from '../../../shared/types'
import type { LayoutName } from '../../data/layouts'
import { isXFeedSource, type ArticleKind, type FeedViewType } from '../../../shared/article-kind'
import { InboxHeader, type InboxSort, type InboxViewFilter } from './inbox-header'
import { ArticleInlineActions } from './article-inline-actions'
import { InboxGroupHeader } from './inbox-group-header'
import { useUndoSeen } from '../../hooks/use-undo-seen'

interface ArticlesResponse {
  articles: ArticleListItem[]
  total: number
  has_more: boolean
  total_without_floor?: number
  total_all?: number
}

const PAGE_SIZE = 20
const INBOX_SORT_STORAGE_KEY = 'oksskolten.inbox.sort'
const INBOX_GROUP_STORAGE_KEY = 'oksskolten.inbox.group'
const TITLE_TRANSLATE_BATCH_SIZE = 50
type TranslateTitlesStatus = 'idle' | 'loading' | 'active' | 'error'

/** How often (ms) to flush the batch of read article IDs to the server */
const BATCH_FLUSH_INTERVAL = 1500

export interface ArticleListHandle {
  revalidate: () => void
}

interface ArticleListProps {
  listLabel: string
}

function readStoredInboxSort(): InboxSort {
  if (typeof window === 'undefined') return 'newest'
  const stored = window.localStorage.getItem(INBOX_SORT_STORAGE_KEY)
  if (stored === 'score') {
    window.localStorage.setItem(INBOX_SORT_STORAGE_KEY, 'inbox_score')
    return 'inbox_score'
  }
  return stored === 'inbox_score' || stored === 'oldest_unread' ? stored : 'newest'
}

type InboxGroupMode = 'none' | 'day' | 'feed'

function readStoredInboxGroupMode(): InboxGroupMode {
  if (typeof window === 'undefined') return 'none'
  const stored = window.localStorage.getItem(INBOX_GROUP_STORAGE_KEY)
  return stored === 'day' || stored === 'feed' ? stored : 'none'
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date
}

function startOfYesterday() {
  const date = startOfToday()
  date.setDate(date.getDate() - 1)
  return date
}

function dayGroupMeta(article: ArticleListItem, t: ReturnType<typeof useI18n>['t']) {
  const raw = article.published_at
  if (!raw) {
    return { key: 'day:unknown', title: t('inbox.group.unknownDay') }
  }
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) {
    return { key: 'day:unknown', title: t('inbox.group.unknownDay') }
  }
  const today = startOfToday()
  const yesterday = startOfYesterday()
  if (date >= today) return { key: 'day:today', title: t('feeds.today') }
  if (date >= yesterday) return { key: 'day:yesterday', title: t('inbox.group.yesterday') }
  return {
    key: `day:${date.toISOString().slice(0, 10)}`,
    title: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date),
  }
}

export const ArticleList = forwardRef<ArticleListHandle, ArticleListProps>(function ArticleList({ listLabel }, ref) {
  const location = useLocation()
  const navigate = useNavigate()
  const { feedId: feedIdParam, categoryId: categoryIdParam } = useParams<{ feedId?: string; categoryId?: string }>()
  const { settings } = useAppLayout()
  const clipFeedId = useClipFeedId()

  const isInbox = location.pathname === '/inbox'
  const isBookmarks = location.pathname === '/bookmarks'
  const isLikes = location.pathname === '/likes'
  const isHistory = location.pathname === '/history'
  const isClips = location.pathname === '/clips'
  const isCollectionView = isBookmarks || isLikes || isHistory || isClips

  const { data: feedsData } = useSWR<{ feeds: FeedWithCounts[] }>('/api/feeds', fetcher)
  const feedId = feedIdParam ? Number(feedIdParam) : (isClips && clipFeedId ? clipFeedId : undefined)
  const currentFeed = feedId && feedsData ? feedsData.feeds.find(f => f.id === feedId) : undefined
  const categoryId = categoryIdParam ? Number(categoryIdParam) : undefined
  const [showReadArticles, setShowReadArticles] = useState(false)
  const [articleKindFilter, setArticleKindFilter] = useState<ArticleKind | 'all'>('all')
  const [inboxSort, setInboxSort] = useState<InboxSort>(() => readStoredInboxSort())
  const [inboxGroupMode, setInboxGroupMode] = useState<InboxGroupMode>(() => readStoredInboxGroupMode())
  const [inboxViewFilter, setInboxViewFilter] = useState<InboxViewFilter>('all')
  const [inboxChatOpenSignal, setInboxChatOpenSignal] = useState(0)
  const categoryUnreadOnly = !!categoryId && settings.categoryUnreadOnly === 'on'
  const unreadOnly = isInbox || (categoryUnreadOnly && !showReadArticles)
  const bookmarkedOnly = isBookmarks
  const likedOnly = isLikes
  const readOnly = isHistory
  const { autoMarkRead, dateMode, indicatorStyle, layout, articleOpenMode, keyboardNavigation, keybindings } = settings
  const [overlayUrl, setOverlayUrl] = useState<string | null>(null)
  const [noFloor, setNoFloor] = useState(false)
  const displayConfig: ArticleDisplayConfig = useMemo(() => ({
    dateMode,
    indicatorStyle,
    showUnreadIndicator: settings.showUnreadIndicator === 'on',
    showThumbnails: settings.showThumbnails === 'on',
  }), [dateMode, indicatorStyle, settings.showUnreadIndicator, settings.showThumbnails])
  const isGridLayout = layout === 'card' || layout === 'magazine'
  const showArticleKindFilter = !!feedId && !!currentFeed && isXFeedSource(currentFeed)
  const { t, locale } = useI18n()
  const effectiveTranslateTargetLang = settings.translateTargetLang || locale
  const { progress, startFeedFetch } = useFetchProgressContext()
  const { mutate: globalMutate } = useSWRConfig()
  const { data: inboxSummary, mutate: mutateInboxSummary } = useSWR<InboxSummary>(isInbox ? '/api/inbox/summary' : null, fetcher)
  const getKey = (pageIndex: number, previousPageData: ArticlesResponse | null) => {
    if (previousPageData && !previousPageData.has_more) return null
    const params = new URLSearchParams()
    if (feedId) params.set('feed_id', String(feedId))
    if (categoryId) params.set('category_id', String(categoryId))
    if (isInbox && inboxViewFilter !== 'all') params.set('feed_view_type', inboxViewFilter)
    if (articleKindFilter !== 'all') params.set('article_kind', articleKindFilter)
    if (unreadOnly) params.set('unread', '1')
    if (bookmarkedOnly) params.set('bookmarked', '1')
    if (likedOnly) params.set('liked', '1')
    if (readOnly) params.set('read', '1')
    if (isInbox && inboxSort !== 'newest') params.set('sort', inboxSort)
    if (noFloor) params.set('no_floor', '1')
    params.set('limit', String(PAGE_SIZE))
    params.set('offset', String(pageIndex * PAGE_SIZE))
    return `/api/articles?${params.toString()}`
  }

  const { data, error, size, setSize, isLoading, isValidating, mutate } = useSWRInfinite<ArticlesResponse>(
    getKey,
    fetcher,
    {
      revalidateFirstPage: isCollectionView,
    },
  )

  useImperativeHandle(ref, () => ({
    revalidate: () => mutate(),
  }), [mutate])

  const articles = useMemo(() => data ? data.flatMap(page => page.articles) : [], [data])
  const [translateTitlesEnabled, setTranslateTitlesEnabled] = useState(false)
  const [translateTitlesStatus, setTranslateTitlesStatus] = useState<TranslateTitlesStatus>('idle')
  const [translatedTitles, setTranslatedTitles] = useState<Record<number, string>>({})
  const translateTitlesEnabledRef = useRef(false)
  const translatingTitleIdsRef = useRef<Set<number>>(new Set())
  const translateTitlesInFlightRef = useRef(false)
  const hasMore = data ? data[data.length - 1]?.has_more ?? false : false
  const isEmpty = data?.[0]?.articles.length === 0
  const totalAll = data?.[0]?.total_all
  const allReadEmpty = isEmpty && categoryUnreadOnly && !showReadArticles && totalAll != null && totalAll > 0
  const inboxAllReadEmpty = isInbox && isEmpty && totalAll != null && totalAll > 0
  const hiddenByFloor = data?.[0]?.total_without_floor != null
    ? data[0].total_without_floor - (data[0].total ?? 0)
    : 0
  const { enqueueUndoSeen, undoSeen, dismissUndoSeen } = useUndoSeen()

  useEffect(() => {
    if (!isInbox || typeof window === 'undefined') return
    window.localStorage.setItem(INBOX_SORT_STORAGE_KEY, inboxSort)
  }, [inboxSort, isInbox])

  useEffect(() => {
    if (!isInbox || typeof window === 'undefined') return
    window.localStorage.setItem(INBOX_GROUP_STORAGE_KEY, inboxGroupMode)
  }, [inboxGroupMode, isInbox])

  useEffect(() => {
    translateTitlesEnabledRef.current = translateTitlesEnabled
  }, [translateTitlesEnabled])

  // ---------------------------------------------------------------------------
  // Keyboard navigation
  // ---------------------------------------------------------------------------
  const { focusedItemId, setFocusedItemId } = useKeyboardNavigationContext()
  const isKeyboardNavEnabled = keyboardNavigation === 'on' && !isGridLayout

  const articleIds = useMemo(() => articles.map(a => String(a.id)), [articles])

  const articleMap = useMemo(() => {
    const map = new Map<string, ArticleListItem>()
    for (const a of articles) map.set(String(a.id), a)
    return map
  }, [articles])

  const isOverlayMode = articleOpenMode === 'overlay'
  // Short debounce after overlay close to prevent Escape from immediately clearing focus
  const escapeDebounceRef = useRef(false)

  useKeyboardNavigation({
    items: articleIds,
    focusedItemId,
    onFocusChange: (id) => {
      setFocusedItemId(id)
      const el = document.querySelector(`[data-article-id="${id}"]`)
      el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      // Overlay mode: open article immediately on j/k
      if (isOverlayMode) {
        const article = articleMap.get(id)
        if (article) setOverlayUrl(article.url)
      }
    },
    onEnter: isOverlayMode ? undefined : (id) => {
      // Page mode: Enter to navigate
      const article = articleMap.get(id)
      if (article) void navigate(`/${encodeURIComponent(article.url)}`)
    },
    onEscape: () => {
      if (escapeDebounceRef.current) return
      setFocusedItemId(null)
    },
    onBookmarkToggle: (id) => {
      const article = articleMap.get(id)
      if (!article) return
      const next = !article.bookmarked_at
      // Optimistic update: flip bookmarked_at in local SWR cache immediately
      void mutate(
        (pages) => pages?.map(page => ({
          ...page,
          articles: page.articles.map(a =>
            String(a.id) === id
              ? { ...a, bookmarked_at: next ? new Date().toISOString() : null }
              : a
          ),
        })),
        { revalidate: false },
      )
      apiPatch(`/api/articles/${article.id}/bookmark`, { bookmarked: next })
        .then(() => {
          void globalMutate((key: string) => typeof key === 'string' && key.startsWith('/api/feeds'))
        })
        .catch(() => {
          // Roll back on failure
          void mutate()
        })
    },
    onOpenExternal: (id) => {
      const article = articleMap.get(id)
      if (article?.url) window.open(article.url, '_blank')
    },
    onNearEnd: () => loadMoreRef.current(),
    enabled: isKeyboardNavEnabled,
    keyBindings: keybindings,
  })

  // ---------------------------------------------------------------------------
  // Infinite scroll
  // ---------------------------------------------------------------------------
  const sentinelRef = useRef<HTMLDivElement>(null)

  // Keep loadMore in a stable ref so the IntersectionObserver callback
  // always sees the latest values without needing to recreate the observer.
  const loadMoreRef = useRef(() => {})
  loadMoreRef.current = () => {
    if (hasMore && !isValidating) {
      void setSize(size + 1)
    }
  }

  // Stable observer — created once via ref callback when sentinel mounts.
  const sentinelObserverRef = useRef<IntersectionObserver | null>(null)
  const sentinelCallbackRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous
    sentinelObserverRef.current?.disconnect()
    sentinelObserverRef.current = null
    sentinelRef.current = node

    if (!node) return
    const observer = new IntersectionObserver(
      entries => { if (entries[0].isIntersecting) loadMoreRef.current() },
      { rootMargin: '200px' },
    )
    observer.observe(node)
    sentinelObserverRef.current = observer
  }, [])

  // Re-trigger loading when a fetch completes while sentinel is still visible.
  // IntersectionObserver only fires on threshold crossings, so if the sentinel
  // stays within the viewport after new articles render, no event fires and
  // pagination stalls. This effect covers that gap.
  useEffect(() => {
    if (!isValidating && hasMore && sentinelRef.current) {
      const rect = sentinelRef.current.getBoundingClientRect()
      if (rect.top < window.innerHeight + 200) {
        void setSize(prev => prev + 1)
      }
    }
  }, [isValidating, hasMore, setSize])

  // ---------------------------------------------------------------------------
  // Auto-mark-as-read on scroll
  //
  // - IntersectionObserver fires when an article overlaps the header (48px)
  // - UI updates instantly via React state (autoReadIds)
  // - API calls are batched and flushed every ~1.5 s
  // ---------------------------------------------------------------------------
  const [autoReadIds, setAutoReadIds] = useState<Set<number>>(() => new Set())
  const observerRef = useRef<IntersectionObserver | null>(null)
  const batchQueue = useRef(new Set<number>())
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flushBatch = useCallback(() => {
    if (batchQueue.current.size === 0) return
    const ids = [...batchQueue.current]
    batchQueue.current.clear()
    markSeenOnServer(ids)
      .then(() => globalMutate(
        (key: string) => typeof key === 'string' && key.startsWith('/api/feeds'),
      ))
      .catch(() => {})
  }, [globalMutate])

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null
      flushBatch()
    }, BATCH_FLUSH_INTERVAL)
  }, [flushBatch])

  const isAutoMarkEnabled = autoMarkRead === 'on'
  const isTouchDevice = useIsTouchDevice()
  const listRef = useRef<HTMLElement>(null)

  // Create the IntersectionObserver once when auto-mark is enabled.
  // The observer instance is kept stable — new article nodes from infinite
  // scroll are added incrementally via a separate effect, avoiding the
  // disconnect/recreate race that caused missed or phantom read events.
  useEffect(() => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!isAutoMarkEnabled) return

    // Measure actual header height in pixels — iOS Safari rejects rootMargin
    // values containing calc() or env() that getComputedStyle may return.
    const headerEl = document.querySelector('[data-header]') as HTMLElement | null
    const headerH = headerEl ? `${headerEl.offsetHeight}px` : '48px'

    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement
          const articleId = Number(el.dataset.articleId)
          if (!articleId) continue
          if (el.dataset.articleUnread !== '1') continue

          const rootTop = entry.rootBounds?.top ?? 0
          if (entry.boundingClientRect.top < rootTop) {
            markReadRef.current(articleId)
          }
        }
      },
      {
        rootMargin: `-${headerH} 0px 0px 0px`,
        threshold: [0, 1],
      },
    )

    observerRef.current = observer

    // Observe all article nodes already in the DOM
    if (listRef.current) {
      const nodes = listRef.current.querySelectorAll<HTMLElement>('[data-article-id]')
      nodes.forEach(node => observer.observe(node))
    }

    return () => observer.disconnect()
  }, [isAutoMarkEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Incrementally observe new article nodes added by infinite scroll.
  // Uses a MutationObserver to detect inserted DOM nodes so the
  // IntersectionObserver instance stays stable (no disconnect/recreate).
  useEffect(() => {
    const list = listRef.current
    const io = observerRef.current
    if (!list || !io || !isAutoMarkEnabled) return

    const mo = new MutationObserver(mutations => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (!(node instanceof HTMLElement)) continue
          // The node itself might be an article wrapper
          if (node.dataset.articleId) {
            io.observe(node)
          }
          // Or it might contain article wrappers (e.g. fragment insert)
          const children = node.querySelectorAll<HTMLElement>('[data-article-id]')
          children.forEach(child => io.observe(child))
        }
      }
    })

    mo.observe(list, { childList: true, subtree: true })
    return () => mo.disconnect()
  }, [isAutoMarkEnabled])

  // Flush remaining batch on unmount or feed/category change
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) {
        clearTimeout(flushTimerRef.current)
        flushTimerRef.current = null
      }
      flushBatch()
    }
  }, [feedId, categoryId, flushBatch])

  // Reset autoReadIds, noFloor, showReadArticles, and keyboard focus when feed/category changes
  useEffect(() => {
    setAutoReadIds(new Set())
    setNoFloor(false)
    setShowReadArticles(false)
    setArticleKindFilter('all')
    setFocusedItemId(null)
    setTranslateTitlesEnabled(false)
    setTranslateTitlesStatus('idle')
    setTranslatedTitles({})
    translatingTitleIdsRef.current.clear()
    translateTitlesInFlightRef.current = false
  }, [feedId, categoryId, setFocusedItemId])

  useEffect(() => {
    if (!translateTitlesEnabled || articles.length === 0 || translateTitlesInFlightRef.current) return
    const pending = articles
      .filter(article =>
        article.lang !== effectiveTranslateTargetLang &&
        translatedTitles[article.id] == null &&
        !translatingTitleIdsRef.current.has(article.id),
      )
      .map(article => article.id)
      .slice(0, TITLE_TRANSLATE_BATCH_SIZE)
    if (pending.length === 0) {
      if (translateTitlesStatus !== 'active') setTranslateTitlesStatus('active')
      return
    }

    for (const id of pending) translatingTitleIdsRef.current.add(id)
    translateTitlesInFlightRef.current = true
    setTranslateTitlesStatus('loading')

    apiPost('/api/articles/translate-titles', { ids: pending })
      .then((res) => {
        const payload = (res as { translated_titles?: Record<number, string> } | undefined)?.translated_titles ?? {}
        setTranslatedTitles(prev => ({ ...prev, ...payload }))
        if (translateTitlesEnabledRef.current) {
          const remaining = articles
            .filter(article =>
              article.lang !== effectiveTranslateTargetLang &&
              ({ ...translatedTitles, ...payload } as Record<number, string>)[article.id] == null &&
              !translatingTitleIdsRef.current.has(article.id),
            )
            .map(article => article.id)
          if (remaining.length === 0) {
            setTranslateTitlesStatus('active')
            toast.success(t('articles.translateTitlesSuccess'))
          }
        } else {
          setTranslateTitlesStatus('idle')
        }
      })
      .catch(() => {
        setTranslateTitlesEnabled(false)
        translateTitlesEnabledRef.current = false
        setTranslateTitlesStatus('error')
        toast.error(t('articles.translateTitlesError'))
      })
      .finally(() => {
        translateTitlesInFlightRef.current = false
        for (const id of pending) translatingTitleIdsRef.current.delete(id)
      })
  }, [translateTitlesEnabled, articles, effectiveTranslateTargetLang, translatedTitles, translateTitlesStatus, t])

  const articleKindOptions: Array<{ value: ArticleKind | 'all'; label: string }> = [
    { value: 'all', label: t('articleKind.all') },
    { value: 'original', label: t('articleKind.original') },
    { value: 'repost', label: t('articleKind.repost') },
    { value: 'quote', label: t('articleKind.quote') },
  ]
  const effectiveInboxViewFilter: FeedViewType | undefined = isInbox && inboxViewFilter !== 'all' ? inboxViewFilter : undefined
  const sourceFilters = useMemo(() => ({
    ...(feedId ? { feed_id: feedId } : {}),
    ...(categoryId ? { category_id: categoryId } : {}),
    ...(effectiveInboxViewFilter ? { feed_view_type: effectiveInboxViewFilter } : {}),
    ...(unreadOnly ? { unread: true } : {}),
    ...(bookmarkedOnly ? { bookmarked: true } : {}),
    ...(likedOnly ? { liked: true } : {}),
    ...(readOnly ? { read: true } : {}),
    ...(articleKindFilter !== 'all' ? { article_kind: articleKindFilter } : {}),
    ...(noFloor ? { no_floor: true } : {}),
  }), [feedId, categoryId, effectiveInboxViewFilter, unreadOnly, bookmarkedOnly, likedOnly, readOnly, articleKindFilter, noFloor])

  const inboxGroupInfo = useMemo(() => {
    if (!isInbox || inboxGroupMode === 'none') return null

    const groupKeys = articles.map((article) => {
      if (inboxGroupMode === 'feed') return `feed:${article.feed_id}`
      return dayGroupMeta(article, t).key
    })

    const unreadCounts = new Map<string, number>()
    for (let i = 0; i < articles.length; i++) {
      const key = groupKeys[i]
      const article = articles[i]
      unreadCounts.set(key, (unreadCounts.get(key) ?? 0) + (article.seen_at == null ? 1 : 0))
    }

    return {
      keyForIndex: (index: number) => groupKeys[index],
      shouldRenderAtIndex: (index: number) => index === 0 || groupKeys[index] !== groupKeys[index - 1],
      titleForArticle: (article: ArticleListItem) => (
        inboxGroupMode === 'feed'
          ? article.feed_name
          : dayGroupMeta(article, t).title
      ),
      unreadCountForIndex: (index: number) => unreadCounts.get(groupKeys[index]) ?? 0,
    }
  }, [articles, inboxGroupMode, isInbox, t])

  const mutateArticleInPages = useCallback((
    articleId: number,
    updater: (article: ArticleListItem) => ArticleListItem,
  ) => {
    void mutate((pages) => pages?.map((page, index) => {
      let changed = false
      const nextArticles = page.articles.flatMap((article) => {
        if (article.id !== articleId) return [article]
        changed = true
        const nextArticle = updater(article)
        const keepVisible = (!unreadOnly || nextArticle.seen_at == null)
          && (!bookmarkedOnly || nextArticle.bookmarked_at != null)
          && (!likedOnly || nextArticle.liked_at != null)
        return keepVisible ? [nextArticle] : []
      })

      if (!changed) return page
      const removed = page.articles.length - nextArticles.length
      return {
        ...page,
        articles: nextArticles,
        total: Math.max(0, page.total - removed),
        ...(index === 0 && removed > 0 ? { total_all: Math.max(page.total_all ?? page.total, page.total) } : {}),
      }
    }), { revalidate: false })
  }, [bookmarkedOnly, likedOnly, mutate, unreadOnly])

  const refreshListMeta = useCallback(() => {
    void mutate()
    void mutateInboxSummary()
    void globalMutate((key: string) => typeof key === 'string' && key.startsWith('/api/feeds'))
  }, [globalMutate, mutate, mutateInboxSummary])

  const showUndoToast = useCallback((undoId: number) => {
    toast(t('inbox.undoSeenToast'), {
      id: 'inbox-undo-seen',
      duration: 10_000,
      action: {
        label: t('inbox.undoAction'),
        onClick: () => {
          void undoSeen(undoId)
        },
      },
      onDismiss: () => dismissUndoSeen(undoId),
      onAutoClose: () => dismissUndoSeen(undoId),
    })
  }, [dismissUndoSeen, t, undoSeen])

  const handleToggleSeen = useCallback((article: ArticleListItem) => {
    const nextSeenAt = article.seen_at ? null : new Date().toISOString()
    mutateArticleInPages(article.id, current => ({ ...current, seen_at: nextSeenAt }))
    apiPatch(`/api/articles/${article.id}/seen`, { seen: !article.seen_at })
      .then(() => {
        refreshListMeta()
      })
      .catch(() => {
        void mutate()
      })
  }, [mutate, mutateArticleInPages, refreshListMeta])

  const handleMarkSeenWithUndo = useCallback((article: ArticleListItem) => {
    if (article.seen_at != null) return
    mutateArticleInPages(article.id, current => ({ ...current, seen_at: new Date().toISOString() }))

    const undoId = enqueueUndoSeen({
      articleId: article.id,
      undo: async () => {
        setAutoReadIds(prev => {
          if (!prev.has(article.id)) return prev
          const next = new Set(prev)
          next.delete(article.id)
          return next
        })
        batchQueue.current.delete(article.id)
        mutateArticleInPages(article.id, current => ({ ...current, seen_at: null }))
        await apiDelete(`/api/articles/${article.id}/seen`)
        refreshListMeta()
      },
    })
    showUndoToast(undoId)

    apiPatch(`/api/articles/${article.id}/seen`, { seen: true })
      .then(() => {
        refreshListMeta()
      })
      .catch(() => {
        dismissUndoSeen(undoId)
        void mutate()
      })
  }, [dismissUndoSeen, enqueueUndoSeen, mutate, mutateArticleInPages, refreshListMeta, showUndoToast])

  // Mark an article as read: instant UI update + queue for server batch
  const markRead = useCallback((articleId: number) => {
    setAutoReadIds(prev => {
      if (prev.has(articleId)) return prev
      const next = new Set(prev)
      next.add(articleId)
      return next
    })
    trackRead(articleId)
    batchQueue.current.add(articleId)
    scheduleFlush()
    const article = articleMap.get(String(articleId))
    if (article && article.seen_at == null) {
      const undoId = enqueueUndoSeen({
        articleId,
        undo: async () => {
          setAutoReadIds(prev => {
            if (!prev.has(articleId)) return prev
            const next = new Set(prev)
            next.delete(articleId)
            return next
          })
          batchQueue.current.delete(articleId)
          mutateArticleInPages(articleId, current => ({ ...current, seen_at: null }))
          await apiDelete(`/api/articles/${articleId}/seen`)
          refreshListMeta()
        },
      })
      showUndoToast(undoId)
    }
  }, [articleMap, enqueueUndoSeen, mutateArticleInPages, refreshListMeta, scheduleFlush, showUndoToast])

  // Stable ref so the observer callback always sees the latest markRead
  const markReadRef = useRef(markRead)
  markReadRef.current = markRead

  const handleToggleBookmark = useCallback((article: ArticleListItem) => {
    const nextBookmarkedAt = article.bookmarked_at ? null : new Date().toISOString()
    mutateArticleInPages(article.id, current => ({ ...current, bookmarked_at: nextBookmarkedAt }))
    apiPatch(`/api/articles/${article.id}/bookmark`, { bookmarked: !article.bookmarked_at })
      .then(() => {
        refreshListMeta()
      })
      .catch(() => {
        void mutate()
      })
  }, [mutate, mutateArticleInPages, refreshListMeta])

  const handleToggleLike = useCallback((article: ArticleListItem) => {
    const nextLikedAt = article.liked_at ? null : new Date().toISOString()
    mutateArticleInPages(article.id, current => ({ ...current, liked_at: nextLikedAt }))
    apiPatch(`/api/articles/${article.id}/like`, { liked: !article.liked_at })
      .then(() => {
        refreshListMeta()
      })
      .catch(() => {
        void mutate()
      })
  }, [mutate, mutateArticleInPages, refreshListMeta])

  const handleFetchAllInboxFeeds = useCallback(async () => {
    const activeFeeds = (feedsData?.feeds ?? []).filter(feed => feed.type !== 'clip' && !feed.disabled)
    if (activeFeeds.length === 0) return
    const results = await Promise.all(activeFeeds.map(feed => startFeedFetch(feed.id)))
    const totalNew = results.reduce((sum, result) => sum + (result.totalNew ?? 0), 0)
    if (results.some(result => result.error)) {
      toast.error(t('toast.fetchError', { name: t('feeds.inbox') }))
      return
    }
    if (totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(totalNew), name: t('feeds.inbox') }))
    else toast(t('toast.noNewArticles', { name: t('feeds.inbox') }))
    void mutate()
    void mutateInboxSummary()
  }, [feedsData?.feeds, mutate, mutateInboxSummary, startFeedFetch, t])

  const inboxChatTrigger = (
    <ListChatFab
      listLabel={listLabel}
      articleIds={articles.map(article => article.id)}
      sourceFilters={sourceFilters}
      hideDefaultTrigger
      openSignal={inboxChatOpenSignal}
      renderTrigger={({ toggle }) => (
        <button
          type="button"
          onClick={toggle}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-3 py-1.5 text-sm text-muted transition hover:text-text"
        >
          <MessageSquare className="h-4 w-4" />
          {t('inbox.chat')}
        </button>
      )}
    />
  )

  return (
    <main ref={listRef} className="max-w-2xl mx-auto" role={!isGridLayout ? 'listbox' : undefined}>
      {isTouchDevice && <PullToRefresh onRefresh={async () => {
        if (feedId) {
          const result = await startFeedFetch(feedId)
          const name = currentFeed?.name ?? ''
          if (result.error) toast.error(t('toast.fetchError', { name }))
          else if (result.totalNew > 0) toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name }))
          else toast(t('toast.noNewArticles', { name }))
        } else {
          await mutate()
        }
      }} />}

      {currentFeed && currentFeed.type !== 'clip' && settings.showFeedActivity === 'on' && (
        <FeedMetricsBar feed={currentFeed} />
      )}

      {isInbox && (
        <InboxHeader
          summary={inboxSummary}
          sort={inboxSort}
          viewFilter={inboxViewFilter}
          onSortChange={(nextSort) => {
            setInboxSort(nextSort)
            setNoFloor(false)
            void setSize(1)
          }}
          groupMode={inboxGroupMode}
          onGroupModeChange={setInboxGroupMode}
          onViewFilterChange={(nextFilter) => {
            setInboxViewFilter(nextFilter)
            setNoFloor(false)
            void setSize(1)
          }}
          chatTrigger={inboxChatTrigger}
          labels={{
            unreadTotal: t('inbox.unreadTotal'),
            newToday: t('inbox.newToday'),
            oldestUnread: t('inbox.oldestUnread'),
            sourceCount: t('inbox.sourceCount'),
            latest: t('inbox.sort.latest'),
            backlog: t('inbox.sort.backlog'),
            highValue: t('inbox.sort.highValue'),
            groupNone: t('inbox.group.none'),
            groupDay: t('inbox.group.day'),
            groupFeed: t('inbox.group.feed'),
            noUnread: t('inbox.noUnread'),
            viewAll: t('articleKind.all'),
            viewArticle: t('feeds.viewType.article'),
            viewSocial: t('feeds.viewType.social'),
          }}
        />
      )}

      {showArticleKindFilter && (
        <div className="flex flex-wrap gap-2 px-4 md:px-6 py-3">
          {articleKindOptions.map(option => (
            <ActionChip
              key={option.value}
              active={articleKindFilter === option.value}
              onClick={() => {
                setArticleKindFilter(option.value)
                setNoFloor(false)
                void setSize(1)
              }}
            >
              {option.label}
            </ActionChip>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 px-4 md:px-6 py-2">
        <ActionChip
          active={translateTitlesStatus === 'active'}
          disabled={translateTitlesStatus === 'loading'}
          className={translateTitlesStatus === 'loading'
            ? 'cursor-wait opacity-80'
            : translateTitlesStatus === 'error'
              ? 'text-red-500 hover:text-red-400'
              : undefined}
          onClick={() => {
            if (translateTitlesEnabled) {
              setTranslateTitlesEnabled(false)
              translateTitlesEnabledRef.current = false
              setTranslateTitlesStatus('idle')
              return
            }
            setTranslateTitlesEnabled(true)
            translateTitlesEnabledRef.current = true
            if (articles.length === 0) {
              setTranslateTitlesStatus('idle')
              return
            }
            const pending = articles.some(article =>
              article.lang !== effectiveTranslateTargetLang &&
              translatedTitles[article.id] == null &&
              !translatingTitleIdsRef.current.has(article.id),
            )
            setTranslateTitlesStatus(pending ? 'loading' : 'active')
          }}
          aria-busy={translateTitlesStatus === 'loading'}
          title={translateTitlesStatus === 'error' ? t('articles.translateTitlesError') : undefined}
        >
          {translateTitlesStatus === 'loading' ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {t('articles.translateTitlesLoading')}
            </>
          ) : translateTitlesStatus === 'active' ? (
            <>
              <Languages className="h-3.5 w-3.5" />
              {t('articles.translateTitlesActive')}
            </>
          ) : translateTitlesStatus === 'error' ? (
            <>
              <Languages className="h-3.5 w-3.5" />
              {t('articles.translateTitlesError')}
            </>
          ) : (
            <>
              <Languages className="h-3.5 w-3.5" />
              {t('articles.translateTitlesIdle')}
            </>
          )}
        </ActionChip>
      </div>

      {isLoading && <ArticleListSkeleton layout={layout} showThumbnails={displayConfig.showThumbnails} />}

      {error && (
        <div className="text-center py-12">
          <p className="text-muted mb-2">{t('articles.loadError')}</p>
          <button onClick={() => setSize(1)} className="text-accent text-sm">
            {t('articles.retry')}
          </button>
        </div>
      )}

      {allReadEmpty && !isLoading && !isInbox && (
        <div className="text-center py-12">
          <p className="text-muted mb-3">{t('articles.allRead')}</p>
          <button
            onClick={() => setShowReadArticles(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showReadArticles')}
          </button>
        </div>
      )}

      {inboxAllReadEmpty && !isLoading && (
        <div className="px-4 md:px-6 py-12 text-center">
          <p className="text-muted mb-5">{t('inbox.allRead')}</p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={() => { void handleFetchAllInboxFeeds() }}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text transition hover:bg-hover"
            >
              <RefreshCw className="h-4 w-4" />
              {t('inbox.fetchUpdates')}
            </button>
            <button
              type="button"
              onClick={() => void navigate('/bookmarks')}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text transition hover:bg-hover"
            >
              {t('inbox.viewBookmarks')}
            </button>
            <button
              type="button"
              onClick={() => void navigate('/history')}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text transition hover:bg-hover"
            >
              {t('inbox.browseHistory')}
            </button>
            <button
              type="button"
              onClick={() => setInboxChatOpenSignal(signal => signal + 1)}
              className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text transition hover:bg-hover"
            >
              <MessageSquare className="h-4 w-4" />
              {t('inbox.chat')}
            </button>
          </div>
        </div>
      )}

      {isEmpty && !allReadEmpty && !isLoading && currentFeed && feedId && progress.has(feedId) && (
        <FeedErrorBanner
          lastError={currentFeed.last_error ?? ''}
          feedId={currentFeed.id}
          overridePhase="processing"
        />
      )}

      {isEmpty && !allReadEmpty && !inboxAllReadEmpty && !isLoading && !(feedId && progress.has(feedId)) && (
        currentFeed?.last_error ? (
          <FeedErrorBanner
            lastError={currentFeed.last_error}
            feedId={currentFeed.id}
            onMutate={async () => {
              await globalMutate((key: unknown) => typeof key === 'string' && key.startsWith('/api/feeds'))
            }}
            onFetch={currentFeed.type !== 'clip' ? async () => {
              const result = await startFeedFetch(currentFeed.id)
              const name = currentFeed.name
              if (result.error) toast.error(t('toast.fetchError', { name }))
              else if (result.totalNew > 0) { toast.success(t('toast.fetchedArticles', { count: String(result.totalNew), name })); void mutate() }
              else toast(t('toast.noNewArticles', { name }))
            } : undefined}
          />
        ) : (
          isInbox ? (
            <div className="px-4 md:px-6 py-12 text-center">
              <p className="text-muted mb-5">{t('inbox.empty')}</p>
              <button
                type="button"
                onClick={() => void navigate('/')}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-bg px-4 py-2 text-sm text-text transition hover:bg-hover"
              >
                <Plus className="h-4 w-4" />
                {t('inbox.addFeed')}
              </button>
            </div>
          ) : (
            <p className="text-muted text-center py-12">{t('articles.empty')}</p>
          )
        )
      )}

      <div className={isGridLayout ? 'grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6' : ''}>
        {articles.map((article, index) => {
          const isAutoRead = autoReadIds.has(article.id)
          const effectiveArticle = isAutoRead
            ? { ...article, seen_at: article.seen_at ?? new Date().toISOString() }
            : article
          const translatedTitle = translateTitlesEnabled ? translatedTitles[article.id] : undefined
          const articleWithTranslatedTitle = translatedTitle
            ? { ...effectiveArticle, title: translatedTitle }
            : effectiveArticle
          const handleOverlayOpen = articleOpenMode === 'overlay' ? (e: React.MouseEvent<HTMLAnchorElement>) => {
            if (e.metaKey || e.ctrlKey || e.button === 1) return
            e.preventDefault()
            setOverlayUrl(article.url)
          } : undefined
          const cardProps = {
            article: articleWithTranslatedTitle,
            layout,
            isFeatured: layout === 'magazine' && index === 0,
            feedViewType: articleWithTranslatedTitle.feed_view_type,
            onClick: handleOverlayOpen,
            ...displayConfig,
          }
          const isKbFocused = focusedItemId === String(article.id)
          return (
            <Fragment key={article.id}>
              {inboxGroupInfo?.shouldRenderAtIndex(index) && (
                <InboxGroupHeader
                  title={inboxGroupInfo.titleForArticle(article)}
                  unreadCount={inboxGroupInfo.unreadCountForIndex(index)}
                />
              )}
              <div
                data-article-id={article.id}
                data-article-unread={article.seen_at == null && !isAutoRead ? '1' : '0'}
                aria-selected={isKbFocused || undefined}
                className={`${layout === 'magazine' && index === 0 ? 'col-span-full' : ''} relative group`}
                style={isKbFocused ? {
                  borderLeft: '2px solid var(--color-accent)',
                  backgroundColor: 'color-mix(in srgb, var(--color-accent) 10%, transparent)',
                } : undefined}
                onClick={() => {
                  if (!isGridLayout) {
                    setFocusedItemId(String(article.id))
                  }
                }}
              >
                {isTouchDevice ? (
                  <SwipeableArticleCard
                    {...cardProps}
                    onSwipeOpen={(swipedArticle) => {
                      if (articleOpenMode === 'overlay') setOverlayUrl(swipedArticle.url)
                      else void navigate(articleUrlToPath(swipedArticle.url))
                    }}
                    onSwipeMarkSeen={handleMarkSeenWithUndo}
                    onSwipeBookmark={handleToggleBookmark}
                  />
                ) : (
                  <ArticleCard {...cardProps} />
                )}
                <ArticleInlineActions
                  isSeen={articleWithTranslatedTitle.seen_at != null}
                  isBookmarked={articleWithTranslatedTitle.bookmarked_at != null}
                  isLiked={articleWithTranslatedTitle.liked_at != null}
                  isTouchDevice={isTouchDevice}
                  onToggleSeen={() => handleToggleSeen(article)}
                  onToggleBookmark={() => handleToggleBookmark(article)}
                  onToggleLike={() => handleToggleLike(article)}
                  onOpenOverlay={() => setOverlayUrl(article.url)}
                  labels={{
                    markRead: t('inbox.markRead'),
                    markUnread: t('inbox.markUnread'),
                    bookmark: t('article.addBookmark'),
                    unbookmark: t('article.removeBookmark'),
                    like: t('article.addLike'),
                    unlike: t('article.removeLike'),
                    openOverlay: t('inbox.openOverlay'),
                  }}
                />
              </div>
            </Fragment>
          )
        })}
      </div>

      {hasMore && (
        <div ref={sentinelCallbackRef} className="py-4">
          {isValidating && <ArticleListSkeleton layout={layout} count={2} showThumbnails={displayConfig.showThumbnails} />}
        </div>
      )}

      {!hasMore && hiddenByFloor > 0 && (
        <div className="text-center py-6">
          <button
            onClick={() => setNoFloor(true)}
            className="text-accent text-sm hover:underline"
          >
            {t('articles.showOlder', { count: String(hiddenByFloor) })}
          </button>
        </div>
      )}

      {/* Scroll spacer: ensures the last article can scroll past the header for auto-mark-read */}
      {!hasMore && articles.length > 0 && isAutoMarkEnabled && !isCollectionView && (
        <div
          className="flex flex-col items-center justify-end select-none"
          style={{ minHeight: 'calc(100vh - var(--header-height))' }}
        >
          {settings.mascot !== 'off' && (
            <>
              <div>
                <Mascot choice={settings.mascot} />
              </div>
              <p className="text-muted/40 text-xs mt-4 pb-4">{t('articles.allCaughtUp')}</p>
            </>
          )}
        </div>
      )}

      <ArticleOverlay articleUrl={overlayUrl} onClose={() => {
        setOverlayUrl(null)
        escapeDebounceRef.current = true
        setTimeout(() => { escapeDebounceRef.current = false }, 100)
      }} />

      {articles.length > 0 && !isInbox && (
        <ListChatFab
          listLabel={listLabel}
          articleIds={articles.map(article => article.id)}
          sourceFilters={sourceFilters}
        />
      )}
    </main>
  )
})

function ArticleListSkeleton({ layout = 'list', count = 3, showThumbnails = true }: { layout?: LayoutName; count?: number; showThumbnails?: boolean }) {
  if (layout === 'compact') {
    return (
      <>
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border-b border-border py-1.5 px-4 md:px-6">
            <div className="flex items-center gap-2">
              <div className="w-2.5 shrink-0" />
              <Skeleton className="h-3.5 flex-1" />
              <Skeleton className="h-3 w-12 shrink-0" />
            </div>
          </div>
        ))}
      </>
    )
  }

  if (layout === 'card') {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 px-4 md:px-6">
        {Array.from({ length: count * 2 }).map((_, i) => (
          <div key={i} className="border border-border rounded-lg overflow-hidden">
            {showThumbnails && <Skeleton className="w-full aspect-video" />}
            <div className="p-3 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-1">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-24" />
              </div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (layout === 'magazine') {
    return (
      <>
        {/* Hero skeleton */}
        <div className="border border-border rounded-lg overflow-hidden mb-4 mx-4 md:mx-6">
          {showThumbnails && <Skeleton className="w-full aspect-video" />}
          <div className="p-4 space-y-2">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-2/3" />
            <div className="flex items-center gap-1 mt-1">
              <Skeleton className="w-3.5 h-3.5 shrink-0" />
              <Skeleton className="h-3 w-28" />
            </div>
          </div>
        </div>
        {/* Small card skeletons */}
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex gap-3 border-b border-border py-2 px-4 md:px-6">
            {showThumbnails && <Skeleton className="w-12 h-12 shrink-0" />}
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-0.5">
                <Skeleton className="w-3 h-3 shrink-0" />
                <Skeleton className="h-3 w-20" />
              </div>
            </div>
          </div>
        ))}
      </>
    )
  }

  // Default: list layout
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border-b border-border py-3 px-4 md:px-6">
          <div className="flex items-center gap-2">
            <div className="w-3 shrink-0" />
            <div className="flex-1 min-w-0 space-y-1.5">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-1/2" />
              <div className="flex items-center gap-1 mt-0.5">
                <Skeleton className="w-3.5 h-3.5 shrink-0" />
                <Skeleton className="h-3 w-28" />
              </div>
            </div>
            {showThumbnails && <Skeleton className="w-16 h-16 shrink-0" />}
          </div>
        </div>
      ))}
    </>
  )
}
