import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { rustFile, SRC } from "./walk";

/**
 * ワークスペースの変更の合図の名前が、Rust と TS の写しで一致していることを見る。
 *
 * どちらのコンパイラもこの境界を見ない。割れると合図が誰にも届かず、ツリーは
 * フォーカスを戻すまで外の変更を出さない。エラーはどこにも出ない。
 */

const names = (source: string, pattern: RegExp) =>
  Object.fromEntries([...source.matchAll(pattern)].map((m) => [m[1], m[2]]));

describe("ワークスペースの線", () => {
  it("イベント名の綴りが揃っている", () => {
    const rust = names(
      readFileSync(rustFile("workspace", "events.rs"), "utf8"),
      /pub const (EVT_\w+): &str = "([^"]+)"/g,
    );
    const ts = names(
      readFileSync(join(SRC, "entities", "file-tree", "api", "events.ts"), "utf8"),
      /const (EVT_\w+) = "([^"]+)"/g,
    );

    expect(Object.keys(rust)).toHaveLength(1);
    expect(ts).toEqual(rust);
  });
});
