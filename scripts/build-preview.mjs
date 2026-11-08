// preview/ を生成する（静的 HTML。JS なし）。
//   index.html    … トークン一覧（テーマごとの色、コントラスト、余白・角丸・文字の段階）
//   button.html   … Button の見本（light / dark を並べる）
//   examples.html … examples/good の描画
// React の見本は react-dom/server で静的に描画する。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { ROOT, config, themeSets, resolve, resolvedType, toCssValue } from './lib/tokens.mjs';
import { contrastResults } from './lib/contrast.mjs';

const OUT = path.join(ROOT, 'preview');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cssVar = (p) => `--${config.cssPrefix}-${p.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase().replaceAll('.', '-')}`;

async function renderReact() {
  const entry = path.join(ROOT, 'node_modules/.cache-ds-preview/entry.jsx');
  const out = path.join(ROOT, 'node_modules/.cache-ds-preview/entry.mjs');
  fs.mkdirSync(path.dirname(entry), { recursive: true });
  fs.writeFileSync(
    entry,
    `import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '${path.join(ROOT, 'implementations/react/Button/index.js')}';
import { ButtonUsage } from '${path.join(ROOT, 'examples/good/button-usage.jsx')}';
export const button = renderToStaticMarkup(<div className="pv-row">
  <Button variant="primary">主要な操作</Button>
  <Button variant="secondary">その他の操作</Button>
  <Button variant="primary" disabled>無効</Button>
</div>);
export const usage = renderToStaticMarkup(<ButtonUsage />);
`,
  );
  await esbuild.build({
    entryPoints: [entry],
    outfile: out,
    bundle: true,
    format: 'esm',
    platform: 'node',
    jsx: 'automatic',
    packages: 'external',
    loader: { '.css': 'empty' },
    logLevel: 'silent',
  });
  const mod = await import(pathToFileURL(out).href + `?t=${Date.now()}`);
  return { button: mod.button, usage: mod.usage };
}

const PAGE_CSS = `
body { margin: 0; font-family: var(--${config.cssPrefix}-font-family-sans); font-size: var(--${config.cssPrefix}-font-size-body); line-height: var(--${config.cssPrefix}-font-line-height-body); background: var(--${config.cssPrefix}-color-background-default); color: var(--${config.cssPrefix}-color-text-default); }
main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
h1 { font-size: var(--${config.cssPrefix}-font-size-display); }
h2 { font-size: var(--${config.cssPrefix}-font-size-title); margin-top: 32px; }
a { color: inherit; }
.pv-note { color: var(--${config.cssPrefix}-color-text-subtle); }
.pv-themes { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 16px; }
.pv-theme { padding: 16px; border: 1px solid var(--${config.cssPrefix}-color-border-default); background: var(--${config.cssPrefix}-color-background-default); color: var(--${config.cssPrefix}-color-text-default); }
.pv-row { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
table { border-collapse: collapse; width: 100%; font-size: var(--${config.cssPrefix}-font-size-aux); }
th, td { text-align: left; padding: 4px 8px; border-bottom: 1px solid var(--${config.cssPrefix}-color-border-default); vertical-align: middle; }
.pv-swatch { display: inline-block; width: 32px; height: 20px; border: 1px solid var(--${config.cssPrefix}-color-border-default); vertical-align: middle; }
.pv-bar { display: inline-block; height: 12px; background: var(--${config.cssPrefix}-color-text-subtle); vertical-align: middle; }
code { font-size: var(--${config.cssPrefix}-font-size-aux); }
`;

function page(title, body, extraCss = []) {
  const links = ['assets/tokens.css', ...extraCss].map((h) => `<link rel="stylesheet" href="${h}">`).join('\n');
  return `<!doctype html>
<html lang="ja" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — ${esc(config.brandName)} preview</title>
${links}
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<p class="pv-note">生成物（npm run ds:build）。値はすべて仮。 <a href="index.html">トークン</a> · <a href="button.html">Button</a> · <a href="examples.html">良い例</a></p>
${body}
</main>
</body>
</html>
`;
}

function themed(inner) {
  return `<div class="pv-themes">
<section class="pv-theme" data-theme="light" aria-label="light テーマ"><h2>light</h2>${inner}</section>
<section class="pv-theme" data-theme="dark" aria-label="dark テーマ"><h2>dark</h2>${inner}</section>
</div>`;
}

