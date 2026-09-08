import { readdirSync, readFileSync } from "node:fs";
import { SRC, tsFiles } from "./walk";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `src/__tests__` はレイヤに属さない。リポジトリ全体の検査だけを置く場所で、
 * `src/**` はデータとして読む。
 *
 * `vite.config.ts` の `no-restricted-imports` は**静的な import 文しか見ない**ので、
 * `await import("@/…")` と `vi.mock("@/…")` は素通りする。ここは文字列として拾う。
 */

const HERE = join(SRC, "__tests__");

/**
 * レイヤは `src/` 直下のディレクトリ。`vite.config.ts` の一覧を写すと、
 * レイヤが増えたときにこちらだけ古いまま緑になる
 */
function layers(): string[] {
  return readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "__tests__")
    .map((entry) => entry.name);
}

/**
 * `@/` と相対の両方を受ける頭。
 *
 * **綴りをここ1箇所で決める。** 順方向と逆向きで別々に書くと、片方だけが `@/` しか
 * 見ない状態が黙って作れる——相対1段で届くファイル（`src/main.tsx` ほか）が
 * まるごと素通りする。
 */
const ANY_PREFIX = String.raw`["'\`](?:@/|\.{1,2}/)`;

/** `@/layer/...` と `../layer/...` の両方。相対でもレイヤには届く */
function appReference(names: string[]): RegExp {
  return new RegExp(`${ANY_PREFIX}(${names.join("|")})\\b`, "g");
}

/**
 * `@/__tests__/` と、相対で辿り着く `__tests__/`（`./` でも `../` でも、間に何段あっても）。
 *
 * **相対も見る。** `src/` から1階層以内のファイル（`src/main.tsx` ほか）は相対1段で
 * `src/__tests__/` に届き、`vite.config.ts` の `DEEP_RELATIVE_IMPORT`（`../../` 以上を
 * 禁じる）にも当たらない。`src/main.tsx` は入口なので、`node:fs` が本番の束に入ると
 * ツリーシェイクの逃げ道が無い。
 */
const TESTS_DIR_IMPORT = new RegExp(`${ANY_PREFIX}(?:[\\w.-]+/)*__tests__/[^"'\`]*`, "g");

/**
 * node の走査 API を直に引く綴り。**`walk.ts` を通らない走査器を拾うため。**
 *
 * **接頭辞もサブパスも受ける。** `node:` は省ける（lint も素の `fs` を通す）し、
 * `fs/promises` は `readFile` を持つ現実的な代替なので、どちらかに限ると素通りする。
 *
 * **静的 import に限らない。** 同じファイルの上の検査が
 * 「`no-restricted-imports` は静的 import しか見ない」と言って `await import(...)` を
 * 塞いでいるのに、こちらだけ `from` に縛ると同じ穴が片側だけ開く。
 * `child_process`（外部プロセスで歩く）と `module`（`createRequire` 経由で `fs` に届く）も
 * 材料に入れる。
 *
 * `import.meta.glob` は入れない——本番の正当な用途が在る（駒画像の読み込み）。
 */
