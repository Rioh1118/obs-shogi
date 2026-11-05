import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, workflowFiles } from "./walk";

/**
 * `crates/*` のテストが `npm run verify:rust` と CI で走ること。
 *
 * `src-tauri/Cargo.toml` はルートの package を兼ねる workspace なので、`cargo test` と
 * `cargo clippy` は `--workspace` が無いと `app` だけを選ぶ。そのとき crate のテストは
 * 1本も走らず、壊しても緑で通る。`test_count_ratchet`（Rust）は `crates/` のテストも
 * 数えるので、走っていないテストが本数の床に入る。
 *
 * 見るのは2つ。
 *
 * 1. `package.json` の script とワークフローにある `cargo test` と `cargo clippy` の呼び出しが、
 *    `--workspace` を持つか、走らせるテストを `--lib <名前>` で名指しする
 * 2. `src-tauri/crates/` の下で `Cargo.toml` を持つディレクトリが、全部 `[workspace]` の
 *    `members` の綴りに当たる。外れても、ほかの crate が path で読んでいれば cargo が members に
 *    足すが、まだ誰も読んでいない crate は足されず、`--workspace` でも選ばれない
 *
 * ワークフローだけを触ったコミットは `verify-gate.sh` が素通しするので（`workflowEncoding` と同じ）、
 * 1 のワークフローの側が走るのは CI か、ほかのファイルを触ったついでのときだけ。
 */

const PACKAGE_JSON = join(REPO_ROOT, "package.json");
const CARGO_TOML = join(REPO_ROOT, "src-tauri", "Cargo.toml");
const CRATES = join(REPO_ROOT, "src-tauri", "crates");

const CARGO_CALL = /\bcargo\s+(?:test|clippy)\b/;
const SELECTS_WORKSPACE = /\s--workspace\b/;
const NAMES_TESTS = /\s--lib\s+[A-Za-z_]\w*/;

type Call = { where: string; text: string };

/** script の本文を `&&` と `;` で割り、cargo の呼び出しだけを残す */
function packageCalls(): Call[] {
  const scripts = JSON.parse(readFileSync(PACKAGE_JSON, "utf8")).scripts as Record<string, string>;
  return Object.entries(scripts).flatMap(([name, body]) =>
    body
      .split(/&&|;/)
      .map((part) => part.trim())
      .filter((part) => CARGO_CALL.test(part))
      .map((text) => ({ where: `package.json の ${name}`, text })),
  );
}

/** ワークフローの行のうち、コメントでない cargo の呼び出し */
function workflowCalls(): Call[] {
  return workflowFiles().flatMap((file) =>
    readFileSync(file, "utf8")
      .split("\n")
      .map((line, index) => ({ line: line.trim(), index }))
      .filter(({ line }) => !line.startsWith("#") && CARGO_CALL.test(line))
      .map(({ line, index }) => ({
        where: `${relative(REPO_ROOT, file)}:${index + 1}`,
        text: line,
      })),
  );
}

/** `[workspace]` の `members` の各項目。`[workspace]` の節の中だけを読む */
function workspaceMembers(): string[] {
  const toml = readFileSync(CARGO_TOML, "utf8");
  const section = /^\[workspace\]\n([\s\S]*?)(?=^\[)/m.exec(toml);
  expect(section, "src-tauri/Cargo.toml に [workspace] の節が無い").not.toBeNull();
  const members = /^members\s*=\s*\[([^\]]*)\]/m.exec(section![1]);
  expect(members, "[workspace] に members が無い").not.toBeNull();
  return [...members![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** `crates/*` のような末尾だけの `*` と、そのままの綴りを受ける。それ以外の glob は書かれていない */
function matchesMember(path: string, member: string): boolean {
  if (member.endsWith("/*")) {
    const parent = member.slice(0, -2);
    return path.startsWith(`${parent}/`) && !path.slice(parent.length + 1).includes("/");
  }
  return path === member;
}

describe("crate のテストが実行から漏れない", () => {
  it("cargo test と cargo clippy の呼び出しは --workspace を持つか、テストを名指しする", () => {
    const fromPackage = packageCalls();
    const fromWorkflows = workflowCalls();

    // 0件を「漏れが無い」と読ませない。verify:rust の test と clippy、CI の test と clippy は必ずある
    expect(
      fromPackage.length,
      "package.json に cargo の呼び出しが見つからない",
    ).toBeGreaterThanOrEqual(2);
    expect(
      fromWorkflows.length,
      "ワークフローに cargo の呼び出しが見つからない",
    ).toBeGreaterThanOrEqual(2);

    const leaking = [...fromPackage, ...fromWorkflows]
      .filter(({ text }) => !SELECTS_WORKSPACE.test(text) && !NAMES_TESTS.test(text))
      .map(({ where, text }) => `${where}: ${text}`);

    expect(leaking, "--workspace が無いと app のテストしか選ばない").toEqual([]);
  });

  it("crates/ の下の crate は全部 workspace の members に当たる", () => {
    expect(
      existsSync(CRATES),
      "src-tauri/crates が無い。動かしたなら、この検査の指す先も直すこと",
    ).toBe(true);
    const members = workspaceMembers();
    const crates = readdirSync(CRATES, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(CRATES, entry.name, "Cargo.toml")))
      .map((entry) => `crates/${entry.name}`);

    expect(crates.length, "crates/ の下に crate が見つからない").toBeGreaterThan(0);
    const outside = crates.filter((path) => !members.some((member) => matchesMember(path, member)));
    expect(
      outside,
      "members に当たらない crate は、誰も読んでいないと --workspace でも選ばれない",
    ).toEqual([]);
  });
});
