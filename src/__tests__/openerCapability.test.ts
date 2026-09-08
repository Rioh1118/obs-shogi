import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";
import { codeOf } from "./sourceText";

/**
 * `@tauri-apps/plugin-opener` の口と、capability の許可の識別子を突き合わせる。
 *
 * 許されていない口を叩いても**型は通り、ビルドも通る**。落ちるのは実機だけで、
 * `catch` が1つあれば「押しても何も起きないボタン」になり、画面には何も出ない。
 *
 * **Tauri の ACL の解決は模さない。** どの許可がどの窓・どの実行文脈で効くかは
 * `windows` / `webviews` / `local` / `remote` / `platforms` / `deny-*` /
 * capability の書き方（単体・配列・名前付きリスト）が絡み、ここで再実装すると
 * 軸を1つ落とすたびに「緑なのに実機では拒まれる」を作る。
 * 解決の結果そのものを読む形は #462。
 *
 * ここが見るのは**識別子の集合だけ**——呼んでいる口に許可があるか、呼び出し元の無い
 * 許可が残っていないか、名前で import しているか、IPC を直に叩いていないか、
 * `openPath` の呼び出し元が渡す値を書いているか。
 * 集合の突き合わせは ACL の解決を1行も模さずに書ける。
 */

const CAPABILITIES_DIR = join(REPO_ROOT, "src-tauri", "capabilities");

const MODULE = "@tauri-apps/plugin-opener";

/**
 * 許可の識別子と、それが解禁する JS の口。
 *
 * **1つの許可が複数の口を解禁する**（`opener:default` は集合）。
 * ここに無い `opener:` の許可があると赤くなる——知らない識別子を黙って通すと、
 * 呼び出し元の無い許可が残っても何も起きない。
 * 口を1つも解禁しない許可（`allow-default-urls`）は空で表す。
 * **`deny-*` はここに書かない**——打ち消しは集合の引き算になるので、
 * 必要になったら「解禁する口」と「打ち消す口」に割ること。
 */
const GRANTS: Record<string, string[]> = {
  "opener:default": ["openUrl", "revealItemInDir"],
  "opener:allow-open-path": ["openPath"],
  "opener:allow-open-url": ["openUrl"],
  "opener:allow-reveal-item-in-dir": ["revealItemInDir"],
  "opener:allow-default-urls": [],
};

/** 場所を見せるだけの用途に、既定のアプリを起動できる権限は要らない */
const OPEN_PATH_PERMISSION = "opener:allow-open-path";

/** capability の本文に現れる `opener:` の識別子。**書式は問わない** */
const PERMISSION = /["']opener:[a-z-]+["']/g;

/** `import { a, b } from "@tauri-apps/plugin-opener"` の中身 */
const NAMED_IMPORT = new RegExp(
  String.raw`import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+["']${MODULE}["']`,
  "g",
);

/**
 * モジュールを指す位置に綴りが現れた回数。
 *
 * 綴りの出現をそのまま数えると、説明にモジュール名を書いただけのファイルが落ちる。
 * **行コメントと、行頭で開くブロックの中は数えない**（`codeOf` がそこを落とす）。
 * 行の途中で開くブロック（JSX の `{/*`）は残るので、そこに書いた綴りは母数に入る。
 */
const SPECIFIER = new RegExp(
  String.raw`(?:from\s*|import\s*\(\s*|require\s*\(\s*)["']${MODULE}["']`,
  "g",
);

/**
 * JS のラッパを通さず IPC を直に叩く形。**型もラッパも通らないので、
 * 名前付き import を数える側からは完全に見えない。**
 */
const IPC_PREFIX = "plugin:opener|";

/**
 * `openPath` を呼ぶファイル（リポジトリからの相対パス）と、そこが渡す値。
 *
 * **scope と突き合わせられるのは人だけ。** 呼び出し元を足すときは、
 * capability の `allow` のどの行に一致するのかをここに書くこと。
 * ディレクトリを渡すなら `open_path` ではなく `revealItemInDir` を使う。
 *
 * **許可・呼び出し元・この表の3つを1つのコミットで足すこと。**
 * 片方ずつだと逆向きの検査を往復する。
 */
const OPEN_PATH_CALLERS = new Map<string, string>();

/** capability の全枚。**中身は解かない**——書式（単体・配列・JSON5・TOML）に依らず綴りを見る */
function capabilityText(): [string, string][] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      return entry.isDirectory() ? walk(path) : [path];
    });

  return walk(CAPABILITIES_DIR).map((file) => [
    relative(REPO_ROOT, file),
    readFileSync(file, "utf8"),
  ]);
}

/** capability に現れる `opener:` の識別子。相対パスと組で返す */
function grantedIdentifiers(): [string, string][] {
  return capabilityText().flatMap(([file, text]) =>
    [...text.matchAll(PERMISSION)].map(
      (match) => [file, match[0].slice(1, -1)] as [string, string],
    ),
  );
}

