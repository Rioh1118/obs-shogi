import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPO_ROOT } from "./walk";

/**
 * `docs/state-transitions/` の索引が腐っていないかを見る検査の本体。
 * `stateTransitionIndex.test.ts` が個々の振る舞いを固定し、同じ関数を docs 全体に掛ける。
 *
 * 判定はこのモジュールだけが持つ。テスト側に同じ判定を書き写さないこと。写すと、
 * テストがコピーの方を叩き、出荷される検査に1本もテストが掛からない形になる。
 */

// 起点は `walk.ts` が決める。`process.cwd()` にすると、ランナーの起動場所が
// 別の作業ツリーだったときに違う木の docs を読む
const DOCS = join(REPO_ROOT, "docs");

/** 状態遷移表の置き場。索引（`README.md`）も表もここに並ぶ */
export const TABLES_DIR = join(DOCS, "state-transitions");

/** `TABLES_DIR` 直下のファイル名（`game.md` など） */
export const tables = () =>
  readdirSync(TABLES_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

/** `DOCS` からの相対パス（`state-transitions/game.md` など） */
export const markdownFiles = () =>
  readdirSync(DOCS, { recursive: true, encoding: "utf8" })
    .filter((name) => name.endsWith(".md"))
    .sort();

/** `DOCS` からの相対パスを絶対パスにする */
export const docsPath = (relative: string) => join(DOCS, relative);

/**
 * github-slugger と同じ規則。小文字化し、文字・数字・結合文字・`_`・`-`・空白以外を落とし、
 * 空白1つをハイフン1つに置き換える。日本語は落とさない。
 *
 * 「空白をまとめてハイフン1つ」にすると、`—` を挟む見出し（`書き込み — 7経路…`）で
 * GitHub 上のアンカーと1文字ずれる。GitHub で飛べるリンクをこのテストが落とす形になるので、
 * 1対1で置き換える。
 */
export const headingSlug = (heading: string) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Pc}\p{M}\- ]/gu, "")
    .replace(/ /g, "-");

/**
 * 1つの文書が持つアンカーの集合。
 *
 * github-slugger は同じ見出しが2度目に出たら `-1`、3度目に `-2` を付ける。
 * `表` や `不変条件` はこのリポジトリの表で実際に重複しているので、連番まで作らないと
 * `game.md#表-1` という**GitHub 上で正しく飛べるリンク**を「見出しが無い」と落とす。
 */
