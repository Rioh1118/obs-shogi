import { describe, expect, test } from "vitest";
import type { FileTreeNode } from "@/entities/file-tree";
import { buildNodeMap, canMoveInto, isDescendantDir, parentDir } from "../dnd";

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

describe("canMoveInto", () => {
  const kifu = { path: "/ws/d/a.kif", isDirectory: false } as FileTreeNode;
  const dir = { path: "/ws/d", isDirectory: true } as FileTreeNode;

  test("別のフォルダへは移せる", () => {
    expect(canMoveInto(kifu, "/ws/e")).toBe(true);
    expect(canMoveInto(dir, "/ws/e")).toBe(true);
  });

  test("今いるフォルダへは移さない", () => {
    expect(canMoveInto(kifu, "/ws/d")).toBe(false);
    expect(canMoveInto(dir, "/ws")).toBe(false);
  });

  test("フォルダを自分自身と自分の下へは移さない", () => {
    expect(canMoveInto(dir, "/ws/d")).toBe(false);
    expect(canMoveInto(dir, "/ws/d/x")).toBe(false);
  });
});
