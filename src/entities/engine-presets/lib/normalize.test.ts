import { describe, test, expect } from "vitest";
import { normalizeOnePreset } from "./normalize";
import type { EnginePreset } from "../model/types";

function makeRaw(analysis: Record<string, unknown> | undefined): Partial<EnginePreset> {
  return {
    id: "test-id",
    label: "x",
    aiName: "x",
    enginePath: "/x",
    evalFilePath: "/x",
    bookEnabled: false,
    bookFilePath: null,
    options: {},
    analysis: analysis as never,
  };
}

describe("normalizeOnePreset analysis migration", () => {
  test("infers mate from legacy mateSearch=true when mode missing", () => {
    const raw = makeRaw({ mateSearch: true });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("mate");
  });

  test("infers time from legacy timeSeconds when mode missing", () => {
    const raw = makeRaw({ timeSeconds: 15 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("time");
    expect(p.analysis?.timeSeconds).toBe(15);
  });

  test("infers depth from legacy depth when mode missing and no time", () => {
    const raw = makeRaw({ depth: 22 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("depth");
  });

  test("infers nodes from legacy nodes when only nodes present", () => {
    const raw = makeRaw({ nodes: 100_000 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("nodes");
  });

  test("defaults to infinite when no signal is present", () => {
    const raw = makeRaw({});
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("infinite");
  });

  test("mate inference takes priority over time/depth/nodes", () => {
    const raw = makeRaw({ mateSearch: true, timeSeconds: 10, depth: 5, nodes: 100 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("mate");
  });

  test("time inference takes priority over depth/nodes (when no mate)", () => {
    const raw = makeRaw({ timeSeconds: 10, depth: 5, nodes: 100 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("time");
  });

  test("explicit mode wins over legacy fields", () => {
    const raw = makeRaw({ mode: "infinite", mateSearch: true, timeSeconds: 10 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.mode).toBe("infinite");
  });

  test("drops mateSearch field from normalized output", () => {
    const raw = makeRaw({ mateSearch: true });
    const p = normalizeOnePreset(raw);
    expect(p.analysis).not.toHaveProperty("mateSearch");
  });

  test("drops timeSeconds when <= 0", () => {
    const raw = makeRaw({ mode: "time", timeSeconds: 0 });
    const p = normalizeOnePreset(raw);
    expect(p.analysis?.timeSeconds).toBeUndefined();
  });
});
