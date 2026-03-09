import type { LucideIcon } from 'lucide-react'

interface SidebarNavItemProps {
  icon: LucideIcon
  label: string
  selected?: boolean
  badge?: React.ReactNode
  onClick: () => void
  className?: string
  children?: React.ReactNode
}

export function SidebarNavItem({ icon: Icon, label, selected, badge, onClick, className, children }: SidebarNavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left px-2 py-1.5 rounded-lg text-sm flex items-center justify-between outline-none transition-colors hover:bg-hover-sidebar ${
        selected ? 'font-medium text-accent' : (className ?? 'text-text')
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon size={16} strokeWidth={1.5} />
        <span>{label}</span>
      </div>
      {badge}
      {children}
    </button>
  )
}
