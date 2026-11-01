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
