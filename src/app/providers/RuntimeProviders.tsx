import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GamePersistenceGate } from "./gates/GamePersistenceGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeBridge } from "./bridges/EngineRuntimeBridge";
import { EngineFailureBridge } from "./bridges/EngineFailureBridge";
import { SearchRootGate } from "./gates/SearchRootGate";
import { AnalysisBridge } from "./bridges/AnalysisBridge";
import { GameSessionBridge } from "./bridges/GameSessionBridge";
import { BoardOrientationBridge } from "./bridges/BoardOrientationBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";
import { BookPositionGate } from "./gates/BookPositionGate";

/**
 * `/app` の下でずっと生きている provider の入れ子と、スライス間の配線。
 *
 * **`gates/` と `bridges/` の基準:**
 * - `gates/` — 上位から取った値を、下位の provider に **prop で渡す器**。`children` を描く
 * - `bridges/` — 2つのスライスを **effect で繋ぐ**。`null` を返す
 *
 * `AnalysisBridge` と `EngineRuntimeBridge` は gate の形（値を prop で渡す器）だが
 * `bridges/` に居る。**基準に合っていない2つ**で、動かすと import が広く変わるため
 * ここでは揃えていない。→ `docs/IDEAS.md`
 */
export function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <FileTreeRootGate>
      {/*
        **いちばん外。** 対局はドックのタブより長生きで、棋譜が入れ替わっても走り続ける。
        棋譜の有無で畳まれる位置に置くと、裁定を返す者が居なくなって
        `RULING_TIMEOUT` で対局が中断される（`GameSessionProvider` の doc）
      */}
      <GameSessionBridge>
        <GamePersistenceGate>
          <StudyPositionsProvider>
            <EnginePresetsProvider>
              <EngineRuntimeBridge>
                <EngineFailureBridge />
                <SearchRootGate>
                  <AnalysisBridge>
                    <BoardOrientationBridge />
                    {/* 置き場の理由は `BookPositionGate` の doc */}
                    <BookPositionGate>{children}</BookPositionGate>
                  </AnalysisBridge>
                </SearchRootGate>
              </EngineRuntimeBridge>
            </EnginePresetsProvider>
          </StudyPositionsProvider>
        </GamePersistenceGate>
      </GameSessionBridge>
    </FileTreeRootGate>
  );
}
