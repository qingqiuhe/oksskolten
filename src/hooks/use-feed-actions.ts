import { useState, useRef, useEffect, useCallback } from 'react'
import { useSWRConfig } from 'swr'
import { apiPost, apiPatch, apiDelete } from '../lib/fetcher'
import { normalizeFeedIconUrl } from '../lib/feed-icon-url'
import { buildFeedPriorityPatch, getFeedPriorityLevel } from '../lib/feed-priority'
import type { FeedWithCounts, Category, FeedPriorityLevel } from '../../shared/types'
import type { KeyedMutator } from 'swr'
import type { FetchResult } from './use-fetch-progress'

type RenamingState =
  | { type: 'feed'; feed: FeedWithCounts; name: string; iconUrl: string; priorityLevel: FeedPriorityLevel }
  | { type: 'category'; category: Category; name: string }
  | null

type ConfirmState =
  | { type: 'delete-feed' | 'enable-feed' | 'delete-category'; feed?: FeedWithCounts; category?: Category }
  | null

interface UseFeedActionsOpts {
  categorized: Map<number, FeedWithCounts[]>
  mutateFeeds: KeyedMutator<{ feeds: FeedWithCounts[]; bookmark_count: number; like_count: number; clip_feed_id: number | null }>
  mutateCategories: KeyedMutator<{ categories: Category[] }>
  startFeedFetch: (feedId: number) => Promise<FetchResult>
  onFetchComplete?: (result: FetchResult) => void
  onMarkAllRead?: () => void
  onDeleted?: () => void
}

