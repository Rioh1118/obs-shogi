import type { EngineCandidate } from "../api/aiLibrary";

/**
 * このマシンで使うエンジンとして数えるか。「検出済み」の件数とプリセットの候補はこれで決める。
 *
 * `wrongPlatform`（別の OS 向け）と `unreadable`（読めず、実行ファイルかどうかも判らない）は
 * 数えない。数えると、置いたのが Windows 版だけでも「検出済み」になり、プリセットで選べて
 * 起動して初めて失敗する。`notExecutable` / `quarantined` は利用者が直せば動くので数える
 */
export function isEngineForThisMachine(candidate: EngineCandidate): boolean {
  return candidate.launchability !== "wrongPlatform" && candidate.launchability !== "unreadable";
}
