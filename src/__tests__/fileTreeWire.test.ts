import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RUST_SRC, SRC } from "./walk";

/**
 * Rust の `FileTreeNode` の欄が、TS の受け口と写し先の両方に届いていることを見る。
 *
 * この境界には**どちらのコンパイラも立っていない**。Rust は serde で外へ出すだけ、
 * TS は `RustFileTreeNode` を手で書いた型として信じるだけなので、Rust に欄を足して
 * TS に写し忘れても型検査も lint も何も言わない。落ちるのは値だけで、
 * 画面上は「その情報が無い状態」と見分けが付かない。
 *
 * `fsErrorCodes.test.ts` と同じく、両方をデータとして読む
 * （`src/__tests__` はレイヤに依存しないので import では読めない）。
 */

const RUST_STRUCT = join(RUST_SRC, "workspace", "types.rs");
const TS_WIRE = join(SRC, "entities", "file-tree", "api", "rust-types.ts");
const TS_ADAPTER = join(SRC, "entities", "file-tree", "api", "adapter.ts");

/**
 * TS 側が意図して捨てている欄。
 *
 * **「まだ使っていない」を理由に並べない。** ここに並べてよいのは、写した先で
 * 誰も読まないと決めた欄だけ。使う予定があるなら写して未使用にしておくほうが、
 * 次に必要になった人が Rust まで遡らずに済む
 */
const DROPPED: Record<string, string> = {};

function block(source: string, open: RegExp, from: string): string {
  const start = source.match(open);
  if (start?.index === undefined) throw new Error(`${from} に ${open} が無い`);

  const rest = source.slice(start.index + start[0].length);
  const end = rest.indexOf("\n}");
  if (end < 0) throw new Error(`${from} の ${open} が閉じていない`);
  return rest.slice(0, end);
}

/** `FileTreeNode` の欄名を、シリアライズされる名前で返す */
function rustFields(): string[] {
  const source = readFileSync(RUST_STRUCT, "utf8");
  const body = block(source, /pub struct FileTreeNode \{/, "types.rs");

  const fields: string[] = [];
  let rename: string | null = null;

  for (const line of body.split("\n")) {
    const renamed = line.match(/#\[serde\([^)]*rename\s*=\s*"([^"]+)"/);
    if (renamed) rename = renamed[1];

    const field = line.match(/^\s*pub (\w+):/);
    if (!field) continue;

    fields.push(rename ?? field[1]);
    rename = null;
  }
  return fields;
}

/** `RustFileTreeNode` が宣言している欄名 */
function wireFields(): string[] {
  const source = readFileSync(TS_WIRE, "utf8");
  return [
    ...block(source, /export interface RustFileTreeNode \{/, "rust-types.ts").matchAll(
      /^ {2}(\w+)\??:/gm,
    ),
  ].map((m) => m[1]);
}

describe("FileTreeNode の受け渡し", () => {
  it("Rust の欄が TS の受け口に全部ある", () => {
    const wire = new Set(wireFields());
    const missing = rustFields().filter((field) => !wire.has(field));

    expect(
      missing,
      [
        "Rust だけにある欄。TS 側は宣言していないので、値は届いても誰も読めない。",
        "src/entities/file-tree/api/rust-types.ts に足すこと。",
        ...missing,
      ].join("\n"),
    ).toEqual([]);
  });

  it("受け口の欄は adapter が写している", () => {
    const adapter = readFileSync(TS_ADAPTER, "utf8");
    const unread = wireFields().filter(
      (field) => !DROPPED[field] && !adapter.includes(`r.${field}`),
    );

    expect(
      unread,
      [
        "受け口にあるのに adapter が読んでいない欄。IPC の境界で捨てている。",
        "写すか、捨てる理由を fileTreeWire.test.ts の DROPPED に書くこと。",
        ...unread,
      ].join("\n"),
    ).toEqual([]);
  });

  it("捨てる理由の一覧に、実在しない欄が残っていない", () => {
    const wire = new Set(wireFields());
    const stale = Object.keys(DROPPED).filter((field) => !wire.has(field));

    expect(stale, ["DROPPED に無い欄が並んでいる。消すこと。", ...stale].join("\n")).toEqual([]);
  });

  /**
   * `DROPPED` に並べた欄は adapter の中身を見ないので、**その欄の検査が切れる**。
   * 実際に読んでいる欄をここへ並べてはいけない。並べると、宣言が現状を表さない
   * うえに、その欄を写し忘れても緑のまま通る
   */
  it("捨てると書いた欄を、adapter が実は読んでいる、が起きない", () => {
    const adapter = readFileSync(TS_ADAPTER, "utf8");
    const lying = Object.keys(DROPPED).filter((field) => adapter.includes(`r.${field}`));

    expect(
      lying,
      ["DROPPED に並んでいるのに adapter が読んでいる。行を消すこと。", ...lying].join("\n"),
    ).toEqual([]);
  });

  it("欄を1つも読めていないなら、切り出しが壊れている", () => {
    // 抽出が空振りすると、上の3つは全部 `[]` を比べて緑になる
    expect(rustFields().length).toBeGreaterThan(4);
    expect(wireFields().length).toBeGreaterThan(4);
  });
});
