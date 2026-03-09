import { useI18n } from '../../lib/i18n'

type Strength = 'tooShort' | 'weak' | 'fair' | 'strong'

function getStrength(password: string): Strength {
  if (password.length < 8) return 'tooShort'

  let score = 0
  if (/[a-z]/.test(password)) score++
  if (/[A-Z]/.test(password)) score++
  if (/[0-9]/.test(password)) score++
  if (/[^a-zA-Z0-9]/.test(password)) score++

  if (password.length >= 12 && score >= 3) return 'strong'
  if (score >= 2) return 'fair'
  return 'weak'
}

const config: Record<Strength, { ratio: string; color: string; labelKey: 'password.tooShort' | 'password.weak' | 'password.fair' | 'password.strong' }> = {
  tooShort: { ratio: 'w-1/4', color: 'bg-error', labelKey: 'password.tooShort' },
  weak:     { ratio: 'w-1/3', color: 'bg-error', labelKey: 'password.weak' },
  fair:     { ratio: 'w-2/3', color: 'bg-warning', labelKey: 'password.fair' },
  strong:   { ratio: 'w-full', color: 'bg-accent', labelKey: 'password.strong' },
}

export function PasswordStrength({ password }: { password: string }) {
  const { t } = useI18n()

  if (!password) return null

  const strength = getStrength(password)
  const { ratio, color, labelKey } = config[strength]

  return (
    <div className="mt-1.5 space-y-1">
      <div className="h-1 w-full rounded-full bg-border overflow-hidden">
        <div className={`h-full rounded-full transition-all duration-300 ${ratio} ${color}`} />
      </div>
      <p className="text-xs text-muted">{t(labelKey)}</p>
    </div>
  )
}
