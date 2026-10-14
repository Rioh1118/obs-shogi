import type { ProfileCandidate } from "@/entities/engine/api/aiLibrary";

type FileChoice = {
  value: string;
  label: string;
  disabled?: boolean;
  /** 選んだときにプリセットの `aiName` に入れるフォルダの名前（AI ライブラリの1件） */
  folder: string | null;
};

const usable = (kind: string) => kind === "file" || kind === "symlink";

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

/** 選択肢に無いパス（手で入れた、消えた）も選択として残す。落とすと保存したパスが画面から見えなくなる */
function keepCurrent(choices: FileChoice[], current: string | null | undefined): FileChoice[] {
  const cur = (current ?? "").trim();
  if (!cur || choices.some((c) => c.value === cur)) return choices;
  return [{ value: cur, label: `${fileLabel(cur)}（現在の選択）`, folder: null }, ...choices];
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
        disabled: !usable(f.kind),
        folder: p.name,
      })),
  );
  return [{ value: "", label: "指定しない", folder: null }, ...keepCurrent(files, current)];
}

/**
 * 定跡の選択肢。先頭は「使わない」（値は空）。AI ライブラリの全部のフォルダの `book/` の `.db` を並べる。
 * 選んだ定跡は解析で使い、定跡ビューにも出す（「使わない」ならどちらにも出ない）
 */
export function bookChoices(profiles: ProfileCandidate[], current: string | null): FileChoice[] {
  const files = profiles.flatMap((p) =>
    p.book_db_files.map((f) => ({
      value: f.path,
      label: `${p.name} / ${f.entry}`,
      disabled: !usable(f.kind),
      folder: p.name,
    })),
  );
  return [{ value: "", label: "使わない", folder: null }, ...keepCurrent(files, current)];
}
