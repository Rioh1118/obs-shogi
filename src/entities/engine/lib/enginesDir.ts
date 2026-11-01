import type { DirInfo } from "../api/aiLibrary";

/**
 * `<ai_root>/engines` が何として在るか。barrel には載せない。引数の `DirInfo` は `api/aiLibrary` にあり、
 * 片方だけ公開すると同じスライスに入口が2つできる（`src/__tests__/sliceBarrels.test.ts` の doc）。
 *
 * 利用者がすることが状態ごとに違うので、畳まない。
 *
 * - `unknown`: まだ読めていない（未スキャン、ルートを読めない、切り替えた直後）。`other` と区別が
 *   付かないので作成を勧めない。ルートを読めないなら、作成もルートの存在を確かめて同じ失敗が返る
 * - `missing`: 無いので作る。壊れたリンクもここに来る（`DirInfo.exists` は `Path::exists` で
 *   リンクを辿る）。その作成は `create_dir_all` が EEXIST で落ちる
 * - `dir`: フォルダとして在り、使える
 * - `other`: フォルダでないもの（ファイル、リンク）が在るので、開いて外す。`missing` に畳むと、在るものを
 *   「見つかりません」と言って作成を押させる。ファイルなら `engines::ensure` の存在検査が Rust の英文で
 *   落ち、フォルダを指すリンクなら黙って成功して何も直らない。Rust の `kind_of` はリンクを辿らないので、
 *   指す先がフォルダでもここに来る
 *
 * **読む側は `Record` で網羅する。** 三項の連鎖を手前に置くと最後の枝が残り全部を吸い、状態を足しても
 * tsc が落ちず、書き忘れた状態が別の状態の見た目で出る。文言と色は面ごとに持ってよい。
 *
 * 「開けるか」「作れるか」「中を列挙してよいか」は面によらない分類の性質なので、UI の `===` で書かず
 * 下の述語を使う。散らすと、状態を足したときに表だけが tsc で落ち、判定は黙って別の枝へ流れる。
 * 1つの状態だけを名指しする分岐（`SetupGuide` の hero の `other`）も `canListEnginesDir` で先に受ける
 */
export type EnginesDir = "unknown" | "missing" | "dir" | "other";

export function classifyEnginesDir(info: DirInfo | null | undefined): EnginesDir {
  if (!info) return "unknown";
  if (!info.exists) return "missing";
  return info.kind === "dir" ? "dir" : "other";
}

/** 開いて確かめられるか。そこに何かが在れば開ける（それが唯一の直し方のこともある） */
export function canRevealEnginesDir(dir: EnginesDir): boolean {
  switch (dir) {
    case "dir":
    case "other":
      return true;
    case "missing":
    case "unknown":
      return false;
  }
}

/** 作ってよいか。無いと読めているときだけ。読めていないときは `other` と区別が付かない */
export function canCreateEnginesDir(dir: EnginesDir): boolean {
  switch (dir) {
    case "missing":
      return true;
    case "dir":
    case "other":
    case "unknown":
      return false;
  }
}

/** 中を列挙してよいか。フォルダとして在るときだけ */
export function canListEnginesDir(dir: EnginesDir): boolean {
  switch (dir) {
    case "dir":
      return true;
    case "missing":
    case "other":
    case "unknown":
      return false;
  }
}
