---
paths:
  - "src/data/themes.ts"
  - "src/data/highlightThemes.ts"
  - "docs/guides/creating-themes.md"
---

# Theme Development Rules

See `docs/guides/creating-themes.md` for full guide.

- Always define both `light` and `dark` color sets — never leave one side empty
- Do not duplicate `--color-bg` into optional tokens (`bg-card`, `bg-header`, `bg-input`) — `resolveColors()` auto-fills them. Only add when you intentionally want a different color
- `--color-hover` and `--color-overlay` must use `rgba()` — never opaque values
- Pick a `highlight` family that matches the theme's color tone. When unsure, use `'github'`
- Do not change existing theme color values without user approval — colors are intentional design decisions across all themes