export const headingSlugs = (body: string) => {
  const seen = new Map<string, number>();
  const slugs = new Set<string>();

  for (const m of stripFences(body).matchAll(/^#{1,6}\s+(.+)$/gm)) {
    const base = headingSlug(m[1] ?? "");
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    slugs.add(n === 0 ? base : `${base}-${n}`);
  }
  return slugs;
};

/**
 * その行で「実在する表を未作成と書いている」名前を返す。
 *
 * 文（`。`）で区切ってから共起を見る。行ごと見ると
 * 「`search.md` は未作成。`game.md` は書けている」で落ちるが、区切れば落ちない。
 *
 * 表のセル（`|`）では区切らない。在庫表は名前と状態が別のセルにあり、
 * `| [game.md](game.md) | ❌ 未作成 |`（リンクを張ってから状態欄を直し忘れる）が
 * 実際の腐り方だから。同じ理由で、リンクになっている名前を除くのも駄目。
 */
export function staleUncreatedNames(line: string, exists: (name: string) => boolean): string[] {
  if (!line.includes("未作成")) return [];

  const out: string[] = [];
  for (const segment of line.split("。")) {
    if (!segment.includes("未作成")) continue;
    const names = new Set([...segment.matchAll(/([\w-]+\.md)/g)].map((m) => m[1] ?? ""));
    for (const name of names) if (exists(name)) out.push(name);
  }
  return out;
}

export type BrokenLink = { href: string; reason: "no-file" | "no-heading" };

/**
 * 1つの文書の中で、解決できない相対リンクを返す。表どうしのリンクは腐っても実行時に
 * 誰も踏まないので、見出しアンカーまでここで解決する。
 *
 * `exists` と `read` を受け取るのは、ファイルの有無と中身の取得を呼ぶ側に預けるため。
 * 判定はこの関数だけが持つ。
 *
 * 見るのは markdown のリンク記法だけ。`docs/decisions/` などがパスをコードスパンで
 * 書いている箇所は対象外で、そこは腐っても落ちない。
 */
export function brokenLinksInBody(
  body: string,
  selfPath: string,
  exists: (abs: string) => boolean,
  read: (abs: string) => string,
): BrokenLink[] {
  const broken: BrokenLink[] = [];

  // フェンスの中は落とす。例として書いたリンクまで解決しにいくと、
  // 「存在しないファイルを指す例」が docs に書けなくなる。
  for (const m of stripFences(body).matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
    const href = m[1] ?? "";
    if (/^(https?:|mailto:)/.test(href)) continue;

    const [path, anchor] = href.split("#");
    // 空パスは同じ文書の中のアンカー（`[…](#見出し)`）を指す
    const target = path === "" ? selfPath : join(dirname(selfPath), path);

    if (!exists(target)) {
      broken.push({ href, reason: "no-file" });
      continue;
    }
    // 画像などに見出しは無いので、アンカーが付いていても解決しない
    if (!target.endsWith(".md")) continue;
    if (anchor && !headingSlugs(read(target)).has(headingSlug(anchor))) {
      broken.push({ href, reason: "no-heading" });
    }
  }
  return broken;
}

export type BrokenReference = { label: string; reason: "no-definition" | "unused-definition" };

/**
 * 1つの文書の中で、定義の無い参照リンクと、使われていない定義を返す。
 *
 * **参照名を間違えても markdown はエラーを出さない。** `[表示][ラベル]` は
 * 角括弧つきの地の文としてそのまま描画されるだけで、リンクにならなかったことに
 * 目視でしか気づけない。他リポジトリのパスを外部リンクで書く規約
 * （`docs/state-transitions/README.md`）がこの2部構成を標準にしたので、
 * 使用と定義の結合は機械で見る。定義は使用箇所から遠く離れて置かれる。
 *
 * 使われていない定義も返すのは、表の行を消したときに定義だけが残るため。
 * 残った定義は次に同じラベルを別の意味で使った人を黙って誤った URL へ送る。
 *
 * ラベルの大小文字は CommonMark が同一視するので、こちらも畳んで比べる。
 *
 * **`[ラベル]` 単体（shortcut）も使用として数える。** 同じ出典を2度目に引く人が
 * 最も自然に書く形で、リンクとして正しく描画される。数えないと定義が
 * 「使われていない」になり、**その案内どおり定義を消すと1度目のリンクが地の文に落ちる。**
 * ただし裸の角括弧は地の文にも出るので、**定義済みのラベルと一致するものだけ**を数える。
 * 綴りを間違えた shortcut は、定義が使われていない側で赤くなる。
 *
 * `[a][b]` の形は、地の文でも参照リンクとして数える。CommonMark 上も定義が無ければ
 * 地の文に落ちるだけで、**書き手の意図が区別できない**。角括弧を2つ並べたいなら
 * 行内コードで囲むこと。
 */
export function brokenReferencesInBody(body: string): BrokenReference[] {
  // 行内コードも落とす。`ObsShogi-v[version]-[platform]-[arch][setup][ext]` のような
  // **命名パターン**が `[…][…]` の形を踏む。開きと同じ数のバッククォートで閉じる形
  // （`` `x` ``）まで見ないと、2連で囲った例が素通りする。
  // 空文字ではなく空白へ置き換えるのは、落とした跡で `[a]` と `[b]` が
  // 隣り合って参照リンクに見えるのを防ぐため。
  const text = stripFences(body).replace(/(`+)[^`\n]*?\1/g, " ");

  const defined = new Map<string, string>();
  // ラベルは行を跨がない。`[^\]]+` にすると、閉じない `[` が後続行の定義を飲み込む。
  for (const m of text.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*\S+/gm)) {
    defined.set(m[1]!.toLowerCase(), m[1]!);
  }

  const used = new Set<string>();
  // `[表示][ラベル]`。ラベルが空なら表示そのものがラベル（collapsed）
  for (const m of text.matchAll(/\[([^\]\n]*)\]\[([^\]\n]*)\]/g)) {
    const label = (m[2] || m[1] || "").toLowerCase();
    if (label) used.add(label);
  }
  // `[ラベル]` 単体（shortcut）。定義と一致するものだけ
  for (const m of text.matchAll(/\[([^\]\n]+)\](?![[(:])/g)) {
    const label = m[1]!.toLowerCase();
    if (defined.has(label)) used.add(label);
  }

  const broken: BrokenReference[] = [];
  for (const label of used) {
    if (!defined.has(label)) broken.push({ label, reason: "no-definition" });
  }
  for (const [key, label] of defined) {
    if (!used.has(key)) broken.push({ label, reason: "unused-definition" });
  }
  return broken;
}

