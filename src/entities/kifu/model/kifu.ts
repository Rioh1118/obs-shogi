import type { InitialPresetString, JKFState } from "./jkf";

export type KifuFormat = "jkf" | "kif" | "ki2" | "csa";

export interface KifuCreationOptions {
  fileName: string;
  format: KifuFormat;

  gameInfo: {
    black?: string;
    white?: string;
    date?: string;
    tags?: string[];
    note?: string;
  };

  initialPosition: {
    preset: InitialPresetString;
    data?: JKFState;
  };
}
