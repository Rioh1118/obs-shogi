import type { KifuFormat } from "@/types/kifu";

export function getKifuFormat(filePath: string): KifuFormat {
  const extension = filePath.toLowerCase().split(".").pop();

  switch (extension) {
    case "kif":
    case "kifu":
      return "kif";
    case "ki2":
      return "ki2";
    case "csa":
      return "csa";
    case "jkf":
      return "jkf";
    default:
      return "unknown";
  }
}

export function isKifuFile(filePath: string): boolean {
  return getKifuFormat(filePath) !== "unknown";
}
