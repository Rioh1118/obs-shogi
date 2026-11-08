// DTCG トークン → dist/css/tokens.css（Style Dictionary 5）
// 出力は3ブロック：
//   1) :root                      … base と、テーマに依存しない semantic（余白・角丸・文字・フォーカス）
//   2) :root, [data-theme]        … semantic の色（light）と component。
//                                   [data-theme] の要素ごとに宣言し直すので、部分的に dark を当てても
//                                   component 変数がその場の semantic を参照し直す
//   3) [data-theme="dark"]        … dark の semantic 色（後に置き、同じ特異性で勝つ）
import fs from 'node:fs';
import path from 'node:path';
import StyleDictionary from 'style-dictionary';
import { ROOT, config, TOKENS_DIR, listTokenFiles } from './lib/tokens.mjs';

export async function buildTokens({ tokensDir = TOKENS_DIR, outFile = path.join(ROOT, 'dist/css/tokens.css') } = {}) {
  const files = listTokenFiles(tokensDir);
  const themeFiles = files.filter((f) => f.includes(`${path.sep}themes${path.sep}`));
  const baseFiles = files.filter((f) => !themeFiles.includes(f));
  const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules/.cache-ds-'));

  const isColorSemantic = (t) => t.path[0] === 'color';
  const isComponent = (t) => t.filePath.includes(`${path.sep}component${path.sep}`);
  const platform = (destination, selector, filter) => ({
    transformGroup: 'css',
    prefix: config.cssPrefix,
    buildPath: tmp + path.sep,
    files: [{ destination, format: 'css/variables', filter, options: { selector, outputReferences: true, showFileHeader: false } }],
  });

  const sd = new StyleDictionary({
    source: baseFiles,
    log: { warnings: 'disabled', verbosity: 'silent' },
    platforms: {
      root: platform('1-root.css', ':root', (t) => !isColorSemantic(t) && !isComponent(t)),
      themed: platform('2-themed.css', ':root, [data-theme]', (t) => isColorSemantic(t) || isComponent(t)),
    },
  });
  await sd.buildAllPlatforms();

  const parts = [fs.readFileSync(path.join(tmp, '1-root.css'), 'utf8'), fs.readFileSync(path.join(tmp, '2-themed.css'), 'utf8')];

  for (const tf of themeFiles) {
    const name = path.basename(tf, '.tokens.json');
    const sdTheme = new StyleDictionary({
      include: baseFiles.filter((f) => !f.includes(`${path.sep}component${path.sep}`)),
      source: [tf],
      log: { warnings: 'disabled', verbosity: 'silent' },
      platforms: { theme: platform(`3-${name}.css`, `[data-theme="${name}"]`, (t) => t.isSource) },
    });
    await sdTheme.buildAllPlatforms();
    parts.push(fs.readFileSync(path.join(tmp, `3-${name}.css`), 'utf8'));
  }
  // SCSS（製品が読む）。製品は rgba(<トークン>, 透明度) のように**コンパイル時に値を使う**ので、
  // CSS 変数ではなく値そのものを出す。寸法は製品の決定（rem に統一、html の基準は 10px）に合わせ、
  // 文字・間隔・角丸だけを 10px 基準の rem にする。pill は文字の大きさに従わないので px のまま
  const scaleToRem = (t) => ['font', 'space', 'radius'].includes(t.path[0]) && t.path.at(-1) !== 'pill' && (t.$type ?? t.type) === 'dimension';
  StyleDictionary.registerTransform({
    name: 'lm/scale-px-to-rem',
    type: 'value',
    filter: scaleToRem,
    transform: (t) => {
      const v = t.$value ?? t.value;
      const px = typeof v === 'object' ? v.value : parseFloat(v);
      return `${px / 10}rem`;
    },
  });
  StyleDictionary.registerTransform({
    name: 'lm/dimension',
    type: 'value',
    filter: (t) => (t.$type ?? t.type) === 'dimension' && typeof (t.$value ?? t.value) === 'object',
    transform: (t) => {
      const v = t.$value ?? t.value;
      return `${v.value}${v.unit}`;
    },
  });
  const sdScss = new StyleDictionary({
    source: baseFiles.filter((f) => !f.includes(`${path.sep}component${path.sep}`)),
    log: { warnings: 'disabled', verbosity: 'silent' },
    platforms: {
      scss: {
        transforms: ['name/kebab', 'lm/scale-px-to-rem', 'lm/dimension', 'time/seconds', 'color/css', 'fontFamily/css', 'cubicBezier/css', 'shadow/css/shorthand'],
        prefix: config.cssPrefix,
        buildPath: tmp + path.sep,
        files: [{ destination: '_tokens.scss', format: 'scss/variables', options: { outputReferences: false, showFileHeader: false } }],
      },
    },
  });
  await sdScss.buildAllPlatforms();
  const scss = fs.readFileSync(path.join(tmp, '_tokens.scss'), 'utf8');
  fs.rmSync(tmp, { recursive: true, force: true });
  const scssOut = path.join(path.dirname(path.dirname(outFile)), 'scss/_tokens.scss');
  fs.mkdirSync(path.dirname(scssOut), { recursive: true });
  fs.writeFileSync(scssOut, `// ${config.brandName} design tokens — 生成物。手で編集しない（npm run ds:build）。\n// 正本: design_system/tokens/*.tokens.json。値そのもの（CSS 変数ではない）。寸法は 10px 基準の rem\n` + scss.trim() + '\n');

  const header = `/**\n * ${config.brandName} design tokens — 生成物。手で編集しない（npm run ds:build）。\n * 正本: design_system/tokens/*.tokens.json（DTCG 2025.10）\n * 「仮」と書かれた値は暫定。\n */\n`;
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, header + parts.map((s) => s.trim()).join('\n\n') + '\n');
  return outFile;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = await buildTokens();
  console.log(`wrote ${path.relative(ROOT, out)}`);
}
