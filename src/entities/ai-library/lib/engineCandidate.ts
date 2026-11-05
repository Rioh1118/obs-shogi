import type { EngineCandidate } from "../api/aiLibrary";

/**
 * このマシンで使うエンジンとして数えるか。「検出済み」の件数と、プリセット編集で選べるか
 * （`isSelectableEngine`）はこれで決める。プリセット編集の候補に並べるかは決めない
 * （選べないものも理由を添えて並ぶ）。
 *
 * `wrongPlatform`（別の OS 向け）と `unreadable`（読めず、実行ファイルかどうかも判らない）は
 * 数えない。数えると、置いたのが Windows 版だけでも「検出済み」になり、プリセットで選べて
 * 起動して初めて失敗する。`notExecutable` / `quarantined` は利用者が直せば動くので数える。
 * 直さずに起動すれば、起動の失敗の帯が確かめる場所を言う（`quarantined` は macOS の許可、
 * それ以外は場所か実行権限）
 */
export function isEngineForThisMachine(candidate: EngineCandidate): boolean {
  return candidate.launchability !== "wrongPlatform" && candidate.launchability !== "unreadable";
}
