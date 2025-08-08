// services/branch/BranchCalculator.ts
import type {
  Branch,
  BranchMove,
  BranchCalculationResult,
} from "@/types/branchNav";
import type {
  IMoveMoveFormat,
  IMoveFormat,
} from "json-kifu-format/dist/src/Formats";
import { JKFPlayer } from "json-kifu-format";

export class BranchCalculator {
  constructor(private readonly jkf: JKFPlayer) {}

  /**
   * tesuu の “現在の currentStream” 上で forks を見る
   *  -> 分岐中でも正しいノードを参照できる
   */
  calculateBranchesAtTesuu(tesuu: number): BranchCalculationResult {
    if (!this.jkf) {
      return { branches: [], hasMore: false, error: "JKFPlayer not available" };
    }

    // ★ currentStream を使う
    const node: IMoveFormat | undefined = this.jkf.currentStream[tesuu + 1];
    const forks = node?.forks ?? [];
    if (forks.length === 0) {
      return { branches: [], hasMore: false };
    }

    const mainMove = node.move ?? null;
    const mainKey = mainMove ? moveKey(mainMove as IMoveMoveFormat) : null;

    const seen = new Set<string>();
    const branches: Branch[] = [];

    forks.forEach((stream, idx) => {
      // forks[0] が変化1 → realForkIndex = idx + 1
      const realForkIndex = idx + 1;
      const b = this.buildBranch(stream, realForkIndex, tesuu, mainKey, seen);
      if (b) branches.push(b);
    });

    return { branches, hasMore: false };
  }

  private buildBranch(
    stream: IMoveFormat[],
    realForkIndex: number,
    startTesuu: number,
    mainKey: string | null,
    seen: Set<string>,
  ): Branch | null {
    if (stream.length === 0 || !stream[0].move) return null;

    const first = stream[0].move as IMoveMoveFormat;
    const key = moveKey(first);
    if (mainKey && key === mainKey) return null;
    if (seen.has(key)) return null;
    seen.add(key);

    const moves: BranchMove[] = [];
    let t = startTesuu + 1;

    for (const m of stream) {
      if (!m.move) continue;
      moves.push({
        move: m.move,
        tesuu: t,
        description: readable(this.jkf, m.move as IMoveMoveFormat),
        _raw: { move: m.move },
      });
      t++;
    }

    return {
      id: `branch-${startTesuu}-${realForkIndex}`,
      startTesuu,
      length: moves.length,
      moves,
      firstMove: first,
      forkIndex: realForkIndex,
      forkPointers: {
        forkIndex: realForkIndex,
        moveIndex: 0,
      },
      stream,
    } as Branch;
  }
}

function moveKey(m: IMoveMoveFormat): string {
  return `${m.from?.x ?? "null"}-${m.from?.y ?? "null"}-${m.to?.x ?? "null"}-${m.to?.y ?? "null"}-${m.piece}-${m.promote ?? "null"}`;
}

function readable(jkf: JKFPlayer, m: IMoveMoveFormat): string {
  try {
    return JKFPlayer.moveToReadableKifu({ move: m });
  } catch {
    return String(m);
  }
}
