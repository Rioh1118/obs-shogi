// src/services/branch/BranchService.ts
import { JKFPlayer } from "json-kifu-format";
import type {
  IMoveFormat,
  IMoveMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import type {
  Pointer,
  Branch,
  NavigationState,
  BranchNavigationResult,
  ForkPointer,
  PreviewData,
} from "@/types/branchNav";

/**
 * 分岐取得・プレビュー生成・move系をまとめたサービス
 * 重要：JKFPlayer を動かす前に pointer.path を tesuu までで Trim する
 */
export class BranchService {
  constructor(private jkf: JKFPlayer) {}

  // -------------------------
  // Public APIs
  // -------------------------

  /** 指定 pointer（局面）から一手先の forks を取得 */
  getForks(pointer: Pointer): { branches: Branch[]; error?: string } {
    const safePtr = this.trimPathByTesuu(pointer);
    const bk = this.backup();

    try {
      this.jkf.goto(safePtr.tesuu, safePtr.path);

      const moves = this.jkf.currentStream;
      const next = moves[safePtr.tesuu + 1];
      const forks: IMoveFormat[][] = next?.forks ?? [];
      const branches = forks.map((mvArr, i) =>
        this.toBranch(mvArr, safePtr, i),
      );
      return { branches };
    } catch (e) {
      return { branches: [], error: String(e) };
    } finally {
      this.restore(bk);
    }
  }

  /** l キー相当：1手進む or 選択中の分岐へ入る */
  moveNext(
    state: NavigationState,
    branches: Branch[],
    maxTesuu: number,
  ): BranchNavigationResult {
    const { preview, selectedFork } = state;

    // 1) 選択中の分岐に入る
    if (selectedFork > 0) {
      const br = branches[selectedFork - 1];
      if (!br) return fail("選択された分岐が見つかりません");

      return ok({
        ...state,
        selectedFork: 0,
        preview: this.trimPathByTesuu({
          tesuu: br.startTesuu + 1, // 分岐1手目
          path: br.path,
        }),
      });
    }

    // 2) 分岐内 / 本筋で1手進む
    const safePtr = this.trimPathByTesuu(preview);
    const bk = this.backup();
    try {
      this.jkf.goto(safePtr.tesuu, safePtr.path);
      const canForward = this.jkf.tesuu + 1 <= maxTesuu;
      if (!canForward) return fail("終端です");

      // currentStream 長さに依存してチェックしたいならこちらでも OK
      // const moves = this.jkf.currentStream;
      // if (safePtr.tesuu + 1 >= moves.length) return fail("終端です");

      return ok({
        ...state,
        preview: this.trimPathByTesuu({
          tesuu: safePtr.tesuu + 1,
          path: safePtr.path,
        }),
      });
    } finally {
      this.restore(bk);
    }
  }

  /** h キー相当：1手戻る or 分岐から抜ける */
  movePrevious(state: NavigationState): BranchNavigationResult {
    const { preview } = state;
    if (preview.tesuu === 0 && preview.path.length === 0) return ok(state);

    const last = preview.path[preview.path.length - 1];
    if (last && preview.tesuu === last.te) {
      // 分岐直後に戻る => path を一段戻す
      const newPath = preview.path.slice(0, -1);
      return ok({
        ...state,
        selectedFork: 0,
        preview: this.trimPathByTesuu({
          tesuu: preview.tesuu - 1,
          path: newPath,
        }),
      });
    }

    return ok({
      ...state,
      preview: this.trimPathByTesuu({
        tesuu: preview.tesuu - 1,
        path: preview.path,
      }),
    });
  }

  /** Enter 相当：プレビュー位置を確定 */
  confirm(state: NavigationState): BranchNavigationResult {
    try {
      const p = this.trimPathByTesuu(state.preview);
      this.jkf.goto(p.tesuu, p.path);
      const t = this.jkf.tesuu;
      const newPath = this.jkf.getForkPointers() as ForkPointer[];
      return ok({
        current: { tesuu: t, path: newPath },
        preview: { tesuu: t, path: newPath },
        selectedFork: 0,
      });
    } catch (e) {
      return fail(String(e));
    }
  }

  /** 盤面プレビュー用の board/hands/tesuu を生成 */
  generatePreview(pointer: Pointer): PreviewData {
    const safePtr = this.trimPathByTesuu(pointer);
    const bk = this.backup();

    try {
      this.jkf.goto(safePtr.tesuu, safePtr.path);
      const st = this.jkf.getState();
      return { board: st.board, hands: st.hands, tesuu: this.jkf.tesuu };
    } finally {
      this.restore(bk);
    }
  }

  // -------------------------
  // Helpers
  // -------------------------

  /** tesuu 以降の path をトリムする */
  private trimPathByTesuu(p: Pointer): Pointer {
    const trimmedPath = p.path.filter((fp) => fp.te <= p.tesuu);
    return trimmedPath.length === p.path.length
      ? p
      : { tesuu: p.tesuu, path: trimmedPath };
  }

  private backup() {
    return {
      tesuu: this.jkf.tesuu,
      forks: this.jkf.getForkPointers(),
    };
  }
  private restore(bk: { tesuu: number; forks: ForkPointer[] }) {
    this.jkf.goto(bk.tesuu, bk.forks);
  }

  private toBranch(
    moves: IMoveFormat[],
    base: Pointer,
    forkIndex: number,
  ): Branch {
    return {
      id: `branch-${base.tesuu}-${forkIndex}`,
      startTesuu: base.tesuu,
      forkIndex,
      path: [...base.path, { te: base.tesuu + 1, forkIndex }],
      length: moves.length,
      moves,
      firstMove: moves[0]?.move as IMoveMoveFormat,
      description: moves[0]
        ? JKFPlayer.moveToReadableKifu(moves[0])
        : undefined,
    };
  }
}

// ---- Result helpers ----
function ok(newState: NavigationState): BranchNavigationResult {
  return { success: true, newState };
}
function fail(error: string): BranchNavigationResult {
  return { success: false, error };
}
