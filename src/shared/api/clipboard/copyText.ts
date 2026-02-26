export async function copyText(text: string): Promise<void> {
  const t = (text ?? "").trim();
  if (!t) return;

  try {
    await navigator.clipboard.writeText(t);
    return;
  } catch {
    // fallback
    const ta = document.createElement("textarea");
    ta.value = t;
    ta.setAttribute("readonly", "true");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.body.removeChild(ta);
  }
}