export function useFeedActions({
  categorized,
  mutateFeeds,
  mutateCategories,
  startFeedFetch,
  onFetchComplete,
  onMarkAllRead,
  onDeleted,
}: UseFeedActionsOpts) {
  const [renaming, setRenaming] = useState<RenamingState>(null)
  const [confirm, setConfirm] = useState<ConfirmState>(null)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const suppressClick = useRef(false)
  const { mutate: globalMutate } = useSWRConfig()

  const revalidateArticles = useCallback(() => {
    void globalMutate((key: unknown) =>
      typeof key === 'string' && key.includes('/api/articles'))
  }, [globalMutate])

  // Auto-focus rename input (only when renaming starts, not on every keystroke)
  const renamingId = renaming ? `${renaming.type}-${renaming.type === 'feed' ? renaming.feed.id : renaming.category.id}` : null
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus()
      renameInputRef.current.select()
    }
  }, [renamingId])

  function handleStartRenameFeed(feed: FeedWithCounts) {
    setRenaming({
      type: 'feed',
      feed,
      name: feed.name,
      iconUrl: feed.icon_url ?? '',
      priorityLevel: getFeedPriorityLevel(feed),
    })
  }

  function handleStartRenameCategory(category: Category) {
    setRenaming({ type: 'category', category, name: category.name })
  }

  async function handleMarkAllReadFeed(feed: FeedWithCounts) {
    await apiPost(`/api/feeds/${feed.id}/mark-all-seen`)
    void mutateFeeds()
    onMarkAllRead?.()
  }

  async function handleMarkAllReadCategory(category: Category) {
    await apiPost(`/api/categories/${category.id}/mark-all-seen`)
    void mutateFeeds()
    onMarkAllRead?.()
  }

  function handleDeleteFeed(feed: FeedWithCounts) {
    setConfirm({ type: 'delete-feed', feed })
  }

  function handleDeleteCategory(category: Category) {
    setConfirm({ type: 'delete-category', category })
  }

  async function handleMoveToCategory(feed: FeedWithCounts, categoryId: number | null) {
    const feedId = feed.id
    void mutateFeeds(
      prev => prev ? { ...prev, feeds: prev.feeds.map(f => f.id === feedId ? { ...f, category_id: categoryId } : f) } : prev,
      { revalidate: false },
    )
    try {
      await apiPatch(`/api/feeds/${feedId}`, { category_id: categoryId })
    } catch {
      void mutateFeeds()
    }
  }

  async function handleUpdateViewType(feed: FeedWithCounts, viewType: FeedWithCounts['view_type']) {
    const feedId = feed.id
    void mutateFeeds(
      prev => prev ? {
        ...prev,
        feeds: prev.feeds.map(f => f.id === feedId ? { ...f, view_type: viewType } : f),
      } : prev,
      { revalidate: false },
    )
    try {
      await apiPatch(`/api/feeds/${feedId}`, { view_type: viewType })
      revalidateArticles()
    } catch {
      void mutateFeeds()
    }
  }

  async function handleUpdatePriority(feed: FeedWithCounts, priorityLevel: FeedPriorityLevel) {
    const feedId = feed.id
    const patch = buildFeedPriorityPatch(priorityLevel)
    void mutateFeeds(
      prev => prev ? {
        ...prev,
        feeds: prev.feeds.map(f => f.id === feedId ? { ...f, ...patch } : f),
      } : prev,
      { revalidate: false },
    )
    try {
      await apiPatch(`/api/feeds/${feedId}`, patch)
      revalidateArticles()
    } catch {
      void mutateFeeds()
    }
  }

  async function handleLowerPriority(feed: FeedWithCounts) {
    const currentLevel = getFeedPriorityLevel(feed)
    if (currentLevel <= 1) return currentLevel
    const nextLevel = (currentLevel - 1) as FeedPriorityLevel
    await handleUpdatePriority(feed, nextLevel)
    return nextLevel
  }

  async function handleFetchFeed(feed: FeedWithCounts) {
    const result = await startFeedFetch(feed.id)
    onFetchComplete?.({ ...result, name: feed.name })
  }

  async function handleFetchCategory(category: Category) {
    const categoryFeeds = categorized.get(category.id) ?? []
    const results = await Promise.all(
      categoryFeeds.filter(f => !f.disabled).map(f => startFeedFetch(f.id))
    )
    const combined: FetchResult = {
      totalNew: results.reduce((s, r) => s + r.totalNew, 0),
      error: results.some(r => r.error) || undefined,
      name: category.name,
    }
    onFetchComplete?.(combined)
  }

  async function handleReDetectFeed(feed: FeedWithCounts) {
    try {
      await apiPost(`/api/feeds/${feed.id}/re-detect`)
      void mutateFeeds()
      const result = await startFeedFetch(feed.id)
      onFetchComplete?.(result)
    } catch (err) {
      void err
    }
  }

  async function handleConfirm() {
    if (!confirm) return
    if (confirm.type === 'delete-feed' && confirm.feed) {
      const feedId = confirm.feed.id
      void mutateFeeds(
        prev => prev ? { ...prev, feeds: prev.feeds.filter(f => f.id !== feedId) } : prev,
        { revalidate: false },
      )
      setConfirm(null)
      try {
        await apiDelete(`/api/feeds/${feedId}`)
      } catch {
        // rollback on failure
      }
      void mutateFeeds()
      revalidateArticles()
      onDeleted?.()
      return
    } else if (confirm.type === 'enable-feed' && confirm.feed) {
      await apiPatch(`/api/feeds/${confirm.feed.id}`, { disabled: 0 })
      void mutateFeeds()
    } else if (confirm.type === 'delete-category' && confirm.category) {
      const catId = confirm.category.id
      void mutateCategories(
        prev => prev ? { ...prev, categories: prev.categories.filter(c => c.id !== catId) } : prev,
        { revalidate: false },
      )
      setConfirm(null)
      try {
        await apiDelete(`/api/categories/${catId}`)
      } catch {
        // rollback on failure
      }
      void mutateCategories()
      void mutateFeeds()
      revalidateArticles()
      onDeleted?.()
      return
    }
    setConfirm(null)
  }

  async function handleRenameSubmit() {
    if (!renaming || !renaming.name.trim()) return
    if (renaming.type === 'feed') {
      await apiPatch(`/api/feeds/${renaming.feed.id}`, {
        name: renaming.name.trim(),
        icon_url: normalizeFeedIconUrl(renaming.iconUrl),
        ...buildFeedPriorityPatch(renaming.priorityLevel),
      })
      void mutateFeeds()
    } else {
      await apiPatch(`/api/categories/${renaming.category.id}`, { name: renaming.name.trim() })
      void mutateCategories()
    }
    setRenaming(null)
  }

  async function handleToggleCollapse(category: Category, e: React.MouseEvent) {
    e.stopPropagation()
    const newCollapsed = category.collapsed ? 0 : 1
    void mutateCategories(
      prev => prev ? { categories: prev.categories.map(c => c.id === category.id ? { ...c, collapsed: newCollapsed } : c) } : prev,
      { revalidate: false },
    )
    try {
      await apiPatch(`/api/categories/${category.id}`, { collapsed: newCollapsed })
    } catch {
      void mutateCategories()
    }
  }

  return {
    renaming,
    setRenaming,
    confirm,
    setConfirm,
    renameInputRef,
    suppressClick,
    handleStartRenameFeed,
    handleStartRenameCategory,
    handleMarkAllReadFeed,
    handleMarkAllReadCategory,
    handleDeleteFeed,
    handleDeleteCategory,
    handleMoveToCategory,
    handleUpdateViewType,
    handleUpdatePriority,
    handleLowerPriority,
    handleFetchFeed,
    handleFetchCategory,
    handleReDetectFeed,
    handleConfirm,
    handleRenameSubmit,
    handleToggleCollapse,
  }
}
