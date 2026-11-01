export async function copyText(text: string): Promise<void> {
  const t = (text ?? "").trim();
  if (!t) return;

  try {
    await navigator.clipboard.writeText(t);
    return;
  } catch {
    // 権限で拒まれる環境の退路。非推奨だが、選択を写す手段は他に無い
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}
