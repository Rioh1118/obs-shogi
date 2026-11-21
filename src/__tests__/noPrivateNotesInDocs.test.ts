import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT } from "./walk";

/**
 * 公開の文書（`docs/` と `research/`）に、公開しない作業メモの中身が戻っていないこと。
 *
 * 他製品の調査に `所感` の見出しを立てて評価を書く規律があり、その見出しごと公開されていた。
 * 利用者数の推計や撤退の条件といった事業上の前提も、同じように公開の文書に置かれていた。
 * 調べた相手への所感と事業の前提は追跡外の `.private/` に置く（`research/README.md` の規律4）。
 *
 * 見るのは、書いた形跡が綴りに残るものだけ。評価の言い回しそのものは機械では拾えないので、
 * 規律と調査の skill（`/survey`）に任せる。
 */
const PRIVATE_NOTE = /^#+\s*所感|有料ユーザ|撤退基準|将棋人口|市場規模|堀の/m;

const publicDocs = (): string[] =>
  execFileSync("git", ["ls-files", "-z", "--", "docs/*.md", "research/*.md"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);

describe("公開の文書に作業メモの中身が無い", () => {
  it("所感の見出しと事業の前提の語が無い", () => {
    const files = publicDocs();
    // 走査が空振りして「0件」を「違反が無い」と読ませない
    expect(files.length, "走査が空振りしている").toBeGreaterThan(50);

    const offenders = files.filter((file) =>
      PRIVATE_NOTE.test(readFileSync(join(REPO_ROOT, file), "utf8")),
    );

    expect(
      offenders,
      "所感と事業の前提は公開の文書に書かない。追跡外の .private/ に置くこと（research/README.md の規律4）",
    ).toEqual([]);
  });

  it("綴りの判定そのもの", () => {
    expect(PRIVATE_NOTE.test("本文\n\n## 所感\n\n- うまい")).toBe(true);
    expect(PRIVATE_NOTE.test("現実的な有料ユーザ 50〜300人")).toBe(true);
    expect(PRIVATE_NOTE.test("堀の定義そのもの")).toBe(true);
    // 本文中で「所感」という語に触れるだけなら当てない
    expect(PRIVATE_NOTE.test("所感は書かない")).toBe(false);
  });
});
