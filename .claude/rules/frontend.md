---
paths:
  - "src/**"
---

# Frontend: Theme System

This project has a multi-theme system (14 themes, light/dark each). Theme colors are defined in `src/data/themes.ts` and applied as CSS custom properties via `use-theme.ts`. `src/index.css` is just a fallback default.

- Never use raw colors (`text-gray-500`, `bg-white`, `#ccc`, etc.) — use theme tokens (`text-text`, `text-muted`, `bg-bg-card`, `border-border`, `text-accent`, etc.)
- Do not change color values or add new tokens without user approval — color choices are intentional design decisions across all 18 themes
