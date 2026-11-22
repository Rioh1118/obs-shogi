// 物差し（measure.mjs）が返す種類の分け方

/** 文字が読めない・押せない崩れ */
export const BREAKS = ['outside', 'cut', 'squeezed', 'noReveal', 'overlap', 'touch', 'lost', 'offscreen', 'covered'];

/** 形の決まりに反するもの（入れ子の箱、背景のグラデーション、角丸の箱の片側の棒） */
export const SHAPES = ['nested', 'gradient', 'sideBar'];

/** 固定値（design_system/tokens/locked.json）に反するもの */
export const LOCKED = ['contrast', 'tiny'];

export const ALL = [...BREAKS, ...SHAPES, ...LOCKED];

export const countOf = (result, kind) =>
  result.findings.filter((f) => f.kind === kind).reduce((n, f) => n + f.count, 0);
