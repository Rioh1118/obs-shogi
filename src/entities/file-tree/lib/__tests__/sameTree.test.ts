import { describe, expect, it } from "vitest";
import type { FileTreeNode } from "@/entities/file-tree/model/types";
import { isSameTree } from "../sameTree";

const file = (id: string, name: string, extra: Partial<FileTreeNode> = {}): FileTreeNode => ({
  id,
  name,
  path: `/ws/${name}`,
  isDirectory: false,
  kifuInfo: { format: "kif" },
  ...extra,
});
const root = (id: string, children: FileTreeNode[]): FileTreeNode => ({
  id,
  name: "ws",
  path: "/ws",
  isDirectory: true,
  children,
});

describe("isSameTree", () => {
  it("振り直した id と、保存で変わる更新時刻・大きさは違いに数えない", () => {
    const a = root("r1", [file("1", "a.kif", { lastModified: new Date(1), size: 1 })]);
    const b = root("r2", [file("2", "a.kif", { lastModified: new Date(2), size: 2 })]);
    expect(isSameTree(a, b)).toBe(true);
  });

  it("外での改名を違いに数える（数が同じでも）", () => {
    expect(isSameTree(root("r", [file("1", "a.kif")]), root("r", [file("1", "b.kif")]))).toBe(
      false,
    );
  });

  it("空のフォルダと、子を読んでいないフォルダを分ける", () => {
    expect(isSameTree(root("r", []), { ...root("r", []), children: undefined })).toBe(false);
  });

  it("打ち切りの印の変化を違いに数える", () => {
    expect(isSameTree(root("r", []), { ...root("r", []), truncated: true })).toBe(false);
  });
});
