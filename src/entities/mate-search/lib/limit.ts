/** 詰み探索の上限時間。`ms` が `null` は無制限 */
export const MATE_SEARCH_LIMITS = [
  { key: "10", label: "10秒", ms: 10_000 },
  { key: "30", label: "30秒", ms: 30_000 },
  { key: "60", label: "60秒", ms: 60_000 },
  { key: "infinite", label: "無制限", ms: null },
] as const;

export type MateSearchLimit = (typeof MATE_SEARCH_LIMITS)[number];

const DEFAULT_LIMIT: MateSearchLimit = MATE_SEARCH_LIMITS[1];

/** 設定の綴りから上限時間を引く。欠けている・知らない綴りは 30 秒 */
export function resolveMateSearchLimit(key: string | null | undefined): MateSearchLimit {
  return MATE_SEARCH_LIMITS.find((limit) => limit.key === key) ?? DEFAULT_LIMIT;
}