/**
 * 1つの文書の中で「実在する表を未作成と書いている」箇所を、1始まりの行番号とともに返す。
 *
 * **ここでフェンスを落としてはいけない。** 索引の階層図はコードフェンスの中にあり、
 * 名前はバッククォートもリンクも付かない裸で書かれる。
 *
 * ```
 * L1    ├─ search.md            （未作成）インデックスと検索セッション
 * ```
 *
 * 表を書いたあと在庫表の状態欄だけ直して階層図を消し忘れる、というのが実際の腐り方の
 * 1つなので、リンク検査と同じ気持ちで `stripFences` を通すと、検査は緑のまま見逃す。
 */
export function staleUncreatedInBody(
  body: string,
  exists: (name: string) => boolean,
): { line: number; name: string }[] {
  return body
    .split("\n")
    .flatMap((line, i) => staleUncreatedNames(line, exists).map((name) => ({ line: i + 1, name })));
}

/**
 * コードフェンスの**中身だけ**を返す（外と開閉の記号は空行にする）。
 * [`stripFences`] の裏返しで、走査は [`scanFences`] を共有する。
 *
 * 索引の階層図はフェンスの中にあり、そこが「新しい表をどこに置くか」を決める唯一の案内。
 * 在庫表だけを見る検査は、図から表が1本抜けても緑のまま通る。抜けた表は前例として
 * 参照されないので、同じ階層に置くべきものが別の場所へ散る。
 *
 * `info` を渡すと、その情報文字列で開いたフェンスだけを返す。**渡さないと
 * 説明のための例まで拾う** —— 例に名前が1つ出るだけで「図にある」と判定されてしまう。
 */
export function insideFences(body: string, info?: string): string {
  return scanFences(body)
    .map((l) => (l.kind === "inside" && (info === undefined || l.info === info) ? l.line : ""))
    .join("\n");
}

/**
 * コードフェンスの中身を落とす。中は説明のための例なので、リンクとしても見出しとしても
 * 数えない。
 */
export function stripFences(body: string): string {
  return scanFences(body)
    .map((l) => (l.kind === "outside" ? l.line : ""))
    .join("\n");
}

type FenceLine = {
  line: string;
  kind: "outside" | "marker" | "inside";
  /** そのフェンスの情報文字列（```markdown の "markdown"）。中身と閉じ記号にだけ付く */
  info: string | null;
};

/**
 * 行ごとにフェンスの内外を判定する。**`stripFences` と `insideFences` の唯一の走査。**
 *
 * 2つに分けて書くと、片方だけが CommonMark の規則に追随して割れる。しかも割れ方は
 * 「フェンスを見ていない状態が緑で通る」側へ倒れるので、誰も気づかない。
 *
 * 閉じ記号は開きと同じ記号・同じ長さ以上のものだけ、という規則を行単位で見る。
 * 正規表現1本で済ませると、4連バッククォートで3連を囲んだ入れ子で外側の開きが内側の
 * 開きと対になり、**例として書いたリンクが本文として残る**。未閉じも同じ側に倒れる。
 *
 * **1行につき1要素を返す。** 呼ぶ側は行の位置で突き合わせる。
 */
