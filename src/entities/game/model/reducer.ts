import { asBranchPlan } from "@/entities/kifu/model/cursor";
import type { GameAction, GameContextState } from "./types";
import { initialGameState } from "./types";

export function gameReducer(state: GameContextState, action: GameAction): GameContextState {
  switch (action.type) {
    // `blockingWrites` を持ち越す。ここで 0 に戻すと、**まだ書いている最中に
    // `isLoading` が落ちる**。確認ダイアログの「削除中...」が解け、
    // 候補列が既に1つ減った状態に同じ指定が撃ち直せる（`set_error` と同じ理由）。
    case "game_loaded":
      return {
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: asBranchPlan([...action.payload.cursor.forkPointers]),
        selectedPosition: null,
        loadedAbsPath: action.payload.absPath,
        isLoading: state.blockingWrites > 0,
        blockingWrites: state.blockingWrites,
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

    // **`isLoading` を触らない。** ここで false を立てると、続く書き込みの間ずっと
    // 「操作中」を名乗れず、確認ダイアログの「削除中...」も `closeOnEsc` も効かない。
    // 落とすのは `edit` / `swapBranches` / `deleteBranch` の `finally` に一本化する。
    case "jkf_replaced":
      return {
        ...state,
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: action.payload.branchPlan,
        selectedPosition: null,
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
      // 自分が置いた棋譜がもう別物なら、戻さない。
      // 待っている間に入った編集や読み込みを、巻き戻しが上書きしないため。
      if (state.jkf !== action.payload.expectedJkf) return state;

      return action.payload.restoreCursor
        ? {
            ...state,
            jkf: action.payload.jkf,
            cursor: action.payload.cursor,
            branchPlan: action.payload.branchPlan,
            selectedPosition: null,
          }
        : { ...state, jkf: action.payload.jkf };

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

    // 止めない書き込み（コメントの自動保存）では**同じ参照を返す**。
    // 新しい state を返すと、それだけで `useGame()` の消費者が全員描き直される。
    case "write_started": {
      if (!action.payload.blocking) return state;
      const blockingWrites = state.blockingWrites + 1;
      return { ...state, blockingWrites, isLoading: true };
    }

    case "write_ended": {
      if (!action.payload.blocking) return state;
      const blockingWrites = Math.max(0, state.blockingWrites - 1);
      return { ...state, blockingWrites, isLoading: blockingWrites > 0 };
    }

    // **`isLoading` を触らない。** 失敗したのは撃った1本であって、
    // 並行して走っている他の書き込みではない。ここで落とすと、
    // まだ書いている最中に確認ダイアログの「削除中...」が解ける。
    case "set_error":
      return {
        ...state,
        error: action.payload,
      };

    case "write_failed":
      if (state.jkf !== action.payload.expectedJkf) return state;
      return { ...state, error: action.payload.error };

    case "clear_error":
      return state.error === null ? state : { ...state, error: null };

    // `game_loaded` と同じ理由で `blockingWrites` を持ち越す。
    // 棋譜を閉じるのは書き込みが走っている最中にも起こる（ワークスペースの切り替え）。
    case "reset_state":
      return {
        ...initialGameState,
        blockingWrites: state.blockingWrites,
        isLoading: state.blockingWrites > 0,
      };

    default:
      return state;
  }
}
