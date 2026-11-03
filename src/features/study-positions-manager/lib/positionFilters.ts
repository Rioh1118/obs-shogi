import type { StudyPosition } from "@/entities/study-positions/model/types";

/**
 * 課題局面の一覧の絞り込みと並べ替え。どの順で通すかは `StudyPositionsManagerModal` が決める。
 */

export type SortKey = "updatedAt_desc" | "updatedAt_asc" | "createdAt_desc" | "label_asc";

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: "updatedAt_desc", label: "更新日↓" },
  { value: "updatedAt_asc", label: "更新日↑" },
  { value: "createdAt_desc", label: "作成日↓" },
  { value: "label_asc", label: "ラベル順" },
];

export function matchesQuery(p: StudyPosition, q: string): boolean {
  const lower = q.toLowerCase();
  return (
    p.label.toLowerCase().includes(lower) ||
    p.description.toLowerCase().includes(lower) ||
    p.tags.some((t) => t.toLowerCase().includes(lower))
  );
}

export function sortPositions(list: StudyPosition[], key: SortKey): StudyPosition[] {
  const sorted = [...list];
  switch (key) {
    case "updatedAt_desc":
      return sorted.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case "updatedAt_asc":
      return sorted.sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
    case "createdAt_desc":
      return sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case "label_asc":
      return sorted.sort((a, b) => a.label.localeCompare(b.label, "ja"));
  }
}

export function computeTagCounts(positions: StudyPosition[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const p of positions) {
    for (const t of p.tags) {
      map.set(t, (map.get(t) ?? 0) + 1);
    }
  }
  return map;
}

export function topTags(tagCounts: Map<string, number>, limit: number): string[] {
  return [...tagCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}
