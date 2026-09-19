import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { codeOf } from "./sourceText";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * **書き込むファイル名を組む口は1つ。**
 *
 * 棋譜を作る面は3つある（盤で組む・棋譜を貼る・課題局面から）。どれも
 * 「打った名前＋選んだ形式」でファイル名を作るが、**規則は写された瞬間に割れる。**
 * 実際に割れていて、同じ `45角戦法.kif` という入力が面によって
 * `45角戦法.kif` にも `45角戦法.kif.kif` にもなっていた。`.kif` とだけ打った状態も、
 * 押せない面と `.kif.kif` を作る面に分かれていた。
 *
 * 規則は `kifuFileName`（`entities/kifu/model/kifu.ts`）が持つ。
 * 落とす拡張子の綴りを `KIFU_FORMAT_OPTIONS` から作るので、形式を1つ足せば
 * 落とす側も一緒に増える —— 写した側は増えない。
 *
 * **振る舞いはこの検査では見ない。** 組み方そのものは
 * `entities/kifu/model/__tests__/kifu.test.ts` が固定している。
 */

/** 名前を手で組んでいる形。`format` という綴りに寄せず、テンプレートの形で見る */
const HAND_BUILT = /`\$\{[^`]*\}\.\$\{[^`]*\}`/g;

/**
 * 棋譜ファイルを作る口。**この2つを呼ぶファイルだけを見る。**
 *
 * `${a}.${b}` の形そのものは無関係な場所にも出る（走査器が識別子を
 * `${owner}.${member}` で組んでいる）ので、形だけで禁じると誤検知になる。
 */
const CREATE_CALLS = ["createNewFile(", "importKifuFile("];

/** 規則そのものを持つ場所。ここだけが拡張子を落とし、付け直してよい */
const OWNER = "src/entities/kifu/model/kifu.ts";

/** 走査器自身。探している字面をそのまま持っているので、自分を数えると必ず赤になる */
const SELF = "src/__tests__/kifuFileNaming.test.ts";

describe("書き込むファイル名を組む口", () => {
  it("`<名前>.<形式>` を組むのは kifuFileName だけ", () => {
    const files = tsFiles(SRC);
    // 「見つけた件数が0」と「見たセルが0」を分ける。走査の起点が壊れればここで落ちる
    expect(files.length, "src を1ファイルも歩けていない").toBeGreaterThan(100);

    const handBuilt: string[] = [];
    let creators = 0;
    let ownerCount = 0;

    for (const file of files) {
      const name = relative(REPO_ROOT, file);
      if (name === SELF) continue;

      // コメントの中の例示は数えない（この規則の説明そのものが引っかかる）
      const code = codeOf(readFileSync(file, "utf8"));
      if (name === OWNER) {
        ownerCount = (code.match(HAND_BUILT) ?? []).length;
        continue;
      }
      if (!CREATE_CALLS.some((call) => code.includes(call))) continue;

      creators += 1;
      const hits = code.match(HAND_BUILT) ?? [];
      if (hits.length > 0) handBuilt.push(`${name}（${hits.join(" / ")}）`);
    }

    // 作る口を呼ぶファイルを1つも見ていないなら、この検査は何も守っていない
    expect(creators, "棋譜ファイルを作る呼び出しを1つも見つけていない").toBeGreaterThan(2);
    expect(
      ownerCount,
      `${OWNER} が名前を組んでいない。kifuFileName の中身か綴りが変わった`,
    ).toBeGreaterThan(0);
    expect(
      handBuilt,
      [
        "ファイル名を手で組んでいる。`kifuFileName(name, format)` を通すこと。",
        "通さないと、打った拡張子が二重に付く面と落ちる面に分かれ、",
        "`.kif` とだけ打った状態で押せてしまう面が残る。",
        ...handBuilt,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * 面を1つ増やしたときに、この検査が見る場所も増えていること。
   * **呼び出し元を数えないと、全員が手で組むのをやめた「0件」と見分けが付かない。**
   */
  it("作る面はどれも kifuFileName を通る", () => {
    const callers = tsFiles(SRC).filter((file) => {
      const name = relative(REPO_ROOT, file);
      if (name === OWNER || name === SELF) return false;
      return codeOf(readFileSync(file, "utf8")).includes("kifuFileName(");
    });

    expect(
      callers.map((file) => relative(REPO_ROOT, file)).sort(),
      "棋譜を作る面が kifuFileName を通っていない",
    ).toEqual([
      "src/entities/kifu/model/__tests__/kifu.test.ts",
      "src/features/create-file/model/useKifuImportDraft.ts",
      "src/features/create-file/ui/SfenKifuCreateModal.tsx",
      "src/features/position-editor/ui/EditorCreateForm.tsx",
    ]);
  });
});
