import type { RelPathCache } from "./types";

export function createRelPathCache(): RelPathCache {
  return new Map<string, string>();
}
