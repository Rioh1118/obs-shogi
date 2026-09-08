import type { DirInfo } from "../api/aiLibrary";

/*
 * **barrel には載せない。** 引数の `DirInfo` は `api/aiLibrary` にあり、そちらは
 * barrel が公開していない。片方だけ公開すると、同じスライスに入口が2つできて
 * 公開境界が働かなくなる（`sliceBarrels` の doc）。呼び出し元はこのモジュールを直に読む
 */

/**
 * `<ai_root>/engines` が何として在るか。**畳まない。**
 *
 * 4つに割れているのは、**利用者がすることがそれぞれ違う**から。
 *
 * - `unknown` … まだ読めていない（未スキャン・ルートを読めない・切り替えた直後）。
 *   **`other` と区別が付かない**ので作成を勧めない。ルートを読めない回なら、
 *   作成もルートの存在を確かめるので同じ失敗が返る
 * - `missing` … 無い。作る。**壊れたリンクもここに来る**（`DirInfo.exists` は
 *   `Path::exists` でリンクを辿るため）。その回の作成は `create_dir_all` が EEXIST で落ちる
 * - `dir` … フォルダとして在る。使える
 * - `other` … フォルダでないもの（ファイル・リンク）が在る。**開いて外す。**
 *   「無い」に畳むと、在るものを「見つかりません」と言い、作成を押させることになる。
 *   ファイルなら `engines::ensure` の存在検査が Rust の英文で落ち、
 *   フォルダを指すリンクなら黙って成功して何も直らない
 *
 * リンクの扱いは Rust の `kind_of` が辿らないので、**指す先がフォルダでも `other`** に来る（#469）。
 *
 * **読む側は表（`Record`）で網羅する。** 三項の連鎖を表の手前に置くと、最後の枝が
 * 残り全部を吸うので、状態を足した日も緑のまま通り、書き忘れた状態が別の状態の
 * 見た目で出る。文言と色は面ごとに違うので各面が持ってよい。
 * 「開けるか」「作れるか」「中を列挙してよいか」は面によらないので、下の述語を使う。
 */
export type EnginesDir = "unknown" | "missing" | "dir" | "other";

export function classifyEnginesDir(info: DirInfo | null | undefined): EnginesDir {
  if (!info) return "unknown";
  if (!info.exists) return "missing";
  return info.kind === "dir" ? "dir" : "other";
}

/**
 * 分類から**することを引く**述語。3つとも `switch` の網羅で書く。
 *
 * **「できること」を UI 側の `===` で書かない。** 文言と色は面ごとに違うので
 * `Record` で各面が持ってよいが、「開けるか」「作れるか」「中を列挙してよいか」は
 * 分類そのものの性質で、どの面でも同じ答えになる。散らすと、状態が増えた日
 * （リンクを割る #469）に**表だけが tsc で赤くなり、判定は黙って別の枝に落ちる**——
 * 直した人は「tsc が全部拾った」と読む。
 *
 * 1つの状態だけを名指しする分岐（`SetupGuide` の hero の `other`）は残してよいが、
 * **述語で先に受けること**。増えた状態がその `===` を素通りして次の枝
 * （「エンジンを置いてください」）へ落ちると、誰も読めていないのに次の段の指示が出る。
 */

/** 開いて確かめられるか。**そこに何かが在る**なら開ける（それが唯一の直し方の回がある） */
export function enginesDirRevealable(dir: EnginesDir): boolean {
  switch (dir) {
    case "dir":
    case "other":
      return true;
    case "missing":
    case "unknown":
      return false;
  }
}

/** 作ってよいか。**無いと読めている**ときだけ。読めていない回は `other` と区別が付かない */
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
export function enginesDirUsable(dir: EnginesDir): boolean {
  switch (dir) {
    case "dir":
      return true;
    case "missing":
    case "other":
    case "unknown":
      return false;
  }
}
