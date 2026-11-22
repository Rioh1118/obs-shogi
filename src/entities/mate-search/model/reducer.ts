import type { MateSearchAction, MateSearchState } from "./types";

export const initialState: MateSearchState = { phase: "closed" };

/** 走っている（押すと中止する）か。検討の中断を待っている間も含む */
export function isRunning(state: MateSearchState): boolean {
  return state.phase === "preparing" || state.phase === "starting" || state.phase === "searching";
}

export function mateSearchReducer(
  state: MateSearchState,
  action: MateSearchAction,
): MateSearchState {
  switch (action.type) {
    case "prepare":
      return { phase: "preparing", sfen: action.sfen };
    case "begin":
      return action.warm
        ? {
            phase: "searching",
            sfen: action.sfen,
            stopping: false,
            sessionId: null,
            startedAt: action.now,
            candidates: [],
          }
        : { phase: "starting", sfen: action.sfen, stopping: false };
    case "accept":
      if (state.phase === "searching") return { ...state, sessionId: action.sessionId };
      if (state.phase !== "starting") return state;
      return {
        phase: "searching",
        sfen: state.sfen,
        stopping: state.stopping,
        sessionId: action.sessionId,
        startedAt: action.now,
        candidates: [],
      };
    case "update":
      if (state.phase !== "searching" || state.sessionId !== action.sessionId) return state;
      return { ...state, candidates: action.candidates };
    case "finish":
      if (state.phase !== "searching" || state.sessionId !== action.sessionId) return state;
      return {
        phase: "finished",
        sfen: state.sfen,
        elapsedMs: action.now - state.startedAt,
        candidates: action.candidates,
        outcome: action.outcome,
      };
    case "fail":
      if (state.phase !== "starting" && state.phase !== "searching") return state;
      return {
        phase: "finished",
        sfen: state.sfen,
        elapsedMs: null,
        candidates: [],
        outcome: action.outcome,
      };
    case "begin_stop":
    case "end_stop":
      if (state.phase !== "starting" && state.phase !== "searching") return state;
      return { ...state, stopping: action.type === "begin_stop" };
    case "close":
      return initialState;
  }
}
