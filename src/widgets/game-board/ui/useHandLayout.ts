import { useMemo } from "react";
import { Piece } from "shogi.js";

interface HandPiece {
  kind: string;
  count: number;
}

interface LayoutConfig {
  maxPiecesPerRow: number;
  pieceSize: number;
  gap: number;
}

export interface RowConfig {
  pieceSize: number;
  gap: number;
}

interface ArrangedPieces {
  row1: string[];
  row2: string[];
  row3: string[];
  row4: string[];
}

interface ExtendedLayoutConfig extends LayoutConfig {
  getRowConfig: (pieces: string[]) => RowConfig;
}

/** 持ち駒を種類ごとの枚数にまとめる */
function organizeHandPieces(pieces: Piece[]): HandPiece[] {
  const pieceCount: { [key: string]: number } = {};

  pieces.forEach((piece) => {
    pieceCount[piece.kind] = (pieceCount[piece.kind] || 0) + 1;
  });

  return Object.entries(pieceCount).map(([kind, count]) => ({
    kind,
    count,
  }));
}

/**
 * 1段の上限と駒の大きさを、駒の総数で決める。
 *
 * いちばん多い段の枚数が、均した枚数（総数÷4）に比べて大きく偏っているとき
 * （比が 0.6 未満）は、6枚以下と同じ大きさにする。
 */
function getLayoutConfig(totalPieces: number, maxPiecesInAnyRow: number): LayoutConfig {
  const idealDensity = totalPieces / 4;
  const actualDensity = maxPiecesInAnyRow;
  const sparseness = idealDensity / Math.max(actualDensity, 1);

  if (totalPieces <= 6 || sparseness < 0.6) {
    return {
      maxPiecesPerRow: 4,
      pieceSize: 4.5,
      gap: 0.4,
    };
  } else if (totalPieces <= 10) {
    return {
      maxPiecesPerRow: 5,
      pieceSize: 4.0,
      gap: 0.3,
    };
  } else if (totalPieces <= 15) {
    return {
      maxPiecesPerRow: 6,
      pieceSize: 3.6,
      gap: 0.25,
    };
  } else {
    return {
      maxPiecesPerRow: 7,
      pieceSize: 3.2,
      gap: 0.2,
    };
  }
}

/**
 * 持ち駒を強い順に4段へ割り振る。
 *
 * 1段に収まるなら、いちばん強い駒の格の段（飛角、金銀、香桂、歩）に置く。
 * 収まらなければ上の段から同じ枚数ずつ詰め、余りは最後の段に寄せる。
 */
function arrangeHandPieces(
  organizedPieces: HandPiece[],
  layoutConfig: LayoutConfig,
): ArrangedPieces {
  const { maxPiecesPerRow } = layoutConfig;

  const pieceOrder = ["HI", "KA", "KI", "GI", "KY", "KE", "FU"];

  const allPieces: string[] = [];
  pieceOrder.forEach((pieceType) => {
    const piece = organizedPieces.find((p) => p.kind === pieceType);
    if (piece) {
      for (let i = 0; i < piece.count; i++) {
        allPieces.push(pieceType);
      }
    }
  });

  const totalPieces = allPieces.length;

  const result: ArrangedPieces = {
    row1: [],
    row2: [],
    row3: [],
    row4: [],
  };

  if (totalPieces <= maxPiecesPerRow) {
    const hasHighRank = organizedPieces.some((p) => ["HI", "KA"].includes(p.kind));
    const hasMidRank = organizedPieces.some((p) => ["KI", "GI"].includes(p.kind));
    const hasLowRank = organizedPieces.some((p) => ["KY", "KE"].includes(p.kind));

    if (hasHighRank) {
      result.row1 = allPieces;
    } else if (hasMidRank) {
      result.row2 = allPieces;
    } else if (hasLowRank) {
      result.row3 = allPieces;
    } else {
      result.row4 = allPieces;
    }
  } else {
    const rows = ["row1", "row2", "row3", "row4"] as const;
    const idealPiecesPerRow = Math.ceil(totalPieces / 4);
    const targetDistribution = Math.min(idealPiecesPerRow, maxPiecesPerRow);

    let currentRowIndex = 0;
    let currentRowCount = 0;

    allPieces.forEach((piece) => {
      if (currentRowCount >= targetDistribution && currentRowIndex < rows.length - 1) {
        currentRowIndex++;
        currentRowCount = 0;
      }

      result[rows[currentRowIndex]].push(piece);
      currentRowCount++;
    });
  }

  return result;
}

/**
 * 1段の駒の大きさと間隔。
 *
 * 3枚までの段は1割大きくする。並べた幅が上限を超える段は縮め、駒は 2.8 より小さくしない。
 */
function getDynamicRowConfig(pieces: string[], layoutConfig: LayoutConfig): RowConfig {
  const pieceCount = pieces.length;

  if (pieceCount === 0) {
    return { pieceSize: layoutConfig.pieceSize, gap: layoutConfig.gap };
  }

  if (pieceCount <= 3) {
    return {
      pieceSize: layoutConfig.pieceSize * 1.1,
      gap: layoutConfig.gap * 1.2,
    };
  }

  // `Hand` は駒の大きさを em で当てる。駒台の幅は 20em（`handGeometry.scss` の `$hand-w`）
  const containerWidth = 18;
  const maxWidth = containerWidth * 0.95;
  const totalPieceWidth = pieceCount * layoutConfig.pieceSize;
  const totalGapWidth = (pieceCount - 1) * layoutConfig.gap;
  const requiredWidth = totalPieceWidth + totalGapWidth;

  if (requiredWidth <= maxWidth) {
    return { pieceSize: layoutConfig.pieceSize, gap: layoutConfig.gap };
  } else {
    const scaleFactor = maxWidth / requiredWidth;
    const minPieceSize = 2.8;
    const adjustedPieceSize = Math.max(layoutConfig.pieceSize * scaleFactor, minPieceSize);

    return {
      pieceSize: adjustedPieceSize,
      gap: layoutConfig.gap * scaleFactor,
    };
  }
}

export function useHandLayout(handPieces: Piece[]) {
  return useMemo(() => {
    const organizedPieces = organizeHandPieces(handPieces);
    const totalPieces = organizedPieces.reduce((sum, piece) => sum + piece.count, 0);

    // 段の偏りは並べてみないと分からないので、仮の上限で一度並べ、
    // いちばん多い段の枚数から上限を決め直す
    const tempLayoutConfig = getLayoutConfig(totalPieces, 10);
    const tempArranged = arrangeHandPieces(organizedPieces, tempLayoutConfig);
    const maxPiecesInAnyRow = Math.max(
      tempArranged.row1.length,
      tempArranged.row2.length,
      tempArranged.row3.length,
      tempArranged.row4.length,
    );

    const layoutConfig = getLayoutConfig(totalPieces, maxPiecesInAnyRow);
    const arrangedPieces = arrangeHandPieces(organizedPieces, layoutConfig);

    const extendedLayoutConfig: ExtendedLayoutConfig = {
      ...layoutConfig,
      getRowConfig: (pieces: string[]) => getDynamicRowConfig(pieces, layoutConfig),
    };

    return {
      arrangedPieces,
      layoutConfig: extendedLayoutConfig,
    };
  }, [handPieces]);
}
