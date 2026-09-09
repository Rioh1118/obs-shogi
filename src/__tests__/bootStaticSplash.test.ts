import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import postcss from "postcss";
import * as sass from "sass";
import { describe, expect, it } from "vitest";
import { INDEX_HTML, SRC, TAURI_CONF } from "./walk";

/**
 * 起動の1枚目（`index.html` の `.boot-static`）が、React の `BootSplash` と
 * 同じ絵を出していることの検査。
 *
 * **写しは3箇所ある。** 面の色は `src/index.scss` のトークン・`index.html` の
 * インライン `<style>`・`tauri.conf.json` の `backgroundColor` に居て、
 * 絵の寸法は `BootSplash.scss` と `index.html` に居る。**どれも片方だけ動かせる。**
 * `scssScaleRatchet` も `modalOverlayTitlebar` も `src/**\/*.scss` しか歩かないので、
 * `index.html` は既存のどの検査からも見えない。
 *
 * **写しを作ったのはこの1枚を出すため。** バンドルされた CSS も
 * `html { font-size: 62.5% }` も、この時点ではまだ効いていない。
 *
 * 見るのは**静的側に書いてある宣言だけ**。`BootSplash.scss` にしか無いもの
 * （アニメーション、`@media (prefers-reduced-motion)`）は写していないので見ない。
 * 静的側に書いた宣言が `BootSplash.scss` の対応する値と違えば落ちる。
 */

/** `@use "@/index.scss"` を解決する。vite の alias はここには効かない */
const importer = {
  findFileUrl(url: string): URL | null {
    return url.startsWith("@/") ? pathToFileURL(join(SRC, url.slice(2))) : null;
  },
};

/** 宣言の集合。セレクタ → プロパティ → 実効値 */
type Rules = Map<string, Map<string, string>>;

function collect(css: string): Rules {
  const rules: Rules = new Map();
  postcss.parse(css).walkRules((rule) => {
    for (const selector of rule.selectors) {
      const decls = rules.get(selector) ?? new Map<string, string>();
      rule.walkDecls((decl) => {
        decls.set(decl.prop, decl.value.trim());
      });
      rules.set(selector, decls);
    }
  });
  return rules;
}

function bootSplashRules(): Rules {
  const css = sass.compile(join(SRC, "widgets/boot-splash/ui/BootSplash.scss"), {
    importers: [importer],
  }).css;
  return collect(css);
}

function staticRules(): Rules {
  const html = readFileSync(INDEX_HTML, "utf8");
  const styles = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
  expect(styles.length, "index.html にインライン <style> が無い").toBe(1);
  return collect(styles[0]);
}

/**
 * 静的側のセレクタと、それが写している `BootSplash.scss` のセレクタ。
 *
 * **綴りを分けてある。** 静的側が `.loading*` を名乗ると、バンドルされた CSS が
 * 届いた瞬間に両方へ当たり、React が置き換えるまでの間だけ二重に効く。
 */
const MIRRORED = [
  [".boot-static", ".loading__container"],
  [".boot-static__content", ".loading__content"],
  [".boot-static__icon", ".loading__icon"],
  [".boot-static__text", ".loading__text"],
] as const;

/**
 * 静的側にだけ在ってよいプロパティ。
 *
 * `position` / `inset` は器の作り方が違うため（`BootSplash` は `height: 100vh` の
 * ブロックだが、静的側は `body` の UA 既定 margin を無関係にするために浮かせる）。
 * `font-family` は綴りが同じでも SCSS 側がトークン越しなので、実効値で比べる。
 */
const STATIC_ONLY = new Set(["position", "inset"]);

/** `rem` を px へ。基準は `global.scss` の `html { font-size: 62.5% }` */
function normalize(value: string): string {
  return value.replace(/(-?[\d.]+)rem/g, (_, n: string) => `${Number(n) * 10}px`);
}

describe("起動の1枚目が BootSplash と同じ絵を出す", () => {
  const splash = bootSplashRules();
  const boot = staticRules();

  /** 走査が0件を返しても緑になる形を作らない */
  it("両側の宣言を実際に拾えている", () => {
    expect(splash.size, "BootSplash.scss から規則を1つも拾えていない").toBeGreaterThan(3);
    expect(boot.size, "index.html の <style> から規則を1つも拾えていない").toBeGreaterThan(3);
  });

  for (const [staticSelector, splashSelector] of MIRRORED) {
    it(`${staticSelector} が ${splashSelector} と同じ値を持つ`, () => {
      const mine = boot.get(staticSelector);
      const theirs = splash.get(splashSelector);
      expect(mine, `${staticSelector} が index.html に無い`).toBeDefined();
      expect(theirs, `${splashSelector} が BootSplash.scss に無い`).toBeDefined();

      const mismatched = [...(mine ?? [])]
        .filter(([prop]) => !STATIC_ONLY.has(prop))
        .filter(([prop, value]) => normalize(value) !== normalize(theirs?.get(prop) ?? ""))
        .map(([prop, value]) => `${prop}: ${value} / ${splashSelector} は ${theirs?.get(prop)}`);

      expect(
        mismatched,
        [
          "起動の1枚目は React が着く前に出るので、バンドルされた CSS を待てない。",
          "片方だけ動かすと、絵が入れ替わる瞬間にちらつく。",
          "`rem` は 10 倍した px と比べている（html の基準は 62.5%）。",
        ].join("\n"),
      ).toEqual([]);
    });
  }

  /**
   * 器のルールを `html` / `body` / `#root` / `*` に置かない。
   *
   * それらは React が置き換えた後も効き続ける。`.app-root`（`src/app/App.scss`）は
   * 面を持たず親の配分に依存するので、`#root` に `display: grid` を足すと
   * 本体のレイアウトが変わる。**SCSS 側の検査は `index.html` を歩かない**ので、
   * ここで止めないと誰も気づかない。
   */
  it("器のルールが起動の1枚目の外へ漏れていない", () => {
    const leaked = [...boot.keys()].filter((selector) =>
      /(^|[\s>+~])(html|body|\*|#root)([\s.:[]|$)/.test(selector),
    );
    expect(leaked, "React が置き換えた後も効き続ける").toEqual([]);
  });

  /**
   * 窓の初期色。**ここが合っていないと、窓が出てから HTML が描かれるまでの間に
   * 別の色が1枚挟まる** —— 白を消すために足した指定なので、ずれたら意味が無い。
   */
  it("窓の初期色が面の色と同じ", () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, "utf8")) as {
      app?: { windows?: { backgroundColor?: string }[] };
    };
    const windows = conf.app?.windows ?? [];
    expect(windows.length, "tauri.conf.json に窓が無い").toBeGreaterThan(0);

    const surface = splash.get(".loading__container")?.get("background-color");
    expect(surface, "BootSplash.scss に面の色が無い").toBeDefined();

    for (const window of windows) {
      expect(window.backgroundColor?.toLowerCase()).toBe(surface?.toLowerCase());
    }
  });
});
