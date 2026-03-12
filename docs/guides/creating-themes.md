# Creating Themes

This document explains how the color theme system works and how to create new themes. There are two ways to add themes:

1. **Custom themes (JSON import)** — Create a JSON file and import it via Settings. No code changes needed.
2. **Built-in themes** — Add a theme definition to `src/data/themes.ts` (for themes shipped with the app).

## How It Works

Themes are defined as objects in the `themes` array in `src/data/themes.ts`. Each theme provides two sets of color tokens — one for **light mode** and one for **dark mode**. Theme switching works by updating CSS custom properties on the document root. Tailwind CSS utility classes reference these variables.

**Key files:**

| File | Role |
|---|---|
| `src/data/themes.ts` | Theme definitions (`Theme` interface, `themes` array) |
| `src/data/highlightThemes.ts` | Code highlight theme definitions (families, preview colors, CSS resolution) |
| `src/lib/theme-json.ts` | Custom theme JSON parsing, validation, and property name mapping |
| `src/hooks/use-theme.ts` | Theme switching logic (localStorage, CSS variable application) |
| `src/index.css` | CSS custom property initial values (fallback before theme is applied) |
| `tailwind.config.ts` | Maps CSS variables to Tailwind color utilities |

## Theme Object Structure

```typescript
{
  name: string,                      // Internal identifier. Stored in localStorage. Use kebab-case
  label: string,                     // Display name shown in the UI
  indicatorStyle: 'dot' | 'line',    // Unread indicator shape in feed list
  highlight: string,                 // Default code highlight theme family key
  colors: {
    light: Record<string, string>,   // Light mode color tokens
    dark: Record<string, string>,    // Dark mode color tokens
  },
}
```

