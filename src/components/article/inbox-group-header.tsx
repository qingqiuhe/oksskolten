interface InboxGroupHeaderProps {
  title: string
  unreadCount: number
}

export function InboxGroupHeader({ title, unreadCount }: InboxGroupHeaderProps) {
  return (
    <div className="sticky top-[var(--header-height)] z-10 px-4 md:px-6 py-2 bg-bg/90 backdrop-blur supports-[backdrop-filter]:bg-bg/75">
      <div className="flex items-center justify-between rounded-full border border-border bg-bg-subtle px-3 py-1.5 text-xs text-muted">
        <span className="font-medium text-text">{title}</span>
        <span>{unreadCount}</span>
      </div>
    </div>
  )
}
