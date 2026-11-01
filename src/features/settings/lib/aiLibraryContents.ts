import type { AiRootIndex, ProfileCandidate } from "@/entities/engine/api/aiLibrary";
import { isEngineForThisMachine } from "@/entities/engine/lib/engineCandidate";
import {
  canListEnginesDir,
  classifyEnginesDir,
  type EnginesDir,
} from "@/entities/engine/lib/enginesDir";

/** 手順書に出す AI フォルダ。`hasBook` が偽でも使える（定跡は任意） */
export type AiFolderSummary = {
  name: string;
  path: string;
  hasEval: boolean;
  hasBook: boolean;
};

/** 索引から読み取った、画面に出す中身 */
export type AiLibraryContents = {
  /**
   * 索引を読めているか。読めていないときと0件を分ける。
   *
   * 数だけを渡すと、読めていないときも「エンジン 0 件」と断言する。
   */
  indexed: boolean;
  enginesDir: EnginesDir;
  /** 索引に載っているパス。読めていなければ空で、`<root>/engines` と推測しない */
  enginesDirPath: string;
  /** このマシンで使えるエンジンの名前 */
  engineNames: string[];
  profiles: AiFolderSummary[];
  /** 「検出された問題」に出す文 */
  warnings: string[];
};

/** 「検出された問題」に出す一言。`null` は何も言わない状態。`Record` の理由は `EnginesDir` の doc */
const ENGINES_DIR_WARNING: Record<EnginesDir, string | null> = {
  unknown: null,
  dir: null,
  missing: "engines/ が見つかりません。『engines/ を作成』で生成できます。",
  other: "engines がフォルダではありません。同じ名前のものを削除してください。",
};

function summarizeFolder(profile: ProfileCandidate): AiFolderSummary {
  return {
    name: profile.name,
    path: profile.path,
    hasEval: profile.has_eval_dir && profile.eval_files.length > 0,
    hasBook: profile.has_book_dir && profile.book_db_files.length > 0,
  };
}

function warningsOf(enginesDir: EnginesDir, engineCount: number, profiles: AiFolderSummary[]) {
  const warnings: string[] = [];
  const enginesWarning = ENGINES_DIR_WARNING[enginesDir];
  if (enginesWarning) warnings.push(enginesWarning);

  // `engines/` が使えるときだけ言う。無いときに言うと、1行目が「フォルダではない」と言ったものの
  // 中へ置けと指示することになる
  if (canListEnginesDir(enginesDir) && engineCount === 0) {
    warnings.push("エンジン実行ファイルが未検出です。engines/ 配下に置いてください。");
  }
  for (const { name, hasEval, hasBook } of profiles) {
    if (!hasEval) warnings.push(`「${name}」: 評価関数が未検出です（<AI 名>/eval に nn.bin 等）。`);
    if (!hasBook) warnings.push(`「${name}」: 定跡が未検出です（<AI 名>/book に .db）。`);
  }
  return warnings;
}

/** 索引を画面の中身へ読み替える。索引が無ければ、何も読めていない中身を返す。 */
export function readContents(index: AiRootIndex | null): AiLibraryContents {
  if (!index) {
    return {
      indexed: false,
      enginesDir: "unknown",
      enginesDirPath: "",
      engineNames: [],
      profiles: [],
      warnings: [],
    };
  }

  const enginesDir = classifyEnginesDir(index.engines_dir);
  const engineNames = index.engines.filter(isEngineForThisMachine).map((engine) => engine.entry);
  const profiles = index.profiles.map(summarizeFolder);
  return {
    indexed: true,
    enginesDir,
    enginesDirPath: index.engines_dir.path,
    engineNames,
    profiles,
    warnings: warningsOf(enginesDir, engineNames.length, profiles),
  };
}
