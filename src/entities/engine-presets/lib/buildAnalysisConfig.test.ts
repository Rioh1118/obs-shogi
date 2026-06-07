import { describe, test, expect } from "vitest";
import { buildAnalysisConfig } from "./buildAnalysisConfig";
import type { AnalysisDefaults } from "../model/types";

describe("buildAnalysisConfig", () => {
  test("returns infinite when defaults is null", () => {
    expect(buildAnalysisConfig(null)).toEqual({ mode: "infinite" });
  });

  test("returns infinite when defaults is undefined", () => {
    expect(buildAnalysisConfig(undefined)).toEqual({ mode: "infinite" });
  });

  test("infinite mode passes through", () => {
    const defaults: AnalysisDefaults = { mode: "infinite" };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "infinite" });
  });

  test("time mode uses provided timeSeconds", () => {
    const defaults: AnalysisDefaults = { mode: "time", timeSeconds: 30 };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "time", timeSeconds: 30 });
  });

  test("time mode falls back to default when timeSeconds is missing", () => {
    const defaults: AnalysisDefaults = { mode: "time" };
    const result = buildAnalysisConfig(defaults);
    expect(result.mode).toBe("time");
    if (result.mode === "time") {
      expect(result.timeSeconds).toBeGreaterThan(0);
    }
  });

  test("time mode falls back when timeSeconds is zero", () => {
    const defaults: AnalysisDefaults = { mode: "time", timeSeconds: 0 };
    const result = buildAnalysisConfig(defaults);
    expect(result.mode).toBe("time");
    if (result.mode === "time") {
      expect(result.timeSeconds).toBeGreaterThan(0);
    }
  });

  test("depth mode uses provided depth", () => {
    const defaults: AnalysisDefaults = { mode: "depth", depth: 25 };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "depth", depth: 25 });
  });

  test("depth mode falls back when depth is missing", () => {
    const defaults: AnalysisDefaults = { mode: "depth" };
    const result = buildAnalysisConfig(defaults);
    expect(result.mode).toBe("depth");
    if (result.mode === "depth") {
      expect(result.depth).toBeGreaterThan(0);
    }
  });

  test("nodes mode uses provided nodes", () => {
    const defaults: AnalysisDefaults = { mode: "nodes", nodes: 5_000_000 };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "nodes", nodes: 5_000_000 });
  });

  test("nodes mode falls back when nodes is missing", () => {
    const defaults: AnalysisDefaults = { mode: "nodes" };
    const result = buildAnalysisConfig(defaults);
    expect(result.mode).toBe("nodes");
    if (result.mode === "nodes") {
      expect(result.nodes).toBeGreaterThan(0);
    }
  });

  test("mate mode produces bare variant", () => {
    const defaults: AnalysisDefaults = { mode: "mate" };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "mate" });
  });

  test("ignores unrelated fields when mode is infinite", () => {
    const defaults: AnalysisDefaults = {
      mode: "infinite",
      timeSeconds: 999,
      depth: 99,
      nodes: 999_999,
    };
    expect(buildAnalysisConfig(defaults)).toEqual({ mode: "infinite" });
  });
});
