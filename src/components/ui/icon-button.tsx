import { cn } from '@/lib/utils'

const sizeClasses = {
  xs: 'w-5 h-5',
  sm: 'w-6 h-6',
  md: 'w-7 h-7',
  lg: 'w-8 h-8',
} as const

interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: keyof typeof sizeClasses
}

export function IconButton({ size = 'md', className, children, ...props }: IconButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        'flex items-center justify-center rounded text-muted hover:text-text transition-colors disabled:opacity-50',
        sizeClasses[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  )
}