/** 本番のソースが読んでいる口。値は相対パスの一覧 */
function importedApis(): Map<string, string[]> {
  const found = new Map<string, string[]>();

  for (const path of tsFiles(SRC, { includeTests: false })) {
    const rel = relative(REPO_ROOT, path);
    const code = codeOf(readFileSync(path, "utf8"));

    const named = [...code.matchAll(NAMED_IMPORT)];

    // **名前を数えるのではなく、取りこぼしを禁じる。** 名前空間 import も
    // `await import(...)` も `require` も再エクスポートも、モジュールを指す位置には
    // 現れるのに名前付き import には一致しない
    expect(
      [...code.matchAll(SPECIFIER)].length,
      `${rel}: ${MODULE} を名前付き import 以外の形で読んでいる。何を呼んでいるかが走査から消える`,
    ).toBe(named.length);

    for (const match of named) {
      for (const raw of match[1].split(",")) {
        const name = raw
          .trim()
          .split(/\s+as\s+/)[0]
          .trim();
        if (!name) continue;
        found.set(name, [...(found.get(name) ?? []), rel]);
      }
    }
  }

  return found;
}

describe("opener の口と capability", () => {
  // 0件を見て緑になる形を止める
  test("本番のソースから口を読めている", () => {
    expect(importedApis().size).toBeGreaterThan(0);
  });

  // 同上。ディレクトリを読み違えると、綴りを探す側が何も見なくなる
  test("capability を読めている", () => {
    expect(capabilityText().length).toBeGreaterThan(0);
  });

  test("IPC の名前を直に叩いていない", () => {
    const offenders = tsFiles(SRC, { includeTests: false })
      .filter((path) => codeOf(readFileSync(path, "utf8")).includes(IPC_PREFIX))
      .map((path) => relative(REPO_ROOT, path))
      .sort();

    expect(
      offenders,
      `${IPC_PREFIX} を直に叩くと、JS のラッパも型もこの検査も通らない。ラッパ（${MODULE}）を使うこと`,
    ).toEqual([]);
  });

  test("capability の `opener:` の許可を全部読めている", () => {
    const unknown = grantedIdentifiers()
      .filter(([, identifier]) => !(identifier in GRANTS))
      .map(([file, identifier]) => `${file}: ${identifier}`)
      .sort();

    expect(unknown, "この検査の GRANTS に、その許可が解禁する口を足すこと").toEqual([]);
  });

  test("呼んでいる口には許可がある", () => {
    const granted = new Set(
      grantedIdentifiers().flatMap(([, identifier]) => GRANTS[identifier] ?? []),
    );
    const missing = [...importedApis()]
      .filter(([api]) => !granted.has(api))
      .map(([api, files]) => `${api}  ← ${files.join(", ")}`)
      .sort();

    expect(
      missing,
      "capability が許していない口を呼んでいる。**型もビルドも通り、実機でだけ落ちる。**",
    ).toEqual([]);
  });

  /**
   * 誰も呼ばない許可は、次に同じ口を叩く人へ「使ってよい」と伝えるだけで、
   * scope が用途に合っているかは誰も確かめていない。
   *
   * 集合の許可（`opener:default`）は、解禁する口のどれか1つが呼ばれていれば残る。
   * 口を1つも解禁しない許可は判定できないので対象外。
   */
  test("誰も呼んでいない口の許可を残さない", () => {
    const imported = importedApis();
    const unused = grantedIdentifiers()
      .filter(([, identifier]) => (GRANTS[identifier] ?? []).length > 0)
      .filter(([, identifier]) => !GRANTS[identifier].some((api) => imported.has(api)))
      .map(([file, identifier]) => `${file}: ${identifier}`)
      .sort();

    expect(unused, "呼び出し元が無い許可は落とすこと").toEqual([]);
  });

  /**
   * `open_path` の許可は scope（どのパスを許すか）を持つ。置いた瞬間に
   * 「何を既定のアプリで起動してよいか」を決めることになるので、**呼び出し元と対で**持たせる。
   * 上の検査は「口が呼ばれているか」しか見ないので、`OPEN_PATH_CALLERS` の側とも突き合わせる。
   */
  test("`open_path` の許可と呼び出し元は、対で在るか対で無い", () => {
    const placed = grantedIdentifiers()
      .filter(([, identifier]) => identifier === OPEN_PATH_PERMISSION)
      .map(([file]) => file)
      .sort();

    if (OPEN_PATH_CALLERS.size === 0) {
      expect(
        placed,
        `呼び出し元が無いなら ${OPEN_PATH_PERMISSION} も置かない。場所を見せるだけなら revealItemInDir（ディレクトリでも通る）`,
      ).toEqual([]);
      return;
    }

    expect(
      placed.length,
      `${OPEN_PATH_PERMISSION} を capability に足すこと（呼び出し元が ${OPEN_PATH_CALLERS.size} 件ある）`,
    ).toBeGreaterThan(0);
  });

  test("`openPath` の呼び出し元は、渡す値を書いている", () => {
    const callers = importedApis().get("openPath") ?? [];
    const undocumented = callers.filter((file) => !OPEN_PATH_CALLERS.has(file)).sort();

    expect(
      undocumented,
      "OPEN_PATH_CALLERS に、capability の allow のどの行に一致する値を渡すのかを書くこと",
    ).toEqual([]);

    const phantom = [...OPEN_PATH_CALLERS.keys()].filter((file) => !callers.includes(file)).sort();

    expect(phantom, "`openPath` を呼んでいないファイルが OPEN_PATH_CALLERS に残っている").toEqual(
      [],
    );
  });
});
