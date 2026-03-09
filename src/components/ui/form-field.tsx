import { cn } from '@/lib/utils'

interface FormFieldProps {
  label: string
  htmlFor?: string
  compact?: boolean
  hint?: string
  className?: string
  children: React.ReactNode
}

export function FormField({ label, htmlFor, compact, hint, className, children }: FormFieldProps) {
  return (
    <div className={className}>
      <label
        htmlFor={htmlFor}
        className={cn(
          'block select-none',
          compact
            ? 'text-xs text-muted mb-1'
            : 'text-sm font-medium text-text mb-1.5',
        )}
      >
        {label}
      </label>
      {hint && <p className="text-xs text-muted mb-3">{hint}</p>}
      {children}
    </div>
  )
}
