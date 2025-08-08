// services/branch/PreviewController.ts
import type { JKFPlayer } from "json-kifu-format";
import type { Color, Piece } from "shogi.js";
import type { Branch, NavigationState, PreviewData } from "@/types/branchNav";

export class PreviewController {
  constructor(private readonly jkf: JKFPlayer) {}

  generatePreviewData(
    navState: NavigationState,
    previewBranches: Branch[],
  ): PreviewData | null {
    if (!this.jkf) return null;

    const { preview, activeBranch } = navState;

    const originalTesuu = this.jkf.tesuu;
    const originalForks = this.jkf.getForkPointers();

    try {
      if (preview.branchIndex === 0) {
        this.jkf.goto(preview.tesuu);
      } else {
        this.gotoBranch(preview, activeBranch, previewBranches);
      }

      const board = this.extractBoard();
      const hands = this.extractHands();
      const turn = this.jkf.shogi.turn;
      const tesuu = this.jkf.tesuu;

      return { board, hands, turn, tesuu };
    } finally {
      this.jkf.goto(originalTesuu, originalForks);
    }
  }

  private gotoBranch(
    preview: NavigationState["preview"],
    activeBranch: Branch | null,
    previewBranches: Branch[],
  ) {
    const br = activeBranch ?? previewBranches[0]; // ★ previewBranches は 1本だけ渡す設計
    if (!br) throw new Error("Invalid branch");

    this.jkf.goto(br.startTesuu);
    this.jkf.forkAndForward(br.forkPointers.forkIndex);

    const steps = Math.min(preview.branchSteps, br.length - 1);
    for (let i = 0; i < steps; i++) {
      if (!this.jkf.forward()) break;
    }
  }

  private extractBoard(): (Piece | null)[][] {
    const b: (Piece | null)[][] = Array.from({ length: 9 }, () =>
      Array<Piece | null>(9).fill(null),
    );
    for (let x = 1; x <= 9; x++) {
      for (let y = 1; y <= 9; y++) {
        b[x - 1][y - 1] = (this.jkf as any).shogi.get(x, y) ?? null;
      }
    }
    return b;
  }

  private extractHands(): { [key in Color]: string[] } {
    const result: { [key in Color]: string[] } = { 0: [], 1: [] };
    const hands = (this.jkf as any).shogi.hands as Record<
      Color,
      Array<{ kind: string }>
    >;
    (Object.keys(hands) as unknown as Color[]).forEach((c) => {
      result[c] = hands[c].map((p) => p.kind);
    });
    return result;
  }

  // services/branch/PreviewController.ts 末尾付近に追加
  /**
   * 分岐計算用: navState.preview の地点へ JKF を進めるだけ
   */
  gotoBranchForCalc(navState: NavigationState) {
    const { preview, activeBranch } = navState;
    if (preview.branchIndex === 0) {
      this.jkf.goto(preview.tesuu);
      return;
    }
    this.gotoBranch(preview, activeBranch, []);
  }
}
