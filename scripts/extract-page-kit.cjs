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
  '`--edge` `--edge-dim` `--link` `--link-hover` `--destructive` `--destructive-fg` `--on-destructive`',
  '`--radius` `--radius-sm` `--radius-md` `--radius-lg` `--radius-xl` `--radius-full` `--font-sans` `--font-mono`', '',
  'Use `var(--x)` for anything that should follow the theme. Never hard-code a colour for a control;',
  'hard-code colours only for content that must keep them (a drawing, a chart series, a photo).', '',
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
  '## Classes', '', '```', ...classes, '```', '', '## The stylesheet, verbatim', '', '```css', css.trim(), '```', ''];
const dest = path.join(__dirname, '..', 'wecoded-pages-plugin/skills/page-builder/reference/style-kit.md');
fs.writeFileSync(dest, out.join('\n'));
console.log(`${classes.length} classes → ${path.relative(process.cwd(), dest)}`);
