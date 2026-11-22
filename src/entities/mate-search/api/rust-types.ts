import type { AnalysisResult } from "@/entities/engine";

/** 詰み探索の結論（Rust の `MateConclusion`） */
export type MateConclusion =
  /** 詰み。`moves` は詰み手順（USI の指し手） */
  | { kind: "mate"; moves: string[] }
  | { kind: "noMate" }
  | { kind: "timeout" }
  /** 利用者が中止した */
  | { kind: "cancelled" }
  /** このエンジンは詰み探索をしない */
  | { kind: "notSupported" }
  /** エンジンの答えを読めない */
  | { kind: "unreadable" }
  /** 探索中にエンジンが終わった */
  | { kind: "engineExited" }
  /** 中止に答えない。エンジンは落としてある */
  | { kind: "stopUnanswered" };

/** 詰み探索を始められなかった理由（Rust の `MateStartFailure`） */
export type MateStartFailureKind =
  /** 検討の探索が中断に答えない（V6）。検討のエンジンには触っていない */
  | "analysisUnresponsive"
  | "engineFailed"
  /** 始める前に別のリクエスト（中止、検討の開始、次の詰み探索）が来た */
  | "superseded"
  | "refused";

/** 探索の番号。途中経過と終わりの通知に載る */
export type MateSessionId = string;

export type MateSearchUpdate = { sessionId: MateSessionId; result: AnalysisResult };
export type MateSearchFinished = MateSearchUpdate & { conclusion: MateConclusion };