export async function buildPreview() {
  const { sets } = themeSets();
  const light = sets.light.tokens;
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'assets'), { recursive: true });
  fs.copyFileSync(path.join(ROOT, 'dist/css/tokens.css'), path.join(OUT, 'assets/tokens.css'));
  fs.copyFileSync(path.join(ROOT, 'implementations/react/Button/Button.css'), path.join(OUT, 'assets/Button.css'));
  fs.copyFileSync(path.join(ROOT, 'examples/good/button-usage.css'), path.join(OUT, 'assets/button-usage.css'));

  // --- index.html
  const themeNames = Object.keys(sets);
  const colorPaths = [...light.keys()].filter((p) => p.startsWith('color.') || p.startsWith('focus.ring.color'));
  const colorRows = colorPaths
    .map((p) => {
      const cells = themeNames
        .map((th) => {
          const v = toCssValue(resolve(sets[th].tokens, p), 'color');
          return `<td><span class="pv-swatch" data-theme="${th}" style="background: var(${cssVar(p)})"></span> <code>${v}</code></td>`;
        })
        .join('');
      return `<tr><td><code>${p}</code><br><code>${cssVar(p)}</code></td>${cells}<td>${esc(light.get(p).description ?? '')}</td></tr>`;
    })
    .join('\n');
  const scale = (prefix, bar) =>
    [...light.keys()]
      .filter((p) => p.startsWith(prefix))
      .map((p) => {
        const v = toCssValue(resolve(light, p), resolvedType(light, p));
        const demo = bar === 'width' ? `<span class="pv-bar" style="width: var(${cssVar(p)})"></span>` : bar === 'radius' ? `<span class="pv-swatch" style="border-radius: var(${cssVar(p)})"></span>` : `<span style="font-size: var(${cssVar(p)})">あいうえお Aa</span>`;
        return `<tr><td><code>${p}</code></td><td><code>${v}</code></td><td>${demo}</td><td>${esc(light.get(p).description ?? '')}</td></tr>`;
      })
      .join('\n');
  const contrast = contrastResults(Object.fromEntries(themeNames.map((t) => [t, sets[t]])))
    .map((r) => `<tr><td>${r.theme}</td><td><code>${esc(r.fg)}</code></td><td><code>${r.bg}</code></td><td>${r.kind}</td><td>${r.ratio.toFixed(2)} : 1</td><td>${r.min} : 1</td><td>${r.pass ? '合格' : '<strong>不合格</strong>'}</td></tr>`)
    .join('\n');

  fs.writeFileSync(
    path.join(OUT, 'index.html'),
    page(
      'トークン',
      `<h1>${esc(config.brandName)} トークン一覧</h1>
<p>正本は design_system/tokens/*.tokens.json。CSS 変数は dist/css/tokens.css。</p>
<h2>色（テーマ別）</h2>
<table><thead><tr><th>トークン</th>${themeNames.map((t) => `<th>${t}</th>`).join('')}<th>説明</th></tr></thead><tbody>${colorRows}</tbody></table>
<h2>コントラスト（contrast-pairs.json）</h2>
<table><thead><tr><th>テーマ</th><th>前景</th><th>背景</th><th>種別</th><th>比</th><th>基準</th><th>結果</th></tr></thead><tbody>${contrast}</tbody></table>
<h2>余白</h2><table><tbody>${scale('space.', 'width')}</tbody></table>
<h2>角丸</h2><table><tbody>${scale('radius.', 'radius')}</tbody></table>
<h2>文字サイズ</h2><table><tbody>${scale('font.size.', 'text')}</tbody></table>`,
    ),
  );

  const { button, usage } = await renderReact();
  fs.writeFileSync(
    path.join(OUT, 'button.html'),
    page('Button', `<h1>Button</h1><p>文書：design_system/components/button.md</p>${themed(button)}`, ['assets/Button.css']),
  );
  fs.writeFileSync(
    path.join(OUT, 'examples.html'),
    page('良い例', `<h1>良い例（examples/good）</h1>${themed(usage)}`, ['assets/Button.css', 'assets/button-usage.css']),
  );
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) await buildPreview();
