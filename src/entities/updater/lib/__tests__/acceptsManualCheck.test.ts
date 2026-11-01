import { describe, expect, it } from "vitest";

import type { UpdaterStatus } from "@/entities/updater/model/types";
import { acceptsManualCheck } from "../acceptsManualCheck";

describe("acceptsManualCheck", () => {
  it.each<[UpdaterStatus, boolean]>([
    [{ phase: "idle" }, true],
    [{ phase: "checking" }, false],
    [{ phase: "available", version: "2.0.0" }, true],
    [{ phase: "downloading", progress: 10 }, false],
    [{ phase: "installing" }, false],
    [{ phase: "ready" }, false],
    [{ phase: "error", failure: { stage: "download", detail: "x" } }, true],
  ])("%o は %s", (status, accepted) => {
    expect(acceptsManualCheck(status)).toBe(accepted);
  });
});
