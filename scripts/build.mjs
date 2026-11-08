// npm run ds:build
//   1. トークン → dist/css/tokens.css（Style Dictionary）
//   2. 見本実装 → dist/react/（esbuild。利用先が JSX を変換しなくて済むように）
//   3. SKILL.md の frontmatter を lumen.config.json から書く
//   4. design_system/DESIGN.md を生成
//   5. preview/ を生成
import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';
import { ROOT } from './lib/tokens.mjs';
import { buildTokens } from './build-tokens.mjs';
import { syncSkillMeta } from './lib/skill-meta.mjs';
import { genDesignMd } from './gen-design-md.mjs';
import { buildPreview } from './build-preview.mjs';

const steps = [];
const step = async (name, fn) => {
  await fn();
  steps.push(name);
  console.log(`✔ ${name}`);
};

await step('tokens → dist/css/tokens.css', () => buildTokens());

await step('implementations/react → dist/react', async () => {
  const srcDir = path.join(ROOT, 'implementations/react');
  const outDir = path.join(ROOT, 'dist/react');
  fs.rmSync(outDir, { recursive: true, force: true });
  for (const comp of fs.readdirSync(srcDir, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const dir = path.join(srcDir, comp.name);
    const entries = fs.readdirSync(dir).filter((f) => /\.(jsx|js)$/.test(f)).map((f) => path.join(dir, f));
    await esbuild.build({
      entryPoints: entries,
      outdir: path.join(outDir, comp.name),
      bundle: false,
      format: 'esm',
      jsx: 'automatic',
      loader: { '.jsx': 'jsx' },
      outExtension: { '.js': '.js' },
      logLevel: 'silent',
    });
    // .jsx の import を .js に書き換え、CSS をコピーする
    for (const f of fs.readdirSync(path.join(outDir, comp.name))) {
      const p = path.join(outDir, comp.name, f);
      fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/(from\s+['"]\.\/[^'"]+)\.jsx(['"])/g, '$1.js$2'));
    }
    for (const css of fs.readdirSync(dir).filter((f) => f.endsWith('.css'))) {
      fs.copyFileSync(path.join(dir, css), path.join(outDir, comp.name, css));
    }
  }
});

await step('SKILL.md frontmatter ← lumen.config.json', () => syncSkillMeta({ write: true }));
await step('design_system/DESIGN.md', () => genDesignMd());
await step('preview/', () => buildPreview());