- **`indicatorStyle`**: Shape of the unread indicator shown next to articles in the feed list. `'dot'` (circle) or `'line'` (vertical bar)
- **`highlight`**: Default highlight theme used when the user has code highlighting set to "auto". Refers to a family key defined in `highlightThemeFamilies` in `src/data/highlightThemes.ts` (e.g., `'github'`, `'atom-one'`). See the [Code Highlight Themes](#code-highlight-themes) section

## Color Tokens

### Required Tokens

These 12 tokens must be defined in both `light` and `dark`.

| Token | Tailwind Class | Purpose |
|---|---|---|
| `--color-bg` | `bg-bg` | Page background |
| `--color-bg-subtle` | `bg-bg-subtle` | Secondary backgrounds: code blocks, skeletons, summary boxes |
| `--color-bg-avatar` | `bg-bg-avatar` | Avatar placeholder background in sidebar |
| `--color-text` | `text-text` | Primary text, headings |
| `--color-muted` | `text-muted` | Dates, meta info, secondary text |
| `--color-accent` | `text-accent` | Links, active feed names, button backgrounds |
| `--color-accent-text` | `text-accent-text` | Text on accent-colored button backgrounds |
| `--color-error` | `text-error` | Error messages |
| `--color-border` | `border-border` | All borders: card dividers, input outlines, header underlines |
| `--color-hover` | `bg-hover` | Hover state backgrounds. Specify as `rgba()` |
| `--color-overlay` | `bg-overlay` | Modal/drawer backdrop. Specify as `rgba()` |

### Optional Tokens (with fallbacks)

These tokens can be omitted. When omitted, `--color-bg` is used automatically via `resolveColors()`. Only specify them when you want a different color from the page background.

| Token | Tailwind Class | Purpose | Fallback |
|---|---|---|---|
| `--color-bg-card` | `bg-bg-card` | Floating panels: modals, drawers | `--color-bg` |
| `--color-bg-sidebar` | `bg-bg-sidebar` | Sidebar background | `--color-bg` |
| `--color-bg-header` | `bg-bg-header` | Sticky header | `--color-bg` |
| `--color-bg-input` | `bg-bg-input` | Text inputs, selects | `--color-bg` |

## Creating a Custom Theme (JSON Import)

Users can create and import custom themes without modifying the source code. Themes are defined as JSON and imported via the Settings > Appearance page.

### JSON Format

```json
{
  "name": "my-theme",
  "label": "My Theme",
  "colors": {
    "light": {
      "background": "#ffffff",
      "background.sidebar": "#f0f0f2",
      "background.subtle": "#f5f5f5",
      "background.avatar": "#d8d8dc",
      "text": "#1a1a1a",
      "text.muted": "#6b7280",
      "accent": "#2563eb",
      "accent.text": "#ffffff",
      "error": "#dc2626",
      "border": "#e5e7eb",
      "hover": "rgba(0, 0, 0, 0.04)",
      "overlay": "rgba(0, 0, 0, 0.3)"
    },
    "dark": {
      "background": "#111111",
      "background.sidebar": "#080808",
      "background.subtle": "#1a1a1a",
      "background.avatar": "#2a2a2a",
      "text": "#e8e8e8",
      "text.muted": "#6b7280",
      "accent": "#60a5fa",
      "accent.text": "#ffffff",
      "error": "#f87171",
      "border": "#2a2a2a",
      "hover": "rgba(255, 255, 255, 0.05)",
      "overlay": "rgba(0, 0, 0, 0.5)"
    }
  }
}
```

Both `light` and `dark` are required. Optional properties (`background.input`, `background.card`, `background.header`, `text.code`) can be omitted — they inherit from the base values via `resolveColors()`.

### Property Name Mapping

The JSON uses human-friendly names that are converted to CSS custom properties internally.

| JSON key | CSS custom property | Required |
|---|---|---|
| `background` | `--color-bg` | Yes |
| `background.sidebar` | `--color-bg-sidebar` | Yes |
| `background.subtle` | `--color-bg-subtle` | Yes |
| `background.avatar` | `--color-bg-avatar` | Yes |
| `background.input` | `--color-bg-input` | No |
| `background.card` | `--color-bg-card` | No |
| `background.header` | `--color-bg-header` | No |
| `text` | `--color-text` | Yes |
| `text.muted` | `--color-muted` | Yes |
| `text.code` | `--color-code` | No |
| `accent` | `--color-accent` | Yes |
| `accent.text` | `--color-accent-text` | Yes |
| `error` | `--color-error` | Yes |
| `border` | `--color-border` | Yes |
| `hover` | `--color-hover` | Yes |
| `overlay` | `--color-overlay` | Yes |

### Importing

1. Go to **Settings > Appearance**
2. Scroll to the theme grid and click **"Choose File"** (to upload a `.json` file) or **"Paste JSON"** (to paste directly)
3. The theme is validated, saved, and immediately applied

Custom themes appear after the built-in themes with a delete button on hover. Up to 20 custom themes are allowed. Themes are stored in the database and synced across sessions.

### Validation Rules

- `name`: Required. Lowercase alphanumeric, hyphens, and underscores only (`/^[a-z0-9_-]+$/`). Must not conflict with built-in or existing custom theme names.
- `label`: Required. Display name (max 50 characters).
- `colors`: Both `light` and `dark` must be provided with all required properties.

### Optional Fields

- `indicatorStyle`: `"dot"` (default) or `"line"` — controls unread indicator shape
- `highlight`: Code highlight theme family key (default: `"github"`) — see [Code Highlight Themes](#code-highlight-themes)

---

## Adding a Built-in Theme

To add a theme to the built-in set (shipped with the app), add a theme object to the `themes` array in `src/data/themes.ts`.

Minimal example (required tokens only):

```typescript
{
  name: 'my-theme',
  label: 'My Theme',
  indicatorStyle: 'dot',
  highlight: 'github',
  colors: {
    light: {
      '--color-bg': '#ffffff',
      '--color-bg-subtle': '#f5f5f5',
      '--color-bg-avatar': '#d8d8dc',
      '--color-text': '#1a1a1a',
      '--color-muted': '#6b7280',
      '--color-accent': '#2563eb',
      '--color-accent-text': '#ffffff',
      '--color-error': '#dc2626',
      '--color-overlay': 'rgba(0, 0, 0, 0.3)',
      '--color-border': '#e5e7eb',
      '--color-hover': 'rgba(0, 0, 0, 0.04)',
    },
    dark: {
      '--color-bg': '#111111',
      '--color-bg-subtle': '#1a1a1a',
      '--color-bg-avatar': '#2a2a2a',
      '--color-text': '#e8e8e8',
      '--color-muted': '#6b7280',
      '--color-accent': '#60a5fa',
      '--color-accent-text': '#ffffff',
      '--color-error': '#f87171',
      '--color-overlay': 'rgba(0, 0, 0, 0.5)',
      '--color-border': '#2a2a2a',
      '--color-hover': 'rgba(255, 255, 255, 0.05)',
    },
  },
}
```

That's it. The optional tokens (`--color-bg-card`, `--color-bg-sidebar`, `--color-bg-header`, `--color-bg-input`) automatically inherit from `--color-bg`. The theme selector in the settings page picks up the new entry automatically.

To customize further, add optional tokens:

```typescript
light: {
  '--color-bg': '#f6f8fa',
  '--color-bg-card': '#ffffff',    // Cards float above the page
  '--color-bg-header': '#ffffff',  // White header
  // '--color-bg-input' omitted → inherits '#f6f8fa' from bg
  ...
},
```

### 2. Verify the theme

Check the following:

- Colors render correctly in both light and dark modes
- Text on accent backgrounds (`--color-accent-text`) is readable
- Error messages are visible against `--color-bg-card`
- Overlay adequately dims the background content

## Design Tips

### Start with 8 colors

You don't need to think about all 12 required tokens individually. Pick these 8 colors first — the rest can be derived. Optional tokens (`bg-card`, `bg-sidebar`, `bg-header`, `bg-input`) are auto-filled by `resolveColors()`, so you don't need them until you want visual separation.

| Base Color | Derived Tokens |
|---|---|
| `--color-bg` | `--color-bg-card`, `--color-bg-sidebar`, `--color-bg-header`, `--color-bg-input` auto-fallback |
| `--color-bg-subtle` | — |
| `--color-bg-avatar` | — (typically a muted tone between `bg-subtle` and `border`) |
| `--color-text` | — |
| `--color-muted` | — |
| `--color-accent` | — |
| `--color-border` | — |
| `--color-hover` | Use `--color-bg` tint as `rgba()` at 4–6% alpha |

The remaining 3:
- `--color-accent-text`: Usually `#ffffff` in light mode. For themes with dark backgrounds, use the same value as `--color-bg`
- `--color-error`: Pick a red that fits the theme's tone. Use a brighter shade for dark mode
- `--color-overlay`: Light mode ~`rgba(0, 0, 0, 0.3)`, dark mode ~`rgba(0, 0, 0, 0.5)`

### Background elevation

Setting `--color-bg-card` / `--color-bg-sidebar` / `--color-bg-header` to a different color from `--color-bg` creates a visual effect where panels float above the page. The GitHub theme uses this technique in light mode:

```
--color-bg:        #f6f8fa  (gray page background)
--color-bg-card:   #ffffff  (white modals/drawers)
--color-bg-header: #ffffff  (white header)
```

### Dark mode inputs

In dark mode, setting `--color-bg-input` to the same value as `--color-bg-subtle` makes input fields slightly stand out from the background, improving visibility.

### Contrast ratios

Aim for WCAG AA (4.5:1) contrast ratio between text and background. Pay special attention to:

- `--color-text` on `--color-bg`
- `--color-muted` on `--color-bg`
- `--color-accent-text` on `--color-accent`
- `--color-error` on `--color-bg-card`

## Code Highlight Themes

Code blocks in articles use highlight.js for syntax highlighting. Highlight color schemes are managed in `highlightThemeFamilies` in `src/data/highlightThemes.ts`.

### User options

In Settings > Theme, users can choose from:

| Option | Behavior |
|---|---|
| **Auto (theme-linked)** | Uses the family specified in the color theme's `highlight` field |
| **Specific family** | Always uses the user's chosen family |
| **None** | Disables syntax highlighting (plain text) |

Default is "Auto".

### Families and mode resolution

Each family has a **light** and **dark** CSS file name. The system automatically switches based on the current color mode.

```typescript
// highlightThemes.ts
{
  value: 'github',          // Family key (referenced by theme's highlight field)
  label: 'GitHub',          // UI display name
  light: 'github',          // CSS file name for light mode
  dark: 'github-dark',      // CSS file name for dark mode
  preview: { ... },         // Representative colors for settings preview card
}
```

### Fallback

If the `highlight` field references a non-existent family key, `resolveHighlightCss()` falls back to `'github'` for light mode and `'github-dark'` for dark mode.

### Choosing a highlight family for your theme

- Pick a highlight family that matches your theme's color palette. e.g., Solarized theme → `'paraiso'`, Tokyo Night theme → `'tokyo-night'`
- When in doubt, `'github'` works well with any theme

### Available families

| Family Key | Label | Light CSS | Dark CSS |
|---|---|---|---|
| `github` | GitHub | `github` | `github-dark` |
| `github-dimmed` | GitHub Dimmed | `github` | `github-dark-dimmed` |
| `paraiso` | Paraíso | `paraiso-light` | `paraiso-dark` |
| `atom-one` | Atom One | `atom-one-light` | `atom-one-dark` |
| `tokyo-night` | Tokyo Night | `tokyo-night-light` | `tokyo-night-dark` |
| `vs` | VS | `vs` | `vs2015` |
| `nord` | Nord | `nord` | `nord` |
| `rose-pine` | Rosé Pine | `rose-pine-dawn` | `rose-pine` |

### Preview field

Each family has a `preview` field with representative colors (`bg`, `text`, `keyword`, `string`, `comment`) for both light and dark modes. These are used in the settings preview card. When adding a new family, extract representative colors from the corresponding CSS files.

## Built-in Themes

| name | label | highlight | indicatorStyle | Notes |
|---|---|---|---|---|
| `default` | Default | `github` | `dot` | Neutral white/black base |
| `babarot` | Babarot | `atom-one` | `line` | Minimal theme with red accent |
| `catppuccin` | Catppuccin | `atom-one` | `dot` | Catppuccin Latte (light) / Mocha (dark) palette |
| `claude` | Claude | `github` | `dot` | Warm cream/brown inspired by claude.ai |
| `dracula` | Dracula | `atom-one` | `line` | Dracula color scheme |
| `github` | GitHub | `github-dimmed` | `line` | GitHub UI colors. Card elevation in light mode |
| `gruvbox` | Gruvbox | `paraiso` | `dot` | Gruvbox retro groove palette |
| `midnight-haze` | Midnight Haze | `github-dimmed` | `dot` | Dark-leaning neutral theme |
| `nord` | Nord | `nord` | `dot` | Arctic, north-bluish color palette |
| `one-dark` | One Dark | `atom-one` | `line` | Atom One Dark inspired |
| `rose-pine` | Rosé Pine | `rose-pine` | `dot` | All natural pine, faux fur, and a bit of soho vibes |
| `solarized` | Solarized | `paraiso` | `dot` | Ethan Schoonover's Solarized palette |
| `tell-me-tokyo` | Tell Me Tokyo | `atom-one` | `line` | Purple accent |
| `tokyo-night` | Tokyo Night | `tokyo-night` | `line` | VS Code Tokyo Night theme |
