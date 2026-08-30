import { asBranchPlan } from "@/entities/kifu/model/cursor";
import type { GameAction, GameContextState } from "./types";
import { initialGameState } from "./types";

export function gameReducer(state: GameContextState, action: GameAction): GameContextState {
  switch (action.type) {
    case "game_loaded":
      return {
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: asBranchPlan([...action.payload.cursor.forkPointers]),
        selectedPosition: null,
        loadedAbsPath: action.payload.absPath,
        isLoading: false,
        error: null,
      };

    case "navigated":
      return {
        ...state,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
        error: null,
      };

    case "jkf_replaced":
      return {
        ...state,
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
        isLoading: false,
        error: null,
      };

    // 書き込みに失敗したときに、置き換える前の棋譜へ戻す。
    //
    // ADR-0004 決定7 の楽観的更新は「先に変えて、**失敗したら戻す**」。
    // 戻さないと、メモリとディスクが食い違ったまま次の操作が積み上がる。
    // 分岐の削除では、候補列が1つ減った状態に同じ添字で再試行が当たって
    // **別の枝が消える**。コメントでは、同じ本文の再試行が `changed: false` に
    // なって書き込みを飛ばし、「保存済み」だけが出る。
    //
    // `error` は消さない。戻したことと、戻した理由は別々に伝わる必要がある。
    case "jkf_restored":
      return {
        ...state,
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
        isLoading: false,
      };

    case "set_selection":
      return {
        ...state,
        selectedPosition: action.payload,
      };

    // 以下3つは値が変わらないなら同じ参照を返す。新しいオブジェクトを返すと state の
    // identity が変わり、それだけで contextValue が作り直されて useGame() の消費者が
    // 全部再レンダする。空きマスのクリックといま居る手数への移動は、値が変わらないまま
    // この dispatch を撃つ経路。
    // set_error / set_selection は値の変化が実質必ず伴うので短絡しない。
    case "clear_selection":
      return state.selectedPosition === null ? state : { ...state, selectedPosition: null };

    case "set_loading":
      return state.isLoading === action.payload ? state : { ...state, isLoading: action.payload };

    case "set_error":
      return {
        ...state,
        error: action.payload,
        isLoading: false,
      };

    case "clear_error":
      return state.error === null ? state : { ...state, error: null };

    case "reset_state":
      return initialGameState;

    default:
      return state;
  }
}
