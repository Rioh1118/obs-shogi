/**
 * そのパスの行までスクロールする。
 * 呼び手はフォルダの展開を dispatch した直後に呼ぶので、行が描かれるのを2フレーム待つ。
 */
export function scrollNodeIntoView(path: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const escaped =
        window.CSS?.escape?.(path) ?? path.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

      const el = document.querySelector<HTMLElement>(`[data-node-path="${escaped}"]`);

      el?.scrollIntoView({ block: "nearest" });
    });
  });
}