function scanFences(body: string): FenceLine[] {
  let fence: { mark: string; indent: number; info: string } | null = null;
  const out: FenceLine[] = [];

  for (const line of body.split("\n")) {
    const m = /^( *)(`{3,}|~{3,})(.*)$/.exec(line);

    if (fence == null) {
      if (m) {
        fence = { mark: m[2]!, indent: m[1]!.length, info: m[3]!.trim() };
        out.push({ line, kind: "marker", info: fence.info });
        continue;
      }
      out.push({ line, kind: "outside", info: null });
      continue;
    }

    // CommonMark の閉じは開きに字下げを合わせなくてよいが、字下げは3スペースまで。
    // この窓は両側とも狭めても広げても壊れる。狭めれば有効な閉じを取りこぼし、
    // 広げればフェンスの**中身**である字下げされたフェンスで閉じてしまう。
    // どちらもファイルの残り全部を飲み込む。
    // 包含ブロック（箇条書き）の字下げは追っていないので、開きの字下げで代用する。
    const closes =
      m != null &&
      m[2]![0] === fence.mark[0] &&
      m[2]!.length >= fence.mark.length &&
      m[1]!.length <= fence.indent + 3 &&
      !m[3]!.trim();

    out.push({ line, kind: closes ? "marker" : "inside", info: fence.info });
    if (closes) fence = null;
  }
  return out;
}

/**
 * 表の中で記号を持つ行（`| **B0** | …`）の、その記号。
 *
 * 状態と事象はどちらもこの形で並ぶ。**見出しで区別する** —— 見出しに「状態」を
 * 含む節の表が状態、「事象」を含む節の表が事象。
 */
function symbolsUnderHeadings(body: string, match: (heading: string) => boolean): string[] {
  const out: string[] = [];
  let heading = "";

  for (const line of stripFences(body).split("\n")) {
    const h = /^#{2,6}\s+(.+)$/.exec(line);
    if (h) {
      heading = h[1]!;
      continue;
    }
    if (!match(heading)) continue;
    const row = /^\|\s*\*\*([A-Za-z][A-Za-z0-9]*)\*\*\s*\|/.exec(line);
    if (row) out.push(row[1]!);
  }
  return out;
}

type CountClaim = {
  /** 散文が名乗った数 */
  claimed: number;
  /** 表を数えた数 */
  actual: number;
  /** `状態` か `事象` */
  kind: "状態" | "事象";
};

/**
 * 「7状態 × 15事象」のような**散文の数**と、表の行数の食い違いを返す。
 *
 * この形の腐り方は実測で4回出た（`.claude/knowledge/mechanization-backlog.md` の
 * 「表を指す散文が、その表の行数と合っているか」）。行を1つ足したときに散文だけが
 * 古いまま残り、しかも**その数を根拠にした判断**（軸を別に持つ、段を5つに切る）が
 * 一緒に古くなる。数が合っていないと、その判断を後から確かめ直せない。
 *
 * 主張を持たない表は対象外。数を書かない自由はあり、書いたときだけ守らせる。
 */
export function countClaimsIn(body: string): CountClaim[] {
  const text = stripFences(body);
  const states = new Set(symbolsUnderHeadings(body, (h) => /状態/.test(h) && !/事象/.test(h)));
  const events = new Set(symbolsUnderHeadings(body, (h) => /事象/.test(h)));

  const out: CountClaim[] = [];
  for (const m of text.matchAll(/(\d+)\s*状態/g)) {
    out.push({ kind: "状態", claimed: Number(m[1]), actual: states.size });
  }
  for (const m of text.matchAll(/(\d+)\s*事象/g)) {
    out.push({ kind: "事象", claimed: Number(m[1]), actual: events.size });
  }
  return out.filter((c) => c.claimed !== c.actual);
}

/**
 * 「埋まっていないセル」の節に挙がっている項目の数。
 *
 * **箇条書きと表の両方を数える。** 実際の表は両方の形で書かれていて
 * （`position-editor.md` は番号付き、`game-session.md` は表）、
 * 片方だけを数えると**書き方の違いを「1件も挙げていない」と読み違える**。
 *
 * 表は区切り行（`| --- |`）より後ろの行だけを数える。見出し行は項目ではない。
 * 散文だけの節は0件。
 */
export function unfilledCellCount(body: string): number {
  const lines = stripFences(body).split("\n");
  const start = lines.findIndex((l) => /^#{2,6}\s+.*埋まっていない/.test(l));
  if (start < 0) return 0;

  let n = 0;
  let inTableBody = false;

  for (const line of lines.slice(start + 1)) {
    if (/^#{2,6}\s/.test(line)) break;

    if (/^\s*\|[\s\-:|]+\|\s*$/.test(line)) {
      inTableBody = true;
      continue;
    }
    if (!line.trimStart().startsWith("|")) inTableBody = false;

    if (/^\s*(?:[-*]|\d+\.)\s+\S/.test(line)) n++;
    else if (inTableBody && line.trimStart().startsWith("|")) n++;
  }
  return n;
}

/**
 * 在庫表（`README.md`）が「まだ踏まれていない」と書いた表の名前。
 *
 * 摘要にそう書いておきながら本体の「埋まっていないセル」が空、という食い違いが
 * 実際に起きる。README だけ直して本体を直さない側にも、本体だけ直して README を
 * 直さない側にも倒れるので、対で見る。
 */
export function tablesClaimedUnverified(readme: string): string[] {
  const out: string[] = [];
  for (const line of stripFences(readme).split("\n")) {
    if (!line.startsWith("|")) continue;
    if (!/未検証|踏まれていない/.test(line)) continue;
    for (const m of line.matchAll(/\[([\w-]+\.md)\]/g)) out.push(m[1]!);
  }
  return out;
}
