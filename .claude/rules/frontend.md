---
paths:
  - "src/**"
---

# Frontend: Theme System

This project has a multi-theme system (14 themes, light/dark each). Theme colors are defined in `src/data/themes.ts` and applied as CSS custom properties via `use-theme.ts`. `src/index.css` is just a fallback default.

- Never use raw colors (`text-gray-500`, `bg-white`, `#ccc`, etc.) — use theme tokens (`text-text`, `text-muted`, `bg-bg-card`, `border-border`, `text-accent`, etc.)
- Do not change color values or add new tokens without user approval — color choices are intentional design decisions across all 18 themes

# Frontend: Z-Index Scale

Floating UI elements use Portal to `<body>` and are layered by z-index. Follow this scale:

```
z-30   header
z-40   sidebar overlay
z-50   tooltip, dropdown, sidebar, popover
z-60   context-menu
z-70   dialog / modal (overlay & content)
z-80   floating UI inside dialogs (select, popover, etc.)
z-90   chat panel
z-100  image lightbox
```

- When adding a new floating element, pick from this scale — do not invent arbitrary values
- To fix stacking issues between portaled elements (e.g. Select inside Dialog), adjust z-index in the base UI component (`src/components/ui/`), not at each call site
- Do NOT portal floating elements into dialog containers to fix stacking — keep all portals targeting `<body>` and control layering via z-index. Portaling into dialogs causes overflow clipping issues and requires ref plumbing that silently breaks when forgotten

# Frontend: Dialog Height & Scrolling

- Any dialog/modal that can contain forms, editors, previews, or dynamic content must be viewport-bounded and internally scrollable
- Default dialog containers in `src/components/ui/` must include a `max-height` tied to the viewport plus `overflow-y-auto`; do not rely on page scrolling to reveal clipped modal content
- When a dialog starts growing beyond a simple confirmation size, fix height behavior in the shared dialog primitive first instead of patching individual call sites ad hoc
