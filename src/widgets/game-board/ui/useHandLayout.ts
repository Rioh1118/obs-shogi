import { useMemo } from "react";
import { Piece } from "shogi.js";

interface HandPiece {
  kind: string;
  count: number;
}

export interface LayoutConfig {
  maxPiecesPerRow: number;
  pieceSize: number;
  gap: number;
}

// getDynamicRowConfigの戻り値の型を定義
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

// layoutConfigにgetRowConfigメソッドを追加した型
interface ExtendedLayoutConfig extends LayoutConfig {
  getRowConfig: (pieces: string[]) => RowConfig;
}

// 持ち駒を種類別に整理
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

// スカスカ度合いを考慮したサイズ設定
function getLayoutConfig(
  totalPieces: number,
  maxPiecesInAnyRow: number,
): LayoutConfig {
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

// 4段に適切に分散させる配置アルゴリズム
function arrangeHandPieces(
  organizedPieces: HandPiece[],
  layoutConfig: LayoutConfig,
): ArrangedPieces {
  const { maxPiecesPerRow } = layoutConfig;

  // 駒の序列順に配置
  const pieceOrder = ["HI", "KA", "KI", "GI", "KY", "KE", "FU"];

  // 序列順に駒を配列に展開
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
    // 1段に収まる場合は適切な段に配置
    const hasHighRank = organizedPieces.some((p) =>
      ["HI", "KA"].includes(p.kind),
    );
    const hasMidRank = organizedPieces.some((p) =>
      ["KI", "GI"].includes(p.kind),
    );
    const hasLowRank = organizedPieces.some((p) =>
      ["KY", "KE"].includes(p.kind),
    );

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
    // 複数段に分散
    const rows = ["row1", "row2", "row3", "row4"] as const;
    const idealPiecesPerRow = Math.ceil(totalPieces / 4);
    const targetDistribution = Math.min(idealPiecesPerRow, maxPiecesPerRow);

    let currentRowIndex = 0;
    let currentRowCount = 0;

    allPieces.forEach((piece) => {
      if (
        currentRowCount >= targetDistribution &&
        currentRowIndex < rows.length - 1
      ) {
        currentRowIndex++;
        currentRowCount = 0;
      }

      result[rows[currentRowIndex]].push(piece);
      currentRowCount++;
    });
  }

  return result;
}

// 各行の駒数をチェックして動的にサイズ調整
function getDynamicRowConfig(
  pieces: string[],
  layoutConfig: LayoutConfig,
): RowConfig {
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

  const containerWidth = 18; // rem
  const maxWidth = containerWidth * 0.95;
  const totalPieceWidth = pieceCount * layoutConfig.pieceSize;
  const totalGapWidth = (pieceCount - 1) * layoutConfig.gap;
  const requiredWidth = totalPieceWidth + totalGapWidth;

  if (requiredWidth <= maxWidth) {
    return { pieceSize: layoutConfig.pieceSize, gap: layoutConfig.gap };
  } else {
    const scaleFactor = maxWidth / requiredWidth;
    const minPieceSize = 2.8;
    const adjustedPieceSize = Math.max(
      layoutConfig.pieceSize * scaleFactor,
      minPieceSize,
    );

    return {
      pieceSize: adjustedPieceSize,
      gap: layoutConfig.gap * scaleFactor,
    };
  }
}

export function useHandLayout(handPieces: Piece[]) {
  return useMemo(() => {
    const organizedPieces = organizeHandPieces(handPieces);
    const totalPieces = organizedPieces.reduce(
      (sum, piece) => sum + piece.count,
      0,
    );

    // 仮配置して最大行の駒数を計算
    const tempLayoutConfig = getLayoutConfig(totalPieces, 10);
    const tempArranged = arrangeHandPieces(organizedPieces, tempLayoutConfig);
    const maxPiecesInAnyRow = Math.max(
      tempArranged.row1.length,
      tempArranged.row2.length,
      tempArranged.row3.length,
      tempArranged.row4.length,
    );

    // 実際のレイアウト設定
    const layoutConfig = getLayoutConfig(totalPieces, maxPiecesInAnyRow);
    const arrangedPieces = arrangeHandPieces(organizedPieces, layoutConfig);

    const extendedLayoutConfig: ExtendedLayoutConfig = {
      ...layoutConfig,
      getRowConfig: (pieces: string[]) =>
        getDynamicRowConfig(pieces, layoutConfig),
    };

    return {
      arrangedPieces,
      layoutConfig: extendedLayoutConfig,
    };
  }, [handPieces]);
}
