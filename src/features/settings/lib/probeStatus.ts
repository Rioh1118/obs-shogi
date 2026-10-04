import type { EngineStartFailureKind } from "@/entities/engine";
import { hasCurrentDefinitions, probePathOf } from "@/entities/engine-presets/lib/withDefinitions";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/** 取得に失敗したこと。**どのパスの取得か**を持つ——パスを打ち換えた後に前の失敗を出さない */
export type ProbeFailure = {
  kind: EngineStartFailureKind;
  /** OS やエンジンの出力を含みうる。補足として小さく出す */
  message: string;
  enginePath: string;
};

const RETRY = "「もう一度読み込む」を押してください";

/**
 * 取得に失敗した理由と、次にすること。起動の失敗と同じ種類で届く（Rust の `EngineProber::probe`）。
 *
 * 解析の帯の文言（`ENGINE_START_FAILURE_NOTICES`）とは別に持つ。次にすることが違う——帯は
 * 「もう一度起動」「エンジン管理を開く」へ誘い、ここはこのダイアログの中で読み込み直す。
 * 取得に固有の読み替えもある: `timedOut` は起こす前（パスを開く・プロセスを作る）の上限で、
 * `usi` に答えない形は `notUsi` で届く
 */
const PROBE_FAILURE_TEXT: Record<EngineStartFailureKind, string> = {
  spawnFailed: `起動できませんでした。エンジンの場所と、実行の権限があるかを確かめてから${RETRY}`,
  quarantined: `macOS がまだ開くのを許可していません。システム設定の「プライバシーとセキュリティ」で許可してから${RETRY}`,
  notUsi: `USI エンジンとして応答しませんでした。選んだファイルがエンジン本体かを確かめてから${RETRY}`,
  exitedEarly: `応答の途中で終了しました。エンジンが要るファイル（評価関数・ライブラリ）が隣にあるかを確かめてから${RETRY}`,
  timedOut: `エンジンのファイルを時間内に開けませんでした。置いたドライブ（外付け・ネットワーク上）が応答しているかを確かめてから${RETRY}`,
  invalidValue: `エンジンを選び直すか、${RETRY}`,
  // 画面が撃ち直していないのに取り消された（最後に撃った取得だけがここへ来る）
  cancelled: `読み込みが取り消されました。${RETRY}`,
  other: `${RETRY}。続くときはアプリを再起動してください`,
  unknown: `${RETRY}。続くときはアプリを再起動してください`,
};

type ProbeStatus = { tone: "muted" | "warn"; text: string; detail: string | null };

/**
 * エンジンの欄の下に出す、読み込みの状態。**うまくいっているときは何も出さない**（`null`）——読み込みは
 * エンジンを選べば裏で進むもので、利用者が意識するものではない。出すのは読み込み中と、読めなかったときと、
 * いまのエンジンの定義が無いまま止まっているとき（「やめる」の後・プリセットが読み直された後）。最後の形を
 * 黙らせると、同じエンジンは選び直しても読み込まれないので、読み込み直す口が画面から消える。
 * 失敗は、失敗したパスがいまのパスと同じときだけ出す
 */
export function probeStatusText(
  draft: Pick<EnginePreset, "enginePath" | "definitions" | "definitionsFor" | "reservedNames">,
  probing: boolean,
  failure: ProbeFailure | null,
): ProbeStatus | null {
  if (!draft.enginePath) return null;
  if (probing) return { tone: "muted", text: "エンジンを読み込んでいます…", detail: null };
  if (failure && failure.enginePath === probePathOf(draft.enginePath)) {
    return {
      tone: "warn",
      text: `エンジンを読み込めませんでした。${PROBE_FAILURE_TEXT[failure.kind]}`,
      detail: failure.message || null,
    };
  }
  if (!hasCurrentDefinitions(draft)) {
    return { tone: "muted", text: "エンジンをまだ読み込んでいません。", detail: null };
  }
  return null;
}
