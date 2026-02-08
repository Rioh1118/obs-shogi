export type EngineConfig = {
  aiRoot: string | null; // ApConfigからくる
  selectedAiName: string | null; // hao/li
  selectedEngineRel: string | null; // 例: "YaneuraOu_..._APPLEM1" (ai_root/engines配下)

  evalDirName: string; // default: "eval"
  bookDirName: string; // default: "book"
  bookFileName: string; // default: "user_book"

  // USI setoption(解析向け)
  options: Record<string, string>;
};

export type EnginePhase =
  | "unconfigured"
  | "configured"
  | "initializing"
  | "ready"
  | "error";
