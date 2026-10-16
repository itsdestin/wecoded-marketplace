#!/usr/bin/env node
// Regenerates wecoded-pages-plugin/skills/page-builder/reference/style-kit.md from the
// app's page-kit.ts so the skill's vocabulary and the host's stylesheet cannot drift.
// Usage: node scripts/extract-page-kit.cjs <path-to-youcoded-checkout>
const fs = require('fs'); const path = require('path');
const app = process.argv[2]; if (!app) { console.error('usage: extract-page-kit.cjs <youcoded checkout>'); process.exit(2); }
const src = fs.readFileSync(path.join(app, 'desktop/src/renderer/components/pages/page-kit.ts'), 'utf8');
const css = /PAGE_KIT_CSS = `([\s\S]*?)`;/.exec(src)[1];
const classes = [...new Set([...css.matchAll(/\.(yc-[a-z0-9_-]+)/g)].map((m) => m[1]))].sort();
const out = ['# The page style kit — what a page may use', '',
  "Generated from the app's `desktop/src/renderer/components/pages/page-kit.ts` (the host injects",
  'this stylesheet into every page, so a page never ships its own copy). Regenerate with',
  '`node scripts/extract-page-kit.cjs` from the marketplace repo when the app\'s kit changes.', '',
  '## Theme values a page may read (CSS custom properties, delivered live)', '',
  '`--canvas` `--panel` `--inset` `--well` `--accent` `--on-accent` `--fg` `--fg-2` `--fg-dim` `--fg-muted` `--fg-faint`',
  '`--edge` `--edge-dim` `--link` `--link-hover` `--destructive` `--destructive-fg` `--on-destructive` `--warning-fg`',
  '`--radius` `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-full` `--font-sans` `--font-mono`', '',
  'Use `var(--x)` for anything that should follow the theme. Never hard-code a colour for a control;',
  'hard-code colours only for content that must keep them (a drawing, a chart series, a photo).',
  'The kit also derives `--yc-edge-card` (card outline), `--yc-edge-strong` (button outline),',
  '`--yc-radius-control` (a button\'s corner) and `--yc-shadow-card` from these.', '',
  // WHY first (Destin, pages-kit-questions 2026-10-16): the kit is guidance, never a cage.
  '**The kit is a starting point.** Destin: "users should still be able to fully customize page ui and',
  'disregard our design principles if they so choose. the kit is just a starting point for good',
  'first-shot attempts, but should be ignored if the user provides contradictory guidance." Use it by',
  'default; when the person asks for a different look, do what they ask with your own styles.', '',
  // WHY a fixed section: the dropdown is the kit's SCRIPT (PAGE_KIT_JS), not a class, so the class
  // list alone never told a page author that a plain <select> is the way to get the app's menu.
  '## Dropdowns', '',
  'Write a plain `<select class="yc-select">` with its `<option>`s. The app opens every single-choice',
  '`<select>` in its own menu look (the kit\'s `.yc-menu` list), never the browser\'s white list, and the',
  '`<select>` stays the real control: read and set `.value`, listen for `change`, as usual. Never build',
  'a hand-made dropdown, and never style `.yc-menu` yourself.', '',
  'An action at the foot of the list ("Add another option…") is `<option value="__add" data-yc-action>`:',
  'it is drawn below the choices behind a divider. Choosing it fires `change` with its value like any',
  'option, so your handler does the action and sets the select back to the previous value.', '',
  // WHY these fixed sections (pages-kit-questions, 2026-10-16): the app's own building blocks Destin
  // picked are partly the kit's SCRIPT (the switch, the automatic scroll fade) and partly markup
  // shapes (a notice with its Details fold, a fold row, phone-folding sections) that a class list
  // alone never explains. Each names the app primitive it copies.
  '## The app\'s building blocks, and how to write each', '',
  'These are the app\'s own pieces (its status pill, notice box, loading line, full-screen error, switch,',
  'search box and filter chips, fold-out row, inner box, chip row and scroll fade) redrawn for pages. Reach',
  'for them before inventing a look:', '',
  '- **Status label:** `<span class="yc-status yc-status--ok">Installed</span>` (tones `--info` `--ok`',
  '  `--warning` `--danger`, none = grey). A live status adds its dot: `yc-status--dot` ("Online").',
  '  The colour is only in the tint; never colour the words.',
  '- **Notice box:** `<div class="yc-notice yc-notice--warning">` (none = info, `--danger` for errors,',
  '  `--slim` for one line) holding `<div class="yc-notice__text">One plain sentence.</div>` and',
  '  `<div class="yc-notice__actions">` with `.yc-button--sm` buttons (outlined first, the one filled last).',
  '  A bold lead line is `<span class="yc-notice__title">`. Machine words (a raw error) go only in a',
  '  Details fold inside the box: `<details class="yc-fold yc-notice__details"><summary>Details</summary>',
  '  <code>…</code></details>` — the buttons then sit on their own line below it, at the right.',
  '- **Loading:** `<div class="yc-loading">Loading your recipes…</div>` (`yc-loading--inline` inside a',
  '  section). The spinner is drawn for you.',
  '- **A whole page that could not load:** `<div class="yc-screen-error" role="alert">` with the same',
  '  `yc-notice__text` (a `yc-notice__title` saying what could not load, one sentence),',
  '  `yc-notice__details` and `yc-notice__actions` (a `.yc-button--primary` "Try again"); its buttons go',
  '  full width.',
  '- **On/off switch:** `<button class="yc-switch" role="switch" aria-checked="false" aria-label="…">',
  '  </button>`. The app flips it on a click, Space or Enter and fires `change`; read',
  '  `el.getAttribute(\'aria-checked\') === \'true\'`. Put it at the right of its setting\'s title and hint.',
  '- **Search with filter chips:** `<label class="yc-search"><input type="search" placeholder="Search…"',
  '  aria-label="Search"></label>` beside `<div class="yc-chips">` of `<button class="yc-filter"',
  '  aria-pressed="false">` chips (your code sets `aria-pressed="true"` on the lit ones). They are one height.',
  '- **Fold-out row:** `<details class="yc-fold"><summary>Advanced options <span class="yc-fold__hint">',
  '  Rarely needed</span></summary>…</details>`. It opens inside its own box. Never a bare arrow and text.',
  '- **Long sections on a phone:** write each big section as `<details class="yc-section">` starting with',
  '  `<summary>Section name</summary>`, and put `open` on the first. Wider than a phone they show as plain',
  '  headings with everything visible; on a phone they fold, the first one open.',
  '- **Cards and boxes:** `.yc-card` is a raised card; a box inside it is `.yc-box`. A line between parts',
  '  is `<hr class="yc-divider">` (tapered, never full width).',
  '- **A row of short facts:** `<div class="yc-chips">` of `<span class="yc-chip">` — one line that',
  '  scrolls sideways, never wraps.',
  '- **Buttons:** one `.yc-button--primary` per screen; everything beside it `.yc-button--ghost`',
  '  (outlined).',
  '- **Scrolling:** any box you make scroll (`overflow: auto`) fades at the edges that hide more, and so',
  '  does the page itself — you write nothing. To turn it off for one box, add `yc-no-fade` to it.', '',
  '## Classes', '', '```', ...classes, '```', '', '## The stylesheet, verbatim', '', '```css', css.trim(), '```', ''];
const dest = path.join(__dirname, '..', 'wecoded-pages-plugin/skills/page-builder/reference/style-kit.md');
fs.writeFileSync(dest, out.join('\n'));
console.log(`${classes.length} classes → ${path.relative(process.cwd(), dest)}`);
