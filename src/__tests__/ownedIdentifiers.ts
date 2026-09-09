import { readFileSync } from "node:fs";
import { codeOf } from "./sourceText";
import { RUST_CHECKS_DIR, rustRoots, SRC, sourceFiles } from "./walk";
import { join } from "node:path";
import { readdirSync } from "node:fs";

/**
 * **「`X` の `y`」** という形の参照が実在するかを見る検査の本体。
 *
 * この repo は所有者を添えて綴りを指す書き方を doc とコメントの両方で使う。
 * **改名するとこの形だけが取り残される** —— 定義は消えているのに、同じ綴りが
 * 別の意味で他所に在ると grep では気づけない。
 *
 * **例をこの doc に書かないこと。** 取り残しを説明する例は、書いた時点で
 * この検査が拾う本物の取り残しになる（自分自身を歩くため）。
 *
 * `docsIdentifiers` との違いは2つ。
 *
 * 1. **下線を要求しない。** あちらは表の記号と頭字語を除くために下線で切っているので、
 *    `isActive` / `canSkipReopen` のような camelCase を**候補にすら入れない**
 *    （あちらの doc の「限界」2番）。改名跡はほぼ全部この形
 * 2. **`docs/**` だけでなく、`src/**` のコメントも見る。** 所有者付きの参照は
 *    コメント側にも同じ密度で在り、実際にそちらでも腐った
 *
 * 精度は「の」で挟む形に絞ることで出す。バッククォート1つだけを拾うと英文の散文
 * （`state` / `error`）まで候補になるが、**2つが「の」で繋がっている並びは、
 * この repo では所有者と要素の対を指す綴りにしか現れない。**
 */

/**
 * 対を拾う綴り。**両側とも識別子の形**であることを要求する。
 *
 * 所有者側は型・コンポーネント・モジュール（`FileNode` / `GameFileTreeBridge`）、
 * 要素側は関数・欄・定数（`isActive` / `loadFailedSeq` / `ROOT_CURSOR`）。
 * どちらも英数字だけで、空白も記号も挟まない綴りに限る。
 *
 * **所有者は大文字始まりだけ。** 小文字始まりはスライス名を指す緩い書き方
 * （「`game` の `loadGame`」）で、所有者がファイルでも型でもないので引けない。
 * 混ぜると、たまたま同じ名前のファイルに解決して偽陽性になる。
 */
const OWNED_PAIR = /`([A-Z][A-Za-z0-9]*)`\s*の\s*`([A-Za-z][A-Za-z0-9]*)(?:\(\))?`/g;

/**
 * 拾わない綴り。**ソースに無くて当然のもの。**
 *
 * 増やすときは**なぜソースに無くてよいか**を1件ずつ書くこと。
 * 説明を書けないなら、それは腐った参照であって除外の対象ではない。
 */
const EXEMPT = new Set([
  // DOM とブラウザの API。こちらの識別子ではない
  "showPopover",
  "hidePopover",
  "clipboard",
  "writeText",
  // React の語。フックの名前ではなく概念として引く
  "children",
  "cleanup",
  // ShogiHome（別リポジトリ）のボタンの見た目。ADR-0005 が「あちらはこう割る」の
  // 出典として引く。こちらの識別子ではない
  "subtle",
  "ghost",
]);

/**
 * 所有者の綴りが**定義されている**ファイルの中身。
 *
 * **repo 全体に在るかでは見ない。** それだと `isActive` のように、
 * 別の部品が同じ綴りを別の意味で持っているときに素通りする——
 * `docsIdentifiers` の doc が「限界」1番として書いている形で、
 * **この検査が捕まえたい改名跡はほぼ全部そこに落ちる。**
 *
 * 所有者は「ファイル名が一致する」か「その綴りを宣言している」ので引く。
 * 引けなかった所有者は**見ない**（外部の名前・概念名なので、偽陽性を出さない側へ倒す）。
 */
let ownerFiles: Map<string, string[]> | null = null;

/** 所有者を宣言している綴り。TS と Rust の両方 */
const DECLARATION =
  /\b(?:function|const|let|class|type|interface|enum|struct|impl|trait)\s+([A-Z][A-Za-z0-9]*)\b/g;

function ownerIndex(): Map<string, string[]> {
  if (ownerFiles !== null) return ownerFiles;

  const checkerModules = readdirSync(join(SRC, "__tests__"))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => join(SRC, "__tests__", name));

  const files = [
    ...sourceFiles(SRC, { includeTests: false }),
    ...rustRoots().flatMap((root) => sourceFiles(root)),
    ...sourceFiles(RUST_CHECKS_DIR),
    ...checkerModules,
  ].map((path) => ({ path, code: codeOf(readFileSync(path, "utf8")) }));

  // **1周で組む。** 所有者ごとに全ファイルを舐める形にすると、
  // 宣言の数 × ファイルの数だけ正規表現が走って検査が終わらない
  const index = new Map<string, string[]>();
  const add = (owner: string, code: string) => {
    const list = index.get(owner) ?? [];
    list.push(code);
    index.set(owner, list);
  };

  for (const { path, code } of files) {
    add(
      path
        .split("/")
        .pop()!
        .replace(/\.[^.]+$/, ""),
      code,
    );

    // そのファイルが宣言している大文字始まりの綴り（1ファイルに型が並ぶ形を拾う）
    for (const [, name] of code.matchAll(DECLARATION)) add(name, code);
  }

  ownerFiles = index;
  return ownerFiles;
}

type OwnedRef = { owner: string; member: string };

/** 「`X` の `y`」の対を拾う */
export function ownedRefsIn(text: string): OwnedRef[] {
  const found = new Map<string, OwnedRef>();

  for (const [, owner, member] of text.matchAll(OWNED_PAIR)) {
    if (EXEMPT.has(member) || EXEMPT.has(owner)) continue;
    found.set(`${owner}.${member}`, { owner, member });
  }

  return [...found.values()];
}

/**
 * **所有者の側に**その綴りが無い参照を返す。
 *
 * 所有者を引けなかった対は返さない。外部の名前（`SButton` の `subtle`）や
 * 概念名を指す書き方が実在するので、**引けない＝腐っている とは言えない。**
 * 止められるのは「所有者は在るのに、その中に綴りが無い」——改名跡の典型形。
 */
export function missingRefs(refs: OwnedRef[], index = ownerIndex()): OwnedRef[] {
  return refs.filter(({ owner, member }) => {
    const codes = index.get(owner);
    if (!codes || codes.length === 0) return false;
    return !codes.some((code) => new RegExp(`\\b${member}\\b`).test(code));
  });
}

/** 走査器のテストが合成した索引を渡せるように */
export function indexOf(entries: Record<string, string>): Map<string, string[]> {
  return new Map(Object.entries(entries).map(([k, v]) => [k, [v]]));
}
