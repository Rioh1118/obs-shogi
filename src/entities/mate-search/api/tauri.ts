import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toOptionValues, type EngineRuntimeConfig } from "@/entities/engine";
import { subscribeAll } from "@/shared/api/event/subscribeAll";
import { MATE_EVENT_NAMES } from "./eventNames";
import type {
  MateSearchFinished,
  MateSearchUpdate,
  MateSessionId,
  MateStartFailureKind,
} from "./rust-types";

type StartMateSearchArgs = {
  engine: EngineRuntimeConfig;
  /** 盤の局面。検討の `set_position` と同じ綴り */
  position: string;
  /** `null` は無制限 */
  limitMs: number | null;
};

/**
 * 詰み探索を始め、探索の番号を返す。検討の探索は Rust が先に中断する（検討のエンジンは落とさない）。
 *
 * 途中経過と終わりは番号を添えて通知で届き、**この応答より先に着くことがある**。
 * 断るときの値は `asMateStartFailureKind` で読む
 */
export async function startMateSearch({
  engine,
  position,
  limitMs,
}: StartMateSearchArgs): Promise<MateSessionId> {
  return await invoke("start_mate_search", {
    enginePath: engine.enginePath,
    values: toOptionValues(engine),
    evalPath: engine.evalPath,
    book: engine.book,
    position,
    limitMs,
  });
}

/** 詰み探索を中止する。終わりの通知を流し終えてから返る。走っていなければ何もしない */
export async function stopMateSearch(): Promise<void> {
  return await invoke("stop_mate_search");
}

const START_FAILURE_KINDS = {
  analysisUnresponsive: true,
  engineFailed: true,
  superseded: true,
  refused: true,
} satisfies Record<MateStartFailureKind, true>;

/** `startMateSearch` が投げた値の種類。Rust の形でない値（IPC そのものの失敗）は `refused` と読む */
export function asMateStartFailureKind(error: unknown): MateStartFailureKind {
  const kind =
    typeof error === "object" && error !== null && "kind" in error ? error.kind : undefined;
  return typeof kind === "string" && Object.prototype.hasOwnProperty.call(START_FAILURE_KINDS, kind)
    ? (kind as MateStartFailureKind)
    : "refused";
}

type MateEventListeners = {
  onUpdate: (update: MateSearchUpdate) => void;
  onFinished: (finished: MateSearchFinished) => void;
};

/** 詰み探索の通知を購読する。受け手は `sessionId` を照合する */
export function setupMateEventListeners({
  onUpdate,
  onFinished,
}: MateEventListeners): Promise<() => void> {
  return subscribeAll([
    () => listen<MateSearchUpdate>(MATE_EVENT_NAMES.UPDATE, (e) => onUpdate(e.payload)),
    () => listen<MateSearchFinished>(MATE_EVENT_NAMES.FINISHED, (e) => onFinished(e.payload)),
  ]);
}
