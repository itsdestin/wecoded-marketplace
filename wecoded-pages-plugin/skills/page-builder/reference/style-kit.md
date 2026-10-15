# The page style kit — what a page may use

Generated from the app's `desktop/src/renderer/components/pages/page-kit.ts` (the host injects
this stylesheet into every page, so a page never ships its own copy). Regenerate with
`node scripts/extract-page-kit.cjs` from the marketplace repo when the app's kit changes.

## Theme values a page may read (CSS custom properties, delivered live)

`--canvas` `--panel` `--inset` `--well` `--accent` `--on-accent` `--fg` `--fg-2` `--fg-dim` `--fg-muted` `--fg-faint`
`--edge` `--edge-dim` `--link` `--link-hover` `--destructive` `--destructive-fg` `--on-destructive`
`--radius` `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-full` `--font-sans` `--font-mono`

Use `var(--x)` for anything that should follow the theme. Never hard-code a colour for a control;
hard-code colours only for content that must keep them (a drawing, a chart series, a photo).

## Dropdowns

Write a plain `<select class="yc-select">` with its `<option>`s. The app opens every single-choice
`<select>` in its own menu look (the kit's `.yc-menu` list), never the browser's white list, and the
`<select>` stays the real control: read and set `.value`, listen for `change`, as usual. Never build
a hand-made dropdown, and never style `.yc-menu` yourself.

An action at the foot of the list ("Add another option…") is `<option value="__add" data-yc-action>`:
it is drawn below the choices behind a divider. Choosing it fires `change` with its value like any
option, so your handler does the action and sets the select back to the previous value.

## Classes

```
yc-app
yc-app__body
yc-app__main
yc-badge
yc-button
yc-button--danger
yc-button--full
yc-button--ghost
yc-button--icon
yc-button--primary
yc-button--round
yc-button--sm
yc-caption
yc-card
yc-card--inset
yc-chip
yc-dim
yc-divider
yc-empty
yc-eyebrow
yc-faint
yc-grid
yc-input
yc-kbd
yc-label
yc-list
yc-list-row
yc-menu
yc-menu__foot
yc-menu__group
yc-menu__item
yc-menu__list
yc-mono
yc-muted
yc-page
yc-pill
yc-pill--on
yc-rail
yc-range
yc-row
yc-row--between
yc-row--end
yc-select
yc-sidebar
yc-small
yc-spacer
yc-stack
yc-swatch
yc-swatch--on
yc-swatches
yc-table
yc-textarea
yc-title
yc-tool
yc-tool--on
yc-toolbar
yc-well
```

## The stylesheet, verbatim

```css
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; }
body {
  margin: 0;
  background: var(--canvas);
  color: var(--fg);
  font-family: var(--font-sans, system-ui, sans-serif);
  font-size: 14px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
code, pre, kbd, .yc-mono { font-family: var(--font-mono, ui-monospace, monospace); }
a { color: var(--link, var(--accent)); }
a:hover { color: var(--link-hover, var(--accent)); }
h1, h2, h3, h4 { margin: 0; font-weight: 500; line-height: 1.3; }
h1 { font-size: 18px; font-weight: 600; }
h2 { font-size: 16px; }
h3 { font-size: 14px; }
p { margin: 0; }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: var(--edge); border-radius: 9999px; border: 2px solid var(--canvas); }
::-webkit-scrollbar-track { background: transparent; }

/* See-through (the host sets this attribute only when the app's page pane is
   glass over the theme's wallpaper AND the person has the page's "Show theme
   background" switch on): the page paints no backdrop of its own, so the pane's
   glass — and the wallpaper under it — is what shows, exactly as in Office.
   WHY the scrollbar border changes too: it was painted --canvas to look inset,
   which would be a visible opaque rim on glass. */
:root[data-yc-see-through] body { background: transparent; }
:root[data-yc-see-through] ::-webkit-scrollbar-thumb { border-color: transparent; background-clip: padding-box; }

.yc-page { max-width: 1100px; margin: 0 auto; padding: 16px; }
.yc-stack { display: flex; flex-direction: column; gap: 12px; }
.yc-row { display: flex; align-items: center; gap: 8px; }
.yc-row--end { justify-content: flex-end; }
.yc-row--between { justify-content: space-between; }
.yc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
.yc-spacer { flex: 1; }

/* WHY: dropped the spaced-caps eyebrow look (labels batch, guide: no spaced
   capitals — decisions H-3/L-1…L-4). Class name kept — existing Pages
   reference .yc-eyebrow by name; only its computed style changed, matching
   the app's own SectionLabel: 12px medium grey, normal case, no tracking. */
.yc-eyebrow { font-size: 12px; font-weight: 500; color: var(--fg-muted); }
.yc-title { font-size: 16px; font-weight: 500; color: var(--fg); }
.yc-muted { color: var(--fg-muted); }
.yc-dim { color: var(--fg-dim); }
.yc-faint { color: var(--fg-faint); }
.yc-small { font-size: 12px; }
.yc-caption { font-size: 11px; color: var(--fg-muted); }

.yc-card {
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: var(--radius-lg, 12px);
  padding: 16px;
}
.yc-card--inset { background: var(--inset); border-color: var(--edge-dim); }
.yc-well { background: var(--well); border: 1px solid var(--edge-dim); border-radius: var(--radius-md, 8px); padding: 12px; }
.yc-divider { border: 0; border-top: 1px solid var(--edge-dim); margin: 0; }

.yc-button {
  appearance: none;
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  font: inherit; font-size: 12px; font-weight: 500; line-height: 1.2;
  padding: 7px 12px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--edge);
  background: var(--inset);
  color: var(--fg);
  cursor: pointer;
  user-select: none;
  transition: background-color 150ms ease, border-color 150ms ease, color 150ms ease, opacity 150ms ease;
}
.yc-button:hover { background: var(--well); border-color: var(--fg-faint); }
.yc-button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.yc-button:disabled { opacity: .5; cursor: default; }
.yc-button--primary { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }
.yc-button--primary:hover { background: var(--accent); border-color: var(--accent); opacity: .9; }
.yc-button--ghost { background: transparent; border-color: transparent; color: var(--fg-2); }
.yc-button--ghost:hover { background: var(--inset); border-color: transparent; color: var(--fg); }
.yc-button--danger { background: transparent; border-color: var(--destructive, currentColor); color: var(--destructive-fg, var(--fg)); }
.yc-button--danger:hover { background: var(--destructive, transparent); color: var(--on-destructive, var(--fg)); }
.yc-button--sm { font-size: 11px; padding: 4px 10px; }
.yc-button--full { width: 100%; }
.yc-button--icon { width: 28px; height: 28px; padding: 0; }
.yc-button--round { border-radius: var(--radius-full, 9999px); }

/* WHY select.yc-menu beside .yc-select: the design guide tells page authors the kit's dropdown
   is .yc-menu, so a page that writes <select class="yc-menu"> gets the same closed box. */
.yc-input, .yc-textarea, .yc-select, select.yc-menu {
  font: inherit; font-size: 14px; color: var(--fg);
  background: var(--inset);
  border: 1px solid var(--edge);
  border-radius: var(--radius-md, 8px);
  padding: 7px 10px;
  width: 100%;
}
.yc-input::placeholder, .yc-textarea::placeholder { color: var(--fg-muted); }
.yc-input:focus, .yc-textarea:focus, .yc-select:focus, select.yc-menu:focus { outline: 2px solid var(--accent); outline-offset: 1px; border-color: var(--accent); }
/* The closed dropdown answers the pointer the way the app's own Select does (field.ts
   FIELD_TRIGGER_STATES): the border, never the fill, which would move under the words. */
.yc-select, select.yc-menu { cursor: pointer; transition: border-color 150ms ease; }
.yc-select:hover, select.yc-menu:hover { border-color: var(--fg-muted); }
.yc-select:disabled, select.yc-menu:disabled { opacity: .5; cursor: not-allowed; }

/* The open dropdown list — the app's own Select menu (ui/Select.tsx): the popup surface
   (panel fill, card outline, the theme's large corner, the popup shadow), rows in the theme's
   middle corner, the current choice filled with the accent, the row under the pointer or the
   arrow keys on inset. PAGE_KIT_JS builds it; a page never writes this markup itself.
   WHY the shadow is the one literal colour: it is the app's popup shadow (globals.css
   .layer-surface), a darkening rather than a theme colour. */
.yc-menu[role="listbox"] {
  position: fixed; z-index: 2147483000;
  display: flex; flex-direction: column;
  min-width: 120px; max-width: calc(100vw - 16px);
  background: var(--panel);
  border: 1px solid var(--edge);
  border-radius: var(--radius-lg, 12px);
  box-shadow: 0 8px 32px rgba(0, 0, 0, .15);
  font-size: 13px; line-height: 1.35; color: var(--fg-2);
  overflow: hidden;
  user-select: none;
}
/* WHY the choices scroll in their own box: a foot action stays in sight however long the list. */
.yc-menu__list { position: relative; flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 4px; }
.yc-menu__item { display: block; padding: 6px 10px; border-radius: var(--radius-md, 8px); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.yc-menu__item[data-active] { background: var(--inset); }
.yc-menu__item[aria-selected="true"] { background: var(--accent); color: var(--on-accent); font-weight: 500; }
.yc-menu__item[aria-disabled="true"] { opacity: .5; cursor: not-allowed; }
.yc-menu__group { padding: 8px 10px 2px; font-size: 11px; font-weight: 500; color: var(--fg-muted); }
/* The foot action, behind the tapered line in the card-outline colour (the app's --edge-card,
   rebuilt here from the two tokens a page has). */
.yc-menu__foot { position: relative; flex: none; padding: 4px; }
.yc-menu__foot::before { content: ''; position: absolute; left: 12px; right: 12px; top: 0; height: 1px;
  background: linear-gradient(to right, transparent, color-mix(in srgb, var(--edge) 82%, var(--fg) 18%) 8%, color-mix(in srgb, var(--edge) 82%, var(--fg) 18%) 92%, transparent); }
/* A finger needs a taller row (the app's coarse-roomy); rows sit flush, so the row grows. */
@media (pointer: coarse) { .yc-menu__item { padding-top: 8px; padding-bottom: 8px; } }
.yc-textarea { min-height: 96px; resize: vertical; }
.yc-label { display: block; font-size: 12px; font-weight: 500; color: var(--fg-2); margin-bottom: 4px; }

.yc-chip {
  display: inline-flex; align-items: center; gap: 6px;
  font-size: 11px; font-weight: 500;
  padding: 2px 8px;
  border-radius: var(--radius-sm, 4px);
  background: var(--inset); border: 1px solid var(--edge-dim); color: var(--fg-2);
}
.yc-pill { border-radius: var(--radius-full, 9999px); padding: 4px 12px; font-size: 14px; }
.yc-pill--on { background: var(--accent); border-color: var(--accent); color: var(--on-accent); }

.yc-list { display: flex; flex-direction: column; gap: 4px; margin: 0; padding: 0; list-style: none; }
.yc-list-row {
  display: flex; align-items: center; gap: 10px;
  min-height: 40px; padding: 6px 10px;
  border-radius: var(--radius-md, 8px);
  border: 1px solid var(--edge-dim);
  background: var(--panel);
}
.yc-empty { padding: 32px 16px; text-align: center; color: var(--fg-muted); font-size: 14px; }

table.yc-table { width: 100%; border-collapse: collapse; font-size: 13px; }
/* WHY: dropped uppercase + letter-spacing (labels batch, guide: no spaced
   capitals) — this is a table column header, so it keeps its 11px size. */
table.yc-table th { text-align: left; font-size: 11px; color: var(--fg-muted); font-weight: 500; padding: 8px; border-bottom: 1px solid var(--edge); }
table.yc-table td { padding: 8px; border-bottom: 1px solid var(--edge-dim); }

/* App-shaped pages: a toolbar across the top, a tool rail on the left, a
   sidebar on the right, the work in the middle. Added for the paint studio
   and planner samples (shell deck round 1: the first samples were "too
   basic"), so the creator skill has a layout vocabulary, not only controls. */
.yc-app { height: 100%; display: flex; flex-direction: column; }
.yc-app__body { flex: 1; display: flex; min-height: 0; }
.yc-app__main { flex: 1; min-width: 0; position: relative; overflow: auto; }
.yc-toolbar { display: flex; align-items: center; gap: 8px; padding: 8px 12px; background: var(--panel); border-bottom: 1px solid var(--edge); }
.yc-rail { display: flex; flex-direction: column; gap: 4px; padding: 8px; background: var(--panel); border-right: 1px solid var(--edge); }
.yc-sidebar { width: 232px; padding: 12px; background: var(--panel); border-left: 1px solid var(--edge); overflow: auto; display: flex; flex-direction: column; gap: 16px; }
.yc-tool { width: 36px; height: 36px; padding: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: var(--radius-md, 8px); border: 1px solid transparent; background: transparent; color: var(--fg-2); cursor: pointer; }
.yc-tool:hover { background: var(--inset); color: var(--fg); }
.yc-tool--on { background: var(--accent); color: var(--on-accent); border-color: var(--accent); }
.yc-tool svg { width: 18px; height: 18px; }
/* The slider: the app's own look (ui/Slider.tsx, Destin submit-ticket-5#ST5-5 and #ST6-Q1) —
   a round track, the accent fill to a round handle, its end wrapping the handle. CSS only, as a
   page is plain HTML: the thumb is a white circle ringed in the accent, and its shadow (offset
   left by half a thumb past the track) paints the fill up to the handle's centre; with the ring
   that makes one shape whose end is concentric with the handle. The track clips the shadow. */
.yc-range { -webkit-appearance: none; appearance: none; box-sizing: border-box; width: 100%; height: 20px; margin: 0; border-radius: 999px; background: var(--inset); border: 1px solid var(--edge-dim); overflow: hidden; cursor: pointer; }
.yc-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 50%; background: #fff; border: 3px solid var(--accent); box-shadow: calc(-100vw - 9px) 0 0 100vw var(--accent); }
.yc-range::-moz-range-thumb { width: 12px; height: 12px; border-radius: 50%; background: #fff; border: 3px solid var(--accent); }
.yc-range::-moz-range-progress { height: 100%; border-radius: 999px; background: var(--accent); }
.yc-range:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.yc-range:disabled { opacity: .5; cursor: not-allowed; }
.yc-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 8px; }
.yc-swatch { width: 24px; height: 24px; border-radius: 50%; border: 2px solid var(--edge); cursor: pointer; padding: 0; }
.yc-swatch--on { outline: 2px solid var(--fg); outline-offset: 2px; }
.yc-kbd { font-family: var(--font-mono); font-size: 11px; padding: 1px 6px; border-radius: var(--radius-sm, 4px); background: var(--inset); border: 1px solid var(--edge-dim); color: var(--fg-2); }
.yc-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--fg-2); }
.yc-badge::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: var(--badge, var(--accent)); }

@media (prefers-reduced-motion: reduce) { .yc-button, .yc-select, select.yc-menu { transition: none; } }
```
