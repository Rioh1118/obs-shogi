import type { Kind } from "shogi.js";

export class PieceUtils {
  static isPromotedPiece(kind: Kind): boolean {
    const promotedPieces: Kind[] = ["TO", "NY", "NK", "NG", "UM", "RY"];
    return promotedPieces.includes(kind);
  }

  static getPromotedKind(originalKind: Kind): Kind {
    const promotionMap: Record<string, Kind> = {
      FU: "TO", // 歩 → と金
      KY: "NY", // 香 → 成香
      KE: "NK", // 桂 → 成桂
      GI: "NG", // 銀 → 成銀
      KA: "UM", // 角 → 馬
      HI: "RY", // 飛 → 龍
    };
    return promotionMap[originalKind] || originalKind;
  }

  static getOriginalKind(promotedKind: Kind): Kind {
    const demotionMap: Record<string, Kind> = {
      TO: "FU", // と金 → 歩
      NY: "KY", // 成香 → 香
      NK: "KE", // 成桂 → 桂
      NG: "GI", // 成銀 → 銀
      UM: "KA", // 馬 → 角
      RY: "HI", // 龍 → 飛
    };
    return demotionMap[promotedKind] || promotedKind;
  }
}
