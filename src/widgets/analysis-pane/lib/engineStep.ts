import type { EngineStatus } from "@/entities/analysis";

/**
 * 次の一手が、▶ と ■ のほかの語のボタンになるか（再起動、もう一度起動、設定を開く、起動を中止）。
 *
 * 語のボタンは記号より幅があるので、操作列の左端に置く。▶ の位置に置くと、
 * 状態が変わるたびに左の記号が動く。
 */
export function isTextStep(status: EngineStatus, slowStart: boolean): boolean {
  switch (status) {
    case "exited":
    case "unresponsive":
    case "failed":
    case "cancelled":
      return true;
    case "starting":
      return slowStart;
    default:
      return false;
  }
}
