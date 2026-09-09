import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { describe, expect, it } from "vitest";
import { INDEX_HTML, REPO_ROOT, SRC, TAURI_CONF, scssFiles } from "./walk";

/**
 * 配布物が読めないものに依存していないこと。
 *
 * 配布物の CSP（`tauri.conf.json` の `app.security.csp`）は外部オリジンを許していない。
 * **dev サーバには CSP が乗らない**ので、外部の URL を書くと開発中だけ効いて
 * 配布物では黙って落ちる ——「dev では見えているのに配布物では違う字が出る」という形で、
 * 実機に配るまで誰も気づかない（→ #503）。
 *
 * **「CSP のどのディレクティブに載っているか」は見ない。** そちらの形にすると
 * 許可を1つ足せば通るので、外部オリジンを増やす方向に効かない。
 * ここで固定するのは**0本であること**。増やしたいなら、この検査と CSP の両方を
 * 動かす必要がある。
 */

/** `http://` `https://` `//` で始まる URL。プロトコル相対も外部 */
const EXTERNAL = /^(?:https?:)?\/\//;

/** `href="…"` / `src="…"` の値。属性の順序や改行を跨いでも拾えるよう属性単位で見る */
const HTML_URL_ATTR = /\b(?:href|src)\s*=\s*"([^"]*)"/g;

/** `url(…)` の中身。引用符はあってもなくてもよい */
const CSS_URL = /url\(\s*['"]?([^'")]+)['"]?\s*\)/g;

type Ref = { where: string; url: string };

function htmlRefs(): Ref[] {
  const source = readFileSync(INDEX_HTML, "utf8");
  return [...source.matchAll(HTML_URL_ATTR)].map((m) => ({ where: "index.html", url: m[1] }));
}

function scssRefs(): Ref[] {
  return scssFiles(SRC).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    return [...source.matchAll(CSS_URL)].map((m) => ({
      where: relative(REPO_ROOT, file),
      url: m[1],
    }));
  });
}

describe("配布物が読めない外部オリジンに依存しない", () => {
  const refs = [...htmlRefs(), ...scssRefs()];

  /**
   * **走査が0件を返しても緑になる形を作らない。**
   *
   * 外部オリジンは0本にするのが目的なので、「見つからなかった」だけでは
   * 抽出が壊れたのか本当に無いのかが区別できない。`index.html` には
   * favicon とエントリの2本が必ず在るので、そこに下限を張る
   * （`mechanization-backlog.md` の「見つけた件数が0」と「見たセルが0」）。
   */
  it("URL を実際に拾えている", () => {
    expect(htmlRefs().length, "index.html から href/src を1つも拾えていない").toBeGreaterThan(1);
  });

  it("index.html と SCSS に外部オリジンが無い", () => {
    const external = refs.filter((ref) => EXTERNAL.test(ref.url));

    expect(
      external.map((ref) => `${ref.where}: ${ref.url}`),
      [
        "配布物の CSP は外部オリジンを許していない（dev だけで効く指定になる）。",
        "書体を足したいなら @fontsource で同梱して src/main.tsx から import する。",
      ].join("\n"),
    ).toEqual([]);
  });

  /**
   * CSP を緩めて素通しにする道を塞ぐ。**この検査が守っている前提そのもの**なので、
   * 外部オリジンを許す方向へ CSP を動かしたら、上の検査の意味が変わったことに気づかせる。
   *
   * `http://ipc.localhost` は Tauri がコマンドを受ける先で、アプリの外に出ない
   * （Windows の webview2 がこの綴りを要求する）。だから外部として数えない。
   */
  it("CSP がアプリの外のオリジンを許していない", () => {
    const conf = JSON.parse(readFileSync(TAURI_CONF, "utf8")) as {
      app?: { security?: { csp?: string } };
    };
    const csp = conf.app?.security?.csp;

    expect(csp, "app.security.csp が無い").toBeTypeOf("string");

    const hosts = [...(csp ?? "").matchAll(/(?:https?:)?\/\/[^\s;]+/g)].map((m) => m[0]);
    expect(hosts, "CSP に外部オリジンを足すなら、上の検査の前提が崩れる").toEqual([
      "http://ipc.localhost",
    ]);
  });
});
