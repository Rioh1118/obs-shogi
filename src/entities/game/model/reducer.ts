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
        boardSeq: state.boardSeq + 1,
        // 載ったので、前に失敗した印は消す。**回数は戻さない**——戻すと、
        // 控えた値との比較が別の失敗と一致しうる
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

    // **棋譜・カーソル・分岐の計画に触らない。** 改名・移動は同じ棋譜の名前が
    // 変わっただけで、盤に並んでいるものは変わらない。ここで載せ直すと、
    // file-tree が開いた時点で持った `jkfData` に置き換わり、盤も棋譜一覧も
    // カーソルもその時点まで戻る。
    //
    // **`boardSeq` も進めない。** 進めると、盤の中身が入れ替わったことにしか反応しない側
    // （`boardSeq` の doc に読み手が3つ並ぶ）が、改名を載せ直しと読んで持ち物を捨てる。
    case "path_renamed":
      // **盤に何も載っていなければ受けない。** `loadedAbsPath` は「盤に載っている棋譜」なので、
      // 載っていないのに値を持つと `FileNode` の `canSkipReopen` が真になり、
      // その行は押しても開かなくなる（盤が空のまま戻せない）。
      //
      // 見るのが `jkf` なのは、`loadedAbsPath` と**必ず組で動く**から——立てるのは
      // `game_loaded` が両方同時、落とすのは `reset_state` が両方同時。どちらで見ても同じ。
      // 組で動かない欄をあとで足すなら、ここも見直すこと
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

    // **`loadedAbsPath` は触らない。** 盤には前の棋譜が載ったままなので、
    // ここで動かすと「載っている棋譜」の意味が崩れる。足すのは失敗した宛先だけ。
    case "load_failed":
      return {
        ...state,
        loadFailedAbsPath: action.payload.absPath,
        loadFailedSeq: state.loadFailedSeq + 1,
      };

    // **持ち越す欄が3つある。** `initialGameState` を展開するので、
    // ここに書かない欄は初期値へ戻る——**戻ってはいけない欄を足したら、ここも足すこと。**
    //
    // - `blockingWrites`: 棋譜を閉じるのは書き込みが走っている最中にも起こる
    //   （ワークスペースの切り替え）。0 に戻すと、まだ書いている最中に `isLoading` が落ちて
    //   確認ダイアログが押し直せる状態へ戻る
    // - `loadFailedSeq`: 単調増加（`game_loaded` と同じ理由）。戻すと、控えた値と同じ回数で
    //   別の失敗が観測され、待っている側が落ちた要求を捨てそこねる
    // - `boardSeq`: 単調増加。**ここでは進める**——盤の中身が空へ入れ替わったので、
    //   「まだ同じ棋譜か」を問う側は入れ替わりとして見る必要がある
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
