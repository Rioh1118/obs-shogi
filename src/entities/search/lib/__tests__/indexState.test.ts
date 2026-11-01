import { describe, expect, it } from "vitest";

import { isIndexBusy } from "../indexState";

describe("isIndexBusy", () => {
  /** 動いている段を動いていないと読むと、組み直している最中の0件が確定の0件として出る */
  it.each(["Restoring", "Building", "Updating"] as const)("%s は動いている", (state) => {
    expect(isIndexBusy(state)).toBe(true);
  });

  it.each(["Empty", "Ready"] as const)("%s は動いていない", (state) => {
    expect(isIndexBusy(state)).toBe(false);
  });
});
