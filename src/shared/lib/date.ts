/** ISO 8601 の日時を、端末の時刻帯で `2025-03-21` の形にする */
export function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  } catch {
    return "";
  }
}

/** ISO 8601 の日時を、端末の時刻帯で `3/21` の形にする */
export function formatShortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  } catch {
    return "";
  }
}
