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
  colors.primary = '{colors.commit-solid}';
  for (const [name, set] of Object.entries(sets)) {
    if (name === 'light') continue;
    for (const [p] of set.tokens) if (p.startsWith('color.')) colors[`${name}-${dashed(p)}`] = val(set.tokens, p);
  }
  colors['focus-ring'] = val(light, 'focus.ring.color');

  const typo = (size, lh) => ({
    fontFamily: val(light, 'font.family.sans'),
    fontSize: val(light, `font.size.${size}`),
    fontWeight: Number(val(light, 'font.weight.regular')),
    lineHeight: Number(val(light, `font.lineHeight.${lh}`)),
  });
  const typography = {
    body: typo('body', 'body'),
    hint: typo('hint', 'body'),
    aux: typo('aux', 'body'),
    section: { ...typo('section', 'body'), fontWeight: Number(val(light, 'font.weight.strong')) },
    title: { ...typo('title', 'body'), fontWeight: Number(val(light, 'font.weight.title')) },
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
      typography: '{typography.aux}',
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
    description: `${config.brandName} design system — 値は製品の今の画面から写した基準線（v0.1）。`,
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

状態：洗練の方向 C4（decisions/0004）。深く冷たい緑黒の枠、冷たい砂の文字、銅のアクセント。開発者の道具（計器）の精度で、タイトル戦の本物の盤と駒台を囲む。盤・駒台・駒は実物の画像で、トークンの対象外。

${overview}

## Colors

色は「何に使うか」の名前（意味付けトークン）だけを使う。\`primary\` は確定のボタンの砂色（\`commit-solid\`）を指す。テーマは暗い1つだけ。

| 名前 | 役割 |
| --- | --- |
${colorRows.join('\n')}

フォーカスリング（\`focus-ring\`）は固定の値（銅の1本、2px）。変えない（decisions/0003）。

## Typography

文字は用途で選ぶ（hint / aux / body / lead / section / title / display / hero）。本文は 13px 以上、全体は 11px 以上（固定の規則、decisions/0003）。太さは4段階。書体は端末の和文書体。数は等幅にする。

## Layout

余白は 2px 刻みの段階（spacing 1〜12）だけを使う。同じ N の角丸と同じ値。段階にない値が必要になったら、作らずに質問する。

## Elevation & Depth

ペイン（サイドバー・棋譜・ヘッダ・ドック）は \`background-default\` の1色にし、境目は線で引く。色で塗り分けない。盤と駒台の周りだけ \`background-stage\` で半段沈める。\`background-canvas\` は選ばれた行の濃淡、\`background-sunken\` は暗いカードと入力の沈みにだけ使う。サーフェスは影で浮かせない（panel・control の影は無し）。影はポップオーバーとメニュー（overlay）だけ。

## Shapes

角丸は役割で選ぶ（row / control / surface / modal / pill）。外のサーフェスほど大きく、内側は1段階以上小さい。

## Components

見本は Button（primary / secondary）だけ。部品を選ぶときは components/_index.md の選定索引を引く。

## Do's and Don'ts

${dos}
`;
  fs.writeFileSync(OUT, md);
  return OUT;
}

if (import.meta.url === `file://${process.argv[1]}`) genDesignMd();
