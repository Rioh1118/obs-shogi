import type { AnalysisCandidate } from "@/entities/engine";
import type { MateConclusion, MateSessionId } from "../api/rust-types";

/** 表に出す結論。Rust の結論に、始められなかった回の2つを足したもの */
export type MateOutcome =
  | MateConclusion
  /** 詰将棋エンジンを起動できなかった */
  | { kind: "startFailed" }
  /** 起動の外の理由で始められなかった */
  | { kind: "refused" };

/** 詰み探索の状態。記号は `docs/state-transitions/mate-search.md` */
export type MateSearchState =
  /** M0 表は検討のもの */
  | { phase: "closed" }
  /** Mp 押したが、検討の中断を待っている。表はまだ検討のもの */
  | { phase: "preparing"; sfen: string }
  /** M1 詰将棋エンジンを起動している */
  | { phase: "starting"; sfen: string; stopping: boolean }
  /** M2 探索している。`sessionId` は開始の応答が返るまで `null` */
  | {
      phase: "searching";
      sfen: string;
      stopping: boolean;
      sessionId: MateSessionId | null;
      startedAt: number;
      candidates: AnalysisCandidate[];
    }
  /** M3 終わった。`elapsedMs` は始められなかった回と起動中に中止した回が `null` */
  | {
      phase: "finished";
      sfen: string;
      elapsedMs: number | null;
      candidates: AnalysisCandidate[];
      outcome: MateOutcome;
    };

export type MateSearchAction =
  | { type: "prepare"; sfen: string }
  /** 検討が止まった。`warm` は詰将棋エンジンがもう動いているか */
  | { type: "begin"; sfen: string; warm: boolean; now: number }
  | { type: "accept"; sessionId: MateSessionId; now: number }
  | { type: "update"; sessionId: MateSessionId; candidates: AnalysisCandidate[] }
  | {
      type: "finish";
      sessionId: MateSessionId;
      candidates: AnalysisCandidate[];
      outcome: MateOutcome;
      now: number;
    }
  /** 探索の番号を受け取る前に終わった */
  | { type: "fail"; outcome: MateOutcome }
  | { type: "begin_stop" }
  | { type: "end_stop" }
  | { type: "close" };

export type MateSearchContextType = {
  state: MateSearchState;
  /**
   * 候補手の表と操作列の語が詰み探索のものか（M1〜M3）。
   *
   * 盤の局面と探索の局面が同じときだけ真。局面を動かした直後の1描画に、前の局面の結論を出さない
   */
  ownsTable: boolean;
  /** 詰み探索に使うプリセットが指定されていて、エンジンが設定されているか */
  available: boolean;
  /** 詰み探索のボタン。走っていれば中止し、走っていなければ始める */
  toggle: () => Promise<void>;
  /** 詰み探索を中止し、表を検討に返す。結論は残さない */
  dismiss: () => void;
};
