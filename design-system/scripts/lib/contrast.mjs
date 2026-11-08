// contrast-pairs.json の全ペアを、全テーマについて WCAG 2.x の式で計算する。
// 比率は丸めずに判定する（4.499 は不合格）。
import fs from 'node:fs';
import path from 'node:path';
import Color from 'colorjs.io';
import { TOKENS_DIR, resolve } from './tokens.mjs';

export function loadPairs(dir = TOKENS_DIR) {
  const p = path.join(dir, 'contrast-pairs.json');
  const fallback = path.join(TOKENS_DIR, 'contrast-pairs.json');
  return JSON.parse(fs.readFileSync(fs.existsSync(p) ? p : fallback, 'utf8')).pairs;
}

export function loadThresholds() {
  const locked = JSON.parse(fs.readFileSync(path.join(TOKENS_DIR, 'locked.json'), 'utf8'));
  const r = (id) => locked.rules.find((x) => x.id === id).ratio;
  return { text: r('contrast-text'), 'non-text': r('contrast-non-text') };
}

function toColor(v) {
  if (v.hex) return new Color(v.hex);
  return new Color(v.colorSpace === 'srgb' ? 'srgb' : v.colorSpace, v.components, v.alpha ?? 1);
}

/** @returns {{theme, fg, bg, kind, min, ratio, pass, missing?}[]} */
export function contrastResults(sets, pairs = loadPairs(), thresholds = loadThresholds()) {
  const out = [];
  for (const [theme, { tokens }] of Object.entries(sets)) {
    for (const pair of pairs) {
      const min = thresholds[pair.kind];
      for (const bg of pair.bg) {
        const rows = pair.fg.map((fg) => {
          try {
            const bgc = toColor(resolve(tokens, bg));
            let fgc = toColor(resolve(tokens, fg));
            if (fgc.alpha < 1) fgc = Color.mix(bgc, fgc.clone().set('alpha', 1), fgc.alpha, { space: 'srgb' });
            const ratio = Color.contrast(fgc, bgc, 'WCAG21');
            return { theme, fg, bg, kind: pair.kind, min, ratio, pass: ratio >= min };
          } catch (e) {
            return { theme, fg, bg, kind: pair.kind, min, ratio: NaN, pass: false, missing: e.message };
          }
        });
        if (pair.anyOf) {
          const best = rows.reduce((a, b) => (b.ratio > a.ratio ? b : a));
          out.push({ ...best, fg: pair.fg.join(' | '), pass: rows.some((r) => r.pass) });
        } else out.push(...rows);
      }
    }
  }
  return out;
}
