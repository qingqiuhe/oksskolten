interface RadioOption<T extends string> {
  value: T
  label: string
}

interface RadioGroupProps<T extends string> {
  name: string
  options: RadioOption<T>[]
  value: T
  onChange: (value: T) => void
}

export function RadioGroup<T extends string>({ name, options, value, onChange }: RadioGroupProps<T>) {
  return (
    <div className="space-y-1.5">
      {options.map(option => (
        <label
          key={option.value}
          className="flex items-center gap-2.5 cursor-pointer py-1"
        >
          <span
            className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors ${
              value === option.value ? 'border-accent' : 'border-muted'
            }`}
          >
            {value === option.value && (
              <span className="w-2 h-2 rounded-full bg-accent" />
            )}
          </span>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
            className="sr-only"
          />
          <span className="text-sm text-text">{option.label}</span>
        </label>
      ))}
    </div>
  )
}
