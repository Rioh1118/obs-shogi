// design_system/DESIGN.md を生成する（Google Labs DESIGN.md 仕様 alpha の節の順序に従う）。
// 値の正本はトークン JSON。DESIGN.md は「意図と全体像」を他のツールやエージェントへ持ち出すための写し。
// DESIGN.md の仕様にはテーマの概念がないため、dark は dark- 接頭辞の色名と本文で表す。
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { ROOT, config, themeSets, resolve, resolvedType, toCssValue, isAlias } from './lib/tokens.mjs';

const OUT = path.join(ROOT, 'design_system/DESIGN.md');

function section(md, heading) {
  // principles.md などから「## heading」節の本文を取り出す（HTML コメントは除く）
  const m = md.match(new RegExp(`^## ${heading}\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm'));
  const body = m ? m[1].replace(/<!--[\s\S]*?-->/g, '').trim() : '';
  return body;
}

export function genDesignMd() {
  const { sets } = themeSets();
  const light = sets.light.tokens;
  const val = (tokens, p) => toCssValue(resolve(tokens, p), resolvedType(tokens, p));
  const dashed = (p) => p.replace(/^color\./, '').replaceAll('.', '-');

  const colors = {};
  const colorRows = [];
  for (const [p, t] of light) {
    if (!p.startsWith('color.')) continue;
    colors[dashed(p)] = val(light, p);
    colorRows.push(`| \`${dashed(p)}\` | ${t.description ?? ''} |`);
  }
  colors.primary = '{colors.background-emphasis}';
  for (const [name, set] of Object.entries(sets)) {
    if (name === 'light') continue;
    for (const [p] of set.tokens) if (p.startsWith('color.')) colors[`${name}-${dashed(p)}`] = val(set.tokens, p);
  }
  colors['focus-ring-inner'] = val(light, 'focus.ring.color.inner');
  colors['focus-ring-outer'] = val(light, 'focus.ring.color.outer');

  const typo = (size, lh) => ({
    fontFamily: val(light, 'font.family.sans'),
    fontSize: val(light, `font.size.${size}`),
    fontWeight: Number(val(light, 'font.weight.regular')),
    lineHeight: Number(val(light, `font.lineHeight.${lh}`)),
  });
  const typography = {
    body: typo('body', 'body'),
    caption: typo('caption', 'body'),
    'heading-lg': { ...typo('lg', 'heading'), fontWeight: Number(val(light, 'font.weight.bold')) },
    'heading-xl': { ...typo('xl', 'heading'), fontWeight: Number(val(light, 'font.weight.bold')) },
  };
  const pick = (prefix) =>
    Object.fromEntries([...light].filter(([p]) => p.startsWith(prefix)).map(([p]) => [p.slice(prefix.length), val(light, p)]));

  const ref = (p) => {
    // component トークン → DESIGN.md の参照形式
    let t = light.get(p);
    while (t && isAlias(t.value)) {
      const target = t.value.slice(1, -1);
      if (target.startsWith('color.')) return `{colors.${dashed(target)}}`;
      if (target.startsWith('radius.')) return `{rounded.${target.slice(7)}}`;
      if (target.startsWith('space.')) return `{spacing.${target.slice(6)}}`;
      t = light.get(target);
    }
    return val(light, p);
  };
  const components = {
    'button-primary': {
      backgroundColor: ref('button.color.background.primary'),
      textColor: ref('button.color.text.primary'),
      rounded: ref('button.radius'),
      padding: `${val(light, 'button.space.block')} ${val(light, 'button.space.inline')}`,
      typography: '{typography.body}',
    },
    'button-secondary': {
      backgroundColor: ref('button.color.background.secondary'),
      textColor: ref('button.color.text.secondary'),
      rounded: ref('button.radius'),
      padding: `${val(light, 'button.space.block')} ${val(light, 'button.space.inline')}`,
      typography: '{typography.body}',
    },
  };

  const front = {
    version: 'alpha',
    name: config.brandName,
    description: `${config.brandName} design system — 構造のみ。値はすべて仮（brief 未記入）。`,
    colors,
    typography,
    rounded: pick('radius.'),
    spacing: pick('space.'),
    components,
  };

  const principles = fs.readFileSync(path.join(ROOT, 'design_system/principles.md'), 'utf8');
  const dos = section(principles, "Do's and Don'ts") || '- 未定。brief.md を書いたあと、モード B で決める。';
  const overview = section(principles, '原則') || '原則は未定（design_system/principles.md）。';

  const md = `---
${stringify(front, { lineWidth: 0 }).trim()}
---

<!-- 生成物。手で編集しない。正本は design_system/tokens/*.tokens.json と principles.md。npm run ds:build で再生成する。 -->

# ${config.brandName} Design System

## Overview

状態：v0.0.0。器だけを作った段階で、色・書体・密度などの値はすべて仮（グレーの階調と OS 標準書体）。性格と雰囲気は brief.md を書いたあと、SKILL.md のモード B で決める。

${overview}

## Colors

色は「何に使うか」の名前（意味付けトークン）だけを使う。\`primary\` は仮に \`background-emphasis\`（主要な操作の背景）を指している。主色は未定。dark テーマの値は \`dark-\` で始まる名前で示す。テーマは HTML の \`data-theme\` 属性で切り替える。

| 名前 | 役割 |
| --- | --- |
${colorRows.join('\n')}

フォーカスリング（\`focus-ring-inner\` / \`focus-ring-outer\`）は固定の値で、ブランド色とは独立している。変えない。

## Typography

本文は 16px 以上、行間は 1.5 以上（固定の規則）。補助の文字（caption）も 14px を下回らない。書体は未定で、OS の標準書体で代用している。

## Layout

余白は 4px を基数にした段階（spacing）だけを使う。段階にない値が必要になったら、作らずに質問する。

## Elevation & Depth

未定（影を使うか、境界線で面を分けるかはモード B で決める）。

## Shapes

角丸は rounded の段階（none / sm / full）だけを使う。

## Components

見本は Button（primary / secondary）だけ。部品を選ぶときは components/_index.md の選定索引を引く。

## Do's and Don'ts

${dos}
`;
  fs.writeFileSync(OUT, md);
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) genDesignMd();
