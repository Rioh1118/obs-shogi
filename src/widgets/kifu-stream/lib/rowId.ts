/**
 * 棋譜ストリームの行に振る id
 *
 * 行を振る側（`KifuMoveCard`）と、位置合わせのために引く側（`KifuStreamList`）が
 * この1つを共有する。両方に文字列を手書きすると、片方だけ変えても tsc も lint も
 * テストも落ちないまま、自動スクロールだけが静かに死ぬ。
 */
export const kifuRowId = (te: number) => `kifu-row-${te}`;
