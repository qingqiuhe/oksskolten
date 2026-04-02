import { useEffect, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'
import { apiPatch, apiPost, fetcher } from '../../lib/fetcher'
import { Input } from '../../components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../components/ui/dialog'

interface CategoryRecord {
  id: number
  name: string
  sort_order: number
}

interface FeedRecord {
  id: number
  name: string
  url: string
  type: 'rss' | 'clip'
  category_id: number | null
}

interface MemberRecord {
  id: number
  email: string
  role: 'owner' | 'admin' | 'member'
  status: 'active' | 'invited' | 'disabled'
  last_login_at: string | null
}

interface InviteResult {
  invite_url: string
  import_result?: {
    imported_feed_count: number
    imported_category_count: number
  }
}

function FeedImportCheckbox({
  checked,
  indeterminate,
  onChange,
}: {
  checked: boolean
  indeterminate?: boolean
  onChange: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = !!indeterminate
    }
  }, [indeterminate])

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      className="mt-0.5 accent-accent"
    />
  )
}

export function MembersTab() {
  const { data, mutate } = useSWR<{ users: MemberRecord[] }>('/api/users', fetcher)
  const { data: feedsData } = useSWR<{ feeds: FeedRecord[] }>('/api/feeds', fetcher)
  const { data: categoriesData } = useSWR<{ categories: CategoryRecord[] }>('/api/categories', fetcher)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'member'>('member')
  const [inviteLink, setInviteLink] = useState<string | null>(null)
  const [inviteSummary, setInviteSummary] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPickerOpen, setIsPickerOpen] = useState(false)
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<number>>(new Set())

  const availableFeeds = useMemo(
    () => (feedsData?.feeds ?? []).filter(feed => feed.type !== 'clip'),
    [feedsData?.feeds],
  )

  const groupedFeeds = useMemo(() => {
    const categoryOrder = new Map((categoriesData?.categories ?? []).map(category => [category.id, category]))
    const groups = new Map<string, { key: string; categoryId: number | null; name: string; sortOrder: number; feeds: FeedRecord[] }>()

    for (const feed of availableFeeds) {
      const category = feed.category_id ? categoryOrder.get(feed.category_id) : null
      const key = category ? `category-${category.id}` : 'uncategorized'
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          categoryId: category?.id ?? null,
          name: category?.name ?? 'Uncategorized',
          sortOrder: category?.sort_order ?? Number.MAX_SAFE_INTEGER,
          feeds: [],
        })
      }
      groups.get(key)!.feeds.push(feed)
    }

    return Array.from(groups.values())
      .map(group => ({
        ...group,
        feeds: group.feeds.slice().sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
  }, [availableFeeds, categoriesData?.categories])

  useEffect(() => {
    setSelectedFeedIds(prev => {
      if (prev.size > 0) return prev
      if (availableFeeds.length === 0) return prev
      return new Set(availableFeeds.map(feed => feed.id))
    })
  }, [availableFeeds])

  async function inviteMember() {
    setError(null)
    try {
      const result = await apiPost('/api/users', {
        email,
        role,
        import_feed_ids: Array.from(selectedFeedIds),
      }) as InviteResult
      setInviteLink(result.invite_url)
      setInviteSummary(
        `Imported ${result.import_result?.imported_feed_count ?? 0} feeds across ${result.import_result?.imported_category_count ?? 0} folders.`,
      )
      setEmail('')
      setSelectedFeedIds(new Set(availableFeeds.map(feed => feed.id)))
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to invite member')
    }
  }

  async function updateMember(id: number, patch: Record<string, unknown>) {
    setError(null)
    try {
      await apiPatch(`/api/users/${id}`, patch)
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update member')
    }
  }

  async function resetInvite(id: number) {
    setError(null)
    try {
      const result = await apiPost(`/api/users/${id}/invite/reset`) as { invite_url: string }
      setInviteLink(result.invite_url)
      await mutate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset invite')
    }
  }

  function toggleFeed(feedId: number) {
    setSelectedFeedIds(prev => {
      const next = new Set(prev)
      if (next.has(feedId)) next.delete(feedId)
      else next.add(feedId)
      return next
    })
  }

  function toggleGroup(feedIds: number[]) {
    const allSelected = feedIds.every(id => selectedFeedIds.has(id))
    setSelectedFeedIds(prev => {
      const next = new Set(prev)
      for (const id of feedIds) {
        if (allSelected) next.delete(id)
        else next.add(id)
      }
      return next
    })
  }

  function selectAllFeeds() {
    setSelectedFeedIds(new Set(availableFeeds.map(feed => feed.id)))
  }

  function deselectAllFeeds() {
    setSelectedFeedIds(new Set())
  }

  const selectedCategoryCount = groupedFeeds.filter(group => group.feeds.some(feed => selectedFeedIds.has(feed.id))).length

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-text">Members</h2>
        <p className="text-xs text-muted mt-1">Invite and manage workspace members.</p>
      </div>

      <div className="rounded-xl border border-border bg-bg-card p-4 space-y-3">
        <div className="grid gap-3 md:grid-cols-[1fr_140px_auto]">
          <Input
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <select
            value={role}
            onChange={e => setRole(e.target.value as 'admin' | 'member')}
            className="rounded-lg border border-border bg-bg-input px-3 py-2 text-sm text-text"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="button"
            onClick={inviteMember}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-text"
          >
            Invite
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setIsPickerOpen(true)}
            className="rounded-lg border border-border px-3 py-2 text-sm text-text hover:bg-hover"
          >
            Choose subscriptions
          </button>
          <p className="text-xs text-muted">
            {selectedFeedIds.size} feeds selected across {selectedCategoryCount} folders.
          </p>
        </div>
        {inviteLink && (
          <div className="space-y-2">
            <div className="rounded-lg bg-bg-input px-3 py-2 text-xs text-text break-all">
              {inviteLink}
            </div>
            {inviteSummary && (
              <p className="text-xs text-muted">{inviteSummary}</p>
            )}
          </div>
        )}
        {error && <p className="text-sm text-red-500">{error}</p>}
      </div>

      <div className="rounded-xl border border-border bg-bg-card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-bg-sidebar text-muted">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Email</th>
              <th className="px-4 py-3 text-left font-medium">Role</th>
              <th className="px-4 py-3 text-left font-medium">Status</th>
              <th className="px-4 py-3 text-left font-medium">Last login</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data?.users?.map(user => (
              <tr key={user.id} className="border-t border-border">
                <td className="px-4 py-3">{user.email}</td>
                <td className="px-4 py-3">
                  <select
                    value={user.role}
                    disabled={user.role === 'owner'}
                    onChange={e => void updateMember(user.id, { role: e.target.value })}
                    className="rounded-md border border-border bg-bg-input px-2 py-1 text-sm text-text disabled:opacity-50"
                  >
                    <option value="owner">Owner</option>
                    <option value="admin">Admin</option>
                    <option value="member">Member</option>
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={user.status}
                    disabled={user.role === 'owner'}
                    onChange={e => void updateMember(user.id, { status: e.target.value })}
                    className="rounded-md border border-border bg-bg-input px-2 py-1 text-sm text-text disabled:opacity-50"
                  >
                    <option value="active">Active</option>
                    <option value="invited">Invited</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </td>
                <td className="px-4 py-3 text-muted">{user.last_login_at ? new Date(user.last_login_at).toLocaleString() : 'Never'}</td>
                <td className="px-4 py-3 space-x-2">
                  {user.status === 'invited' && (
                    <button type="button" onClick={() => void resetInvite(user.id)} className="text-accent hover:underline">
                      Reset invite
                    </button>
                  )}
                  {user.role !== 'owner' && (
                    <button
                      type="button"
                      onClick={() => void apiPost(`/api/users/${user.id}/sessions/revoke`).then(() => mutate())}
                      className="text-accent hover:underline"
                    >
                      Revoke sessions
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={isPickerOpen} onOpenChange={setIsPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import subscriptions</DialogTitle>
            <DialogDescription>
              Choose which folders and feeds should be copied to the invited user.
            </DialogDescription>
          </DialogHeader>

          <div className="flex gap-3 text-xs">
            <button type="button" onClick={selectAllFeeds} className="text-accent hover:underline">Select all</button>
            <button type="button" onClick={deselectAllFeeds} className="text-accent hover:underline">Deselect all</button>
          </div>

          <div className="max-h-[60vh] overflow-y-auto space-y-4">
            {groupedFeeds.map(group => {
              const groupFeedIds = group.feeds.map(feed => feed.id)
              const selectedCount = groupFeedIds.filter(id => selectedFeedIds.has(id)).length
              const allSelected = selectedCount === groupFeedIds.length && groupFeedIds.length > 0
              const partiallySelected = selectedCount > 0 && selectedCount < groupFeedIds.length

              return (
                <div key={group.key} className="space-y-2">
                  <label className="flex items-center gap-2 border-b border-border pb-1">
                    <FeedImportCheckbox
                      checked={allSelected}
                      indeterminate={partiallySelected}
                      onChange={() => toggleGroup(groupFeedIds)}
                    />
                    <span className="text-xs font-medium uppercase tracking-wide text-muted">{group.name}</span>
                  </label>
                  <div className="space-y-1">
                    {group.feeds.map(feed => (
                      <label key={feed.id} className="flex items-start gap-2 rounded px-1 py-1 hover:bg-hover">
                        <FeedImportCheckbox
                          checked={selectedFeedIds.has(feed.id)}
                          onChange={() => toggleFeed(feed.id)}
                        />
                        <div className="min-w-0">
                          <div className="text-sm text-text">{feed.name}</div>
                          <div className="text-xs text-muted break-all">{feed.url}</div>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          <DialogFooter>
            <button
              type="button"
              onClick={() => setIsPickerOpen(false)}
              className="rounded-lg border border-border px-3 py-1.5 text-sm text-text hover:bg-hover"
            >
              Done
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
