// 案の画面を1ファイルに組む。画像・書体・データを全部埋め込むので、開くだけで動く。
//   node build.mjs <出力先.html>
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DATA, loadIcons } from './build-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../../..');
const at = (...p) => path.join(repo, ...p);

const uri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const text = (name) => readFileSync(path.join(here, name), 'utf8');

const pieceDir = at('src/assets/pieces');
const pieces = Object.fromEntries(
  readdirSync(pieceDir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => [f.replace('.png', ''), uri(path.join(pieceDir, f), 'image/png')]),
);

const fontFace = (family, file) =>
  `@font-face{font-family:'${family}';src:url(${uri(file, 'font/woff2')}) format('woff2');font-weight:700}`;

const css = [
  fontFace('Orbitron', at('node_modules/@fontsource/orbitron/files/orbitron-latin-700-normal.woff2')),
  fontFace(
    'Zen Kaku Gothic Antique',
    at('node_modules/@fontsource/zen-kaku-gothic-antique/files/zen-kaku-gothic-antique-latin-700-normal.woff2'),
  ),
  text('proto/base.css'),
  text('proto/cases.css'),
  text('proto/round2.css'),
]
  .join('\n')
  .replaceAll('__KOMA_FONT__', uri(path.join(here, 'assets/koma.woff2'), 'font/woff2'))
  .replaceAll('__BOARD__', uri(at('src/assets/board.png'), 'image/png'))
  .replaceAll('__HAND__', uri(at('src/assets/hand.png'), 'image/png'))
  .replaceAll('__STRIP__', uri(path.join(here, 'assets/hand-strip.jpg'), 'image/jpeg'));

const assets = {
  icon: `data:image/svg+xml;base64,${readFileSync(at('public/icon.svg')).toString('base64')}`,
  pieces,
};

export async function buildFrame() {
  const icons = await loadIcons();
  const payload = JSON.stringify({ DATA, ICONS: icons, ASSETS: assets }).replaceAll('</', '<\\/');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>案の画面</title>
<style>${css}</style></head>
<body><div id="proto"></div>
<script>window.__PROTO__=${payload}</script>
<script>${text('proto/app.js')}</script></body></html>`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const html = await buildFrame();
  writeFileSync(path.resolve(process.argv[2]), html);
  console.log(`${process.argv[2]} ${(html.length / 1e6).toFixed(2)} MB`);
}
