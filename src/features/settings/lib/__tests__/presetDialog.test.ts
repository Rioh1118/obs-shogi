import { describe, expect, test } from "vitest";

import type { EngineCandidate, ProfileCandidate } from "@/entities/engine/api/aiLibrary";
import type { EnginePreset } from "@/entities/engine-presets/model/types";
import { autofillPreset } from "../presetDialog";

/**
 * `autofillPreset` は、プリセット編集ダイアログの effect がそのまま呼ぶ。
 *
 * 固定するのは**「何も埋めなかったら同じ参照」**。理由は `autofillPreset` の doc。
 */

const PRESET: EnginePreset = {
  id: "p1" as EnginePreset["id"],
  label: "テスト",
  aiName: "",
  enginePath: "",
  evalFilePath: "",
  bookEnabled: false,
  bookFilePath: null,
  options: {},
};

const ENGINE: EngineCandidate = {
  entry: "YaneuraOu",
  path: "/ai/engines/YaneuraOu",
  kind: "file",
  launchability: "ready",
};

const PROFILE: ProfileCandidate = {
  name: "Suisho",
  path: "/ai/Suisho",
  has_eval_dir: true,
  has_book_dir: true,
  eval_files: [{ entry: "nn.bin", path: "/ai/Suisho/eval/nn.bin", kind: "file" }],
  book_db_files: [{ entry: "user_book1.db", path: "/ai/Suisho/book/user_book1.db", kind: "file" }],
};

const NOTHING = { profiles: [], engines: [] };
const CANDIDATES = { profiles: [PROFILE], engines: [ENGINE] };

describe("autofillPreset", () => {
  test("候補が1つも無ければ、同じ参照を返す", () => {
    expect(autofillPreset(PRESET, NOTHING)).toBe(PRESET);
  });

  test("欄が全部埋まっていれば、候補があっても同じ参照を返す", () => {
    const filled: EnginePreset = {
      ...PRESET,
      aiName: "Suisho",
      enginePath: ENGINE.path,
      evalFilePath: PROFILE.eval_files[0].path,
    };

    expect(
      autofillPreset(filled, {
        profiles: [PROFILE],
        engines: [ENGINE],
      }),
    ).toBe(filled);
  });

  test("2回続けて呼ぶと、2回目は同じ参照を返す", () => {
    const candidates = { profiles: [PROFILE], engines: [ENGINE] };
    const once = autofillPreset(PRESET, candidates);

    expect(once).not.toBe(PRESET);
    expect(autofillPreset(once, candidates)).toBe(once);
  });

  test("空の欄だけを埋める", () => {
    const next = autofillPreset(PRESET, {
      profiles: [PROFILE],
      engines: [ENGINE],
    });

    expect(next.aiName).toBe("Suisho");
    expect(next.enginePath).toBe(ENGINE.path);
    expect(next.evalFilePath).toBe(PROFILE.eval_files[0].path);
    // 定跡は「使う」にしていないので触らない
    expect(next.bookFilePath).toBeNull();
  });

  /**
   * **欄ごとに1本ずつ当てる。** 全欄が空の下書きを渡すテストだけだと、
   * どれか1つの枝が `changed` を立て損ねても残りが `next` を運ぶので、
   * 「4分岐それぞれが独立に立てる」という前提を1つも固定できない
   */
  test("AI名だけが空なら、AI名だけ埋まる", () => {
    const cur: EnginePreset = {
      ...PRESET,
      enginePath: ENGINE.path,
      evalFilePath: PROFILE.eval_files[0].path,
    };

    expect(autofillPreset(cur, CANDIDATES).aiName).toBe("Suisho");
  });

  test("エンジンだけが空なら、エンジンだけ埋まる", () => {
    const cur: EnginePreset = {
      ...PRESET,
      aiName: "Suisho",
      evalFilePath: PROFILE.eval_files[0].path,
    };

    expect(autofillPreset(cur, CANDIDATES).enginePath).toBe(ENGINE.path);
  });

  test("評価関数だけが空なら、評価関数だけ埋まる", () => {
    const cur: EnginePreset = { ...PRESET, aiName: "Suisho", enginePath: ENGINE.path };

    expect(autofillPreset(cur, CANDIDATES).evalFilePath).toBe(PROFILE.eval_files[0].path);
  });

  test("定跡だけが空なら、定跡だけ埋まる", () => {
    const cur: EnginePreset = {
      ...PRESET,
      aiName: "Suisho",
      enginePath: ENGINE.path,
      evalFilePath: PROFILE.eval_files[0].path,
      bookEnabled: true,
    };

    expect(autofillPreset(cur, CANDIDATES).bookFilePath).toBe(PROFILE.book_db_files[0].path);
  });

  test("すでに入っている値は上書きしない", () => {
    const chosen: EnginePreset = { ...PRESET, aiName: "手で選んだ名前" };
    const next = autofillPreset(chosen, {
      profiles: [PROFILE],
      engines: [ENGINE],
    });

    expect(next.aiName).toBe("手で選んだ名前");
  });

  test("定跡を使うなら、既定の .db を入れる", () => {
    const next = autofillPreset(
      { ...PRESET, bookEnabled: true },
      { profiles: [PROFILE], engines: [ENGINE] },
    );

    expect(next.bookFilePath).toBe(PROFILE.book_db_files[0].path);
  });

  /**
   * **解析で使わなくても定跡のパスは残す。** 定跡ビューはこのパスを出し、切ったことは起動のたびに
   * Rust が送る。落とすと、切り替えるたびに定跡を選び直すことになり、定跡ビューからも消える
   */
  test("定跡を解析で使わなくても、選んだ定跡は残す", () => {
    const cur = { ...PRESET, bookEnabled: false, bookFilePath: "/ai/Suisho/book/x.db" };
    const next = autofillPreset(cur, NOTHING);

    expect(next.bookFilePath).toBe("/ai/Suisho/book/x.db");
  });

  /**
   * 候補は名前で絞っていないので、2つ以上あるときの先頭は並びの都合でしかない。
   * 選べないもの（別の OS 向け）は数えない
   */
  test("エンジンは、選べる候補がちょうど1つのときだけ埋める", () => {
    const other: EngineCandidate = { ...ENGINE, entry: "gikou", path: "/ai/engines/gikou" };
    const windows: EngineCandidate = {
      ...ENGINE,
      entry: "YaneuraOu.exe",
      path: "/ai/engines/YaneuraOu.exe",
      launchability: "wrongPlatform",
    };
    const cur: EnginePreset = { ...PRESET, aiName: "Suisho" };

    expect(autofillPreset(cur, { profiles: [PROFILE], engines: [ENGINE, other] }).enginePath).toBe(
      "",
    );
    expect(
      autofillPreset(cur, { profiles: [PROFILE], engines: [windows, ENGINE] }).enginePath,
    ).toBe(ENGINE.path);
  });
});
