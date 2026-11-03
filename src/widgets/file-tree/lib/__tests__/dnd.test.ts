import { describe, expect, test } from "vitest";
import type { FileTreeNode } from "@/entities/file-tree";
import { buildNodeMap, isDescendantDir, parentDir } from "../dnd";

describe("isDescendantDir", () => {
  test("同じフォルダは中に含める", () => {
    expect(isDescendantDir("/ws/a", "/ws/a")).toBe(true);
  });

  test("下のフォルダは中", () => {
    expect(isDescendantDir("/ws/a", "/ws/a/b/c")).toBe(true);
  });

  test("上と隣は外", () => {
    expect(isDescendantDir("/ws/a", "/ws")).toBe(false);
    expect(isDescendantDir("/ws/a", "/ws/b")).toBe(false);
  });

  test("名前の頭が同じだけのフォルダは外", () => {
    expect(isDescendantDir("/ws/a", "/ws/ab")).toBe(false);
  });

  test("綴りを正規化してから比べる", () => {
    expect(isDescendantDir("/ws/a/", "/ws/x/../a/b")).toBe(true);
  });
});

describe("parentDir", () => {
  test("ひとつ上のフォルダを返す", () => {
    expect(parentDir("/ws/研究/a.kif")).toBe("/ws/研究");
  });

  test("親の無い名前は空文字にする", () => {
    expect(parentDir("a.kif")).toBe("");
  });
});

describe("buildNodeMap", () => {
  test("木の全ての節をパスで引ける", () => {
    const leaf = { path: "/ws/d/a.kif" } as FileTreeNode;
    const dir = { path: "/ws/d", children: [leaf] } as FileTreeNode;
    const root = { path: "/ws", children: [dir] } as FileTreeNode;

    const map = buildNodeMap(root);

    expect([...map.keys()]).toEqual(["/ws", "/ws/d", "/ws/d/a.kif"]);
    expect(map.get("/ws/d/a.kif")).toBe(leaf);
  });

  test("木が無ければ空", () => {
    expect(buildNodeMap(null).size).toBe(0);
  });
});