const NODE_SCAN =
  /(?:from\s+|import\s*\(\s*|require\s*\(\s*)["'`](?:node:)?(?:fs|path|url|os|child_process|module)(?:\/[\w-]+)?["'`]/g;

/**
 * 上から下へ。`vite.config.ts` の `no-restricted-imports` と同じ順で、
 * ここでも `src/` 直下から導く（一覧を写さない）
 */
const TOP_DOWN = ["app", "pages", "widgets", "features", "entities", "shared"];

/** レイヤではない `src/` 直下のディレクトリ。import の向きの規則が掛からない */
const NOT_A_LAYER = ["assets"];

/** `name` より上のレイヤ。読んではいけない先 */
function upperLayers(name: string): string[] {
  const at = TOP_DOWN.indexOf(name);
  return at <= 0 ? [] : TOP_DOWN.slice(0, at);
}

describe("レイヤの向き（静的 import の外）", () => {
  /**
   * `no-restricted-imports` は**静的な import 文しか見ない**ので、
   * `await import(...)` と `vi.mock(...)` の文字列は素通りする。
   *
   * テストは動的 import を使う理由（`vi.mock` の巻き上げ）を持つので、
   * 規則の穴はテストの側に開きやすい
   */
  it("動的 import と vi.mock も下向きだけ", () => {
    const offenders: string[] = [];

    for (const layer of TOP_DOWN) {
      const upper = upperLayers(layer);
      if (upper.length === 0) continue;

      const pattern = new RegExp(`["'\`]@/(${upper.join("|")})\\b`, "g");
      for (const file of tsFiles(join(SRC, layer))) {
        for (const match of readFileSync(file, "utf8").matchAll(pattern)) {
          offenders.push(`${relative(SRC, file)}  ${match[0]}`);
        }
      }
    }

    expect(
      offenders,
      [
        "上のレイヤを読んでいる。lint は静的 import しか見ないので素通りする。",
        "その性質が上のレイヤのものなら、テストごとそちらへ置くこと。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * `TOP_DOWN` はレイヤの**順序**を持つので、`src/` から導けない（写すしかない）。
   * 写した一覧が古くなると、上の検査は黙って範囲を狭める。
   *
   * レイヤでないディレクトリは `NOT_A_LAYER` に並べる。並べ忘れると、
   * ここが「知らないディレクトリがある」として落ちる
   */
  it("レイヤの一覧が src/ の実体と合っている", () => {
    const unknown = layers().filter(
      (name) => !TOP_DOWN.includes(name) && !NOT_A_LAYER.includes(name),
    );

    expect(unknown, ["src/ に知らないディレクトリがある。", ...unknown].join("\n")).toEqual([]);
    expect(TOP_DOWN.filter((name) => !layers().includes(name))).toEqual([]);
  });
});

describe("レイヤに依存しない検査の置き場", () => {
  it("src/__tests__ がアプリのコードを参照しない", () => {
    const pattern = appReference(layers());
    const scanned = tsFiles(HERE);
    // 走査が空振りしても「違反0」になる。歩けていることを別に固定する
    expect(scanned.length, "src/__tests__ を歩けていない").toBeGreaterThan(8);

    const offenders = scanned.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(pattern)].map(
        (match) => `${relative(HERE, file)}  ${match[0]}`,
      ),
    );

    expect(
      offenders,
      [
        "src/__tests__ はレイヤに依存しない検査だけを置く場所。",
        "静的 import は lint が止めるが、動的 import と vi.mock は素通りする。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * **逆向きも塞ぐ。** `vite.config.ts` のレイヤの override は
   * `@/{app,pages,widgets,features}` を禁じるだけなので、本番モジュールが
   * `@/__tests__/walk` を読んでも lint は鳴らない。読めば `node:fs` が本番の束に
   * 入り、落ちるのはビルドかブラウザの実行時になる。
   *
   * **辺そのものは禁じない。** スライスに置くラチェット（`*.ratchet.test.ts`）は
   * 走査の起点を `walk.ts` から引くと決めてある（`CONTRIBUTING.md`）ので、
   * テストからは読めなければならない。**分けるのは `__tests__` 配下かどうか**
   * （`walk.ts` の `includeTests`）——スライス側のラチェットもディレクトリは
   * `__tests__/` に置くこと。**表への行は `ratchetIndex` が、置き場と名乗る義務は
   * ここが見る**（下の「スライス側の走査器はラチェットを名乗る」）。
   */
  it("本番のモジュールが検査の道具を読まない", () => {
    const production = tsFiles(SRC, { includeTests: false });
    // 走査が空振りしても「違反0」になる。歩けていることを別に固定する
    expect(production.length, "本番のモジュールを歩けていない").toBeGreaterThan(50);

    const offenders = production.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(TESTS_DIR_IMPORT)].map(
        (match) => `${relative(SRC, file)}  ${match[0]}`,
      ),
    );

    expect(
      offenders,
      [
        "本番のモジュールが `@/__tests__/` を読んでいる。",
        "走査の道具は `node:fs` を掴むので、読むのはテストからだけ。",
        ...offenders,
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * スライス側に置いた**横断の走査器**が `*.ratchet.test.ts` を名乗ることを見る。
   *
   * **`ratchetIndex` は名乗る義務を見ない。** あちらが見るのは「`.ratchet` を名乗った
   * もの」だけなので、ここが無いと、走査器をスライスへ置いて普通の名前を付けた瞬間に
   * `CONTRIBUTING.md` の表へ載せる義務から丸ごと外れる。表に無い検査は
   * 「逃げ道が無い」と読まれるので、次に赤くした人が `ALLOWED` に辿り着けない。
   *
   * 材料は2つ。`__tests__/` 配下を import しているか（`TESTS_DIR_IMPORT`）と、
   * **node の走査 API を直に引いているか**（`NODE_SCAN`）。前者だけだと、
   * `walk.ts` を通さず `node:fs` を直に掴む走査器が素通りする——起点を自分の
   * 居場所から取る形は `CONTRIBUTING.md` が別に禁じているが、文でしか要求して
   * いないので機械が要る。**置き場は上が、綴りはここが見る。**
   */
  it("スライス側の走査器はラチェットを名乗る", () => {
    const scanners = tsFiles(SRC, { includeTests: true })
      .filter((file) => !relative(SRC, file).startsWith("__tests__"))
      // どちらも `g` を持つ。`test()` は `lastIndex` を持ち越して1本おきに
      // 取りこぼすので、**必ず `match` で見ること。**
      .filter((file) => {
        const body = readFileSync(file, "utf8");
        return body.match(TESTS_DIR_IMPORT) !== null || body.match(NODE_SCAN) !== null;
      });

    expect(scanners.length, "スライス側の走査器を1本も拾えていない").toBeGreaterThan(0);

    const unnamed = scanners
      .map((file) => relative(SRC, file))
      .filter((rel) => !/\.ratchet\.test\.tsx?$/.test(rel));

    expect(
      unnamed,
      "スライスに置く走査器は `*.ratchet.test.ts` と名乗ること（`ratchetIndex` が表への行を要求する）",
    ).toEqual([]);
  });
});
