import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GameMoveGate } from "./gates/GameMoveGate";
import { EnginePresetsProvider } from "@/entities/engine-presets";
import { EngineRuntimeGate } from "./gates/EngineRuntimeGate";
import { EngineFailureBridge } from "./bridges/EngineFailureBridge";
import { EngineStartWarningBridge } from "./bridges/EngineStartWarningBridge";
import { PresetsFileBridge } from "./bridges/PresetsFileBridge";
import { SearchRootGate } from "./gates/SearchRootGate";
import { AnalysisPositionSyncGate } from "./gates/AnalysisPositionSyncGate";
import { AnalysisRefusalBridge } from "./bridges/AnalysisRefusalBridge";
import { GameSessionRulingGate } from "./gates/GameSessionRulingGate";
import { BoardOrientationBridge } from "./bridges/BoardOrientationBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";
import { BookPositionGate } from "./gates/BookPositionGate";

/**
 * `/app` の下でずっと生きている provider の入れ子と、スライス間の配線。
 *
 * `gates/` と `bridges/` は次の基準で分ける。
 * - `gates/` — 上位から取った値を、下位の provider に prop で渡すラッパー。`children` を描く
 * - `bridges/` — 2つのスライスを effect で繋ぐ。`null` を返す
 */
export function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <FileTreeRootGate>
      {/*
        対局の進行は、棋譜のラッパー（`GameMoveGate`）より外に置く。対局はドックのタブより長生きで、
        棋譜が入れ替わっても走り続ける。棋譜の有無で unmount される位置に置くと、裁定を返す者が
        居なくなって `RULING_TIMEOUT` で対局が終わる（`GameSessionProvider` の doc）
      */}
      <GameSessionRulingGate>
        <GameMoveGate>
          <StudyPositionsProvider>
            <EnginePresetsProvider>
              <PresetsFileBridge />
              <EngineRuntimeGate>
                <EngineFailureBridge />
                <EngineStartWarningBridge />
                <SearchRootGate>
                  <AnalysisPositionSyncGate>
                    <AnalysisRefusalBridge />
                    <BoardOrientationBridge />
                    {/* 置き場の理由は `BookPositionGate` の doc */}
                    <BookPositionGate>{children}</BookPositionGate>
                  </AnalysisPositionSyncGate>
                </SearchRootGate>
              </EngineRuntimeGate>
            </EnginePresetsProvider>
          </StudyPositionsProvider>
        </GameMoveGate>
      </GameSessionRulingGate>
    </FileTreeRootGate>
  );
}
