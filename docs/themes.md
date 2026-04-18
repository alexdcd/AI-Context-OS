# Custom Themes

AI Context OS supports vault-scoped custom themes. A theme is a plain `.css` file placed inside the vault's `themes/` folder.

This feature is intentionally lightweight:

- themes are local to the current vault
- the app loads one theme at a time
- themes can override our CSS tokens without changing app code
- compatibility with Obsidian themes is partial, not full

## Where themes live

Create this folder in the root of your vault:

```text
your-vault/
└── themes/
    └── my-theme.css
```

You can also create the folder from `Settings -> Appearance -> Custom themes`.

## How loading works

When you select a theme in the app:

1. AI Context OS scans the vault's `themes/` directory.
2. It lists every `.css` file found there.
3. The selected file is injected into the app as a `<style>` tag.

If the selected file disappears, the app falls back to the built-in theme.

## Supported tokens

Custom themes work best when they target the design tokens already exposed by the app.

### Native AI Context OS tokens

These are the primary tokens:

- `--bg-0`
- `--bg-1`
- `--bg-2`
- `--bg-3`
- `--text-0`
- `--text-1`
- `--text-2`
- `--border`
- `--border-active`
- `--accent`
- `--accent-muted`
- `--danger`
- `--warning`
- `--success`

### Obsidian-compatible aliases

For simpler community themes, AI Context OS also exposes a small compatibility layer:

- `--background-primary`
- `--background-primary-alt`
- `--background-secondary`
- `--background-secondary-alt`
- `--background-modifier-border`
- `--background-modifier-border-hover`
- `--text-normal`
- `--text-muted`
- `--text-faint`
- `--text-accent`
- `--text-on-accent`
- `--interactive-accent`
- `--interactive-accent-hover`
- `--text-error`
- `--text-warning`
- `--text-success`

This is a pragmatic alias layer, not a full Obsidian DOM/theme implementation. Themes that depend on Obsidian-only selectors, plugin classes, or internal layout assumptions may not render correctly.

## Example

```css
:root {
  --accent: #0f766e;
  --accent-muted: rgba(15, 118, 110, 0.12);
  --border-active: rgba(15, 118, 110, 0.35);
}

.light {
  --bg-0: #f4f6f4;
  --bg-1: #ffffff;
  --bg-2: #edf1ee;
  --text-0: #17201c;
}

.dark {
  --bg-0: #101513;
  --bg-1: #151c19;
  --bg-2: #1b2420;
  --text-0: #edf4ef;
}
```

## Safety notes

The loader strips `@import` rules and closing `</style>` tags before injecting the CSS. This keeps theme loading simple and avoids a few obvious injection problems.

Still, themes are trusted local files. Only install CSS themes you are comfortable running in your own vault.

## Recommended workflow

1. Start from a very small `.css` file.
2. Change tokens first before targeting specific selectors.
3. Test both light and dark mode.
4. Test both appearance styles:
   `Modern` and `Classic`.
5. Refresh the theme list from `Settings -> Appearance` after editing or adding files.
