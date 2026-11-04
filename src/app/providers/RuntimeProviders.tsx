import type { ReactNode } from "react";
import { FileTreeRootGate } from "./gates/FileTreeRootGate";
import { GameMoveGate } from "./gates/GameMoveGate";
import { EnginePresetsProvider } from "@/entities/engine-presets/model/provider";
import { EngineRuntimeGate } from "./bridges/EngineRuntimeGate";
import { EngineFailureBridge } from "./bridges/EngineFailureBridge";
import { EngineStartWarningBridge } from "./bridges/EngineStartWarningBridge";
import { PresetsFileBridge } from "./bridges/PresetsFileBridge";
import { SearchRootGate } from "./gates/SearchRootGate";
import { AnalysisPositionSyncGate } from "./bridges/AnalysisPositionSyncGate";
import { AnalysisRefusalBridge } from "./bridges/AnalysisRefusalBridge";
import { GameSessionRulingGate } from "./bridges/GameSessionRulingGate";
import { BoardOrientationBridge } from "./bridges/BoardOrientationBridge";
import { StudyPositionsProvider } from "@/entities/study-positions/model/provider";
import { BookPositionGate } from "./gates/BookPositionGate";

/**
 * `/app` の下でずっと生きている provider の入れ子と、スライス間の配線。
 *
 * `gates/` と `bridges/` は次の基準で分ける。
 * - `gates/` — 上位から取った値を、下位の provider に prop で渡す器。`children` を描く
 * - `bridges/` — 2つのスライスを effect で繋ぐ。`null` を返す
 *
 * `AnalysisPositionSyncGate` `EngineRuntimeGate` `GameSessionRulingGate` は gate の形
 * （値を prop で渡す器）だが `bridges/` に居る。基準に合っていないもので、
 * 動かすと import が広く変わるためここでは揃えていない。→ `docs/IDEAS.md`
 *
 * **数を書かない。** 書くと、次に器を足した人が「自分は例外か数え忘れか」を
 * 判定できないまま、数だけが古くなる。
 */
export function RuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <FileTreeRootGate>
      {/*
        対局の進行は、棋譜の器（`GameMoveGate`）より外に置く。対局はドックのタブより長生きで、
        棋譜が入れ替わっても走り続ける。棋譜の有無で畳まれる位置に置くと、裁定を返す者が
        居なくなって `RULING_TIMEOUT` で対局が畳まれる（`GameSessionProvider` の doc）
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
