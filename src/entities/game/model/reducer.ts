import { asBranchPlan } from "@/entities/kifu/model/cursor";
import type { GameAction, GameContextState } from "./types";
import { initialGameState } from "./types";

export function gameReducer(state: GameContextState, action: GameAction): GameContextState {
  switch (action.type) {
    // `blockingWrites` を持ち越す。0 に戻すと、書いている最中に `isLoading` が落ちて
    // 確認ダイアログの「削除中...」が解け、候補列が1つ減った状態へ同じ指定を撃ち直せる。
    case "game_loaded":
      return {
        jkf: action.payload.jkf,
        cursor: action.payload.cursor,
        branchPlan: asBranchPlan([...action.payload.cursor.forkPointers]),
        selectedPosition: null,
        loadedAbsPath: action.payload.absPath,
        boardSeq: state.boardSeq + 1,
        // 載ったので前の失敗の印は消す。回数は戻さない。戻すと、控えた値との比較が
        // 別の失敗と一致しうる
        loadFailedAbsPath: null,
        loadFailedSeq: state.loadFailedSeq,
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

    // `isLoading` を触らない。ここで落とすと続く保存の間「操作中」を名乗れず、
    // 確認ダイアログの「削除中...」も `closeOnEsc` も効かない。
    // 落とすのは `write_ended` だけで、撃つのは `runWrite` と `loadGame` の `finally`。
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
    // ADR-0004 決定7 の楽観的更新は、先に変えて失敗したら戻す。
    // 戻さないと、メモリとディスクが食い違ったまま次の操作が積み上がる。
    // 分岐の削除では、候補列が1つ減った状態に同じ添字で再試行が当たって
    // 別の枝が消える。コメントでは、同じ本文の再試行が `changed: false` に
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

    // 棋譜、カーソル、分岐の計画に触らない。理由は `path_renamed` の型の doc。
    //
    // `boardSeq` も進めない。進めると、`boardSeq` の doc に並ぶ3つの読み手が
    // 改名を載せ直しと読み、開いていたものを捨てる。
    case "path_renamed":
      // 盤に何も載っていなければ受けない。載っていないのに `loadedAbsPath` が値を持つと
      // `FileNode` の `canSkipReopen` が真になり、その行を押しても開かなくなる。
      //
      // `loadedAbsPath` でなく `jkf` を見ても同じ。立てるのは `game_loaded`、
      // 落とすのは `reset_state` で、どちらも両方を同時に動かす。
      if (state.jkf === null) return state;
      // 値が変わらないなら同じ参照を返す（`clear_selection` と同じ理由）
      if (state.loadedAbsPath === action.payload.absPath) return state;
      return { ...state, loadedAbsPath: action.payload.absPath };

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

    // `isLoading` を触らない。失敗したのは撃った1本で、並行して走る他の書き込みではない。
    // ここで落とすと、書いている最中に確認ダイアログの「削除中...」が解ける。
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

    // `loadedAbsPath` は触らない。盤には前の棋譜が載ったままで、足すのは失敗した宛先だけ。
    case "load_failed":
      return {
        ...state,
        loadFailedAbsPath: action.payload.absPath,
        loadFailedSeq: state.loadFailedSeq + 1,
      };

    // `initialGameState` を展開するので、書かない欄は初期値へ戻る。
    // **戻ってはいけない欄を足したら、ここも足すこと。** いまの持ち越しは次の3つ。
    //
    // - `blockingWrites`: 書き込みの最中にも棋譜は閉じる（ワークスペースの切り替え）。
    //   0 に戻すと `isLoading` が落ちて確認ダイアログが押し直せる状態へ戻る
    // - `loadFailedSeq`: 単調増加。戻すと、控えた値と同じ回数で別の失敗が観測され、
    //   待っている側が落ちた要求を捨てそこねる
    // - `boardSeq`: 単調増加。盤の中身が空へ入れ替わったので、ここでは進める
    case "reset_state":
      return {
        ...initialGameState,
        blockingWrites: state.blockingWrites,
        isLoading: state.blockingWrites > 0,
        boardSeq: state.boardSeq + 1,
        loadFailedSeq: state.loadFailedSeq,
      };

    default:
      return state;
  }
}
