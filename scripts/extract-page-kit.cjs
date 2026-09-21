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
  '## Classes', '', '```', ...classes, '```', '', '## The stylesheet, verbatim', '', '```css', css.trim(), '```', ''];
const dest = path.join(__dirname, '..', 'wecoded-pages-plugin/skills/page-builder/reference/style-kit.md');
fs.writeFileSync(dest, out.join('\n'));
console.log(`${classes.length} classes → ${path.relative(process.cwd(), dest)}`);
