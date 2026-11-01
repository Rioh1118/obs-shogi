import { describe, expect, test } from "vitest";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import { findNodeChain } from "../findNodeChain";

describe("findNodeChain", () => {
  const leaf = { path: "/r/d/a.kif" } as FileTreeNode;
  const dir = { path: "/r/d", children: [leaf] } as FileTreeNode;
  const other = { path: "/r/e" } as FileTreeNode;
  const root = { path: "/r", children: [other, dir] } as FileTreeNode;

  test("根から目的の節までの列を返す", () => {
    expect(findNodeChain(root, "/r/d/a.kif")).toEqual([root, dir, leaf]);
  });

  test("根そのものは1要素の列を返す", () => {
    expect(findNodeChain(root, "/r")).toEqual([root]);
  });

  test("無い節は null を返す", () => {
    expect(findNodeChain(root, "/r/none")).toBeNull();
  });
});
