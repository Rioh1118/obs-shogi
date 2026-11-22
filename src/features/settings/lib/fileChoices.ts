import type { FsKind, ProfileCandidate } from "@/entities/ai-library/api/aiLibrary";

type FileChoice = {
  value: string;
  label: string;
  disabled?: boolean;
  /** 選んだときにプリセットの `aiName` に入れるフォルダの名前 */
  folder: string | null;
};

/** ファイルとして開けるか。フォルダはプリセットの候補にしない */
export function isFileKind(kind: FsKind): boolean {
  return kind === "file" || kind === "symlink";
}

/**
 * パスを「フォルダ / ファイル」で言う（`<AI のフォルダ>/<名前>/eval/nn.bin` → `名前 / nn.bin`）。
 * AI ライブラリの形（名前の下に `eval/`・`book/`）でなければファイル名だけ
 */
export function fileLabel(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  const file = parts[parts.length - 1] ?? path;
  const kind = parts[parts.length - 2];
  const folder = parts[parts.length - 3];
  return (kind === "eval" || kind === "book") && folder ? `${folder} / ${file}` : file;
}

/** 選択肢に無いパス（消えた）も選択として残す。落とすと保存したパスが画面から見えなくなる。 */
function keepCurrent(choices: FileChoice[], current: string | null): FileChoice[] {
  const cur = (current ?? "").trim();
  if (!cur || choices.some((c) => c.value === cur)) return choices;
  return [{ value: cur, label: `${fileLabel(cur)}（現在の選択）`, folder: null }, ...choices];
}

/**
 * 選んだ評価関数の型（ファイルの先頭から読んだもの）。AI ライブラリに無いファイルと、読めなかったファイルは `null`
 * （`docs/spec/features/eval-files.md` の AC-E5）
 */
export function evalTypeOf(profiles: ProfileCandidate[], path: string): string | null {
  for (const p of profiles) {
    const found = p.eval_files.find((f) => f.path === path);
    if (found) return found.eval_type ?? null;
  }
  return null;
}

/**
 * 評価関数の選択肢。AI ライブラリの全部のフォルダの `eval/` を「フォルダ / ファイル」で並べる。
 * 先頭は「指定しない」（評価関数を受けないエンジンがある。値は空）。各フォルダの中は `nn.bin` を先に
 */
export function evalChoices(profiles: ProfileCandidate[], current: string): FileChoice[] {
  const files = profiles.flatMap((p) =>
    [...p.eval_files]
      .sort((a, b) => Number(b.entry === "nn.bin") - Number(a.entry === "nn.bin"))
      .map((f) => ({
        value: f.path,
        label: `${p.name} / ${f.entry}`,
        disabled: !isFileKind(f.kind),
        folder: p.name,
      })),
  );
  return [{ value: "", label: "指定しない", folder: null }, ...keepCurrent(files, current)];
}

/** 拡張子を除いた名前と、小文字にした拡張子 */
function splitExt(entry: string): [string, string] {
  const dot = entry.lastIndexOf(".");
  return dot <= 0 ? [entry, ""] : [entry.slice(0, dot), entry.slice(dot + 1).toLowerCase()];
}

/**
 * 同じフォルダに同じ名前の `.db` があるので、エンジンが読まない `.ybb` か。
 * やねうら王は `.ybb` を `.db` の名前で受け、その名前の `.db` があればそちらを読む
 * （`docs/spec/features/book.md` の R-B4）。名前の大小は区別しない（macOS の初期のファイルシステムに揃える）
 */
function isShadowedByDb(entry: string, siblings: string[]): boolean {
  const [stem, ext] = splitExt(entry);
  if (ext !== "ybb") return false;
  return siblings.some((other) => {
    const [otherStem, otherExt] = splitExt(other);
    return otherExt === "db" && otherStem.toLowerCase() === stem.toLowerCase();
  });
}

/** 選んだ定跡が、同じ名前の `.db` に代わって読まれる `.ybb` か。欄の下で案内するために使う */
export function bookReadAsDb(profiles: ProfileCandidate[], path: string | null): boolean {
  if (!path) return false;
  return profiles.some((p) => {
    const entries = p.book_files.map((f) => f.entry);
    return p.book_files.some((f) => f.path === path && isShadowedByDb(f.entry, entries));
  });
}

/**
 * 定跡の選択肢。先頭は「使わない」（値は空）。AI ライブラリの全部のフォルダの `book/` の `.db` と `.ybb` を並べる。
 * 同じ名前の `.db` があってエンジンが読まない `.ybb` は、名前の後にそう添える。
 * 選んだ定跡は検討で使い、定跡ビューにも出す（「使わない」ならどちらにも出ない）
 */
export function bookChoices(profiles: ProfileCandidate[], current: string | null): FileChoice[] {
  const files = profiles.flatMap((p) => {
    const entries = p.book_files.map((f) => f.entry);
    return p.book_files.map((f) => ({
      value: f.path,
      label: `${p.name} / ${f.entry}${isShadowedByDb(f.entry, entries) ? "（.db が読まれる）" : ""}`,
      disabled: !isFileKind(f.kind),
      folder: p.name,
    }));
  });
  return [{ value: "", label: "使わない", folder: null }, ...keepCurrent(files, current)];
}
