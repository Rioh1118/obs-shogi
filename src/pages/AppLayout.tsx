import { useState } from "react";
import { Outlet } from "react-router";
import Sidebar from "@/widgets/sidebar/ui/Sidebar";
import GameBoard from "@/widgets/game-board/ui/GameBoard";
import Board from "@/widgets/game-board/ui/Board";
import Hand from "@/widgets/game-board/ui/Hand";

import "./AppLayout.scss";
import WelcomeScreen from "@/pages/WelcomeScreen";
import AppModalLayer from "@/pages/AppModalLayer";

import AnalysisPane from "@/widgets/analysis-pane/ui/AnalysisPane";
import AppLayoutHeader from "@/widgets/app-layout-header/ui/AppLayoutHeader";
import KifuStreamList from "@/widgets/kifu-stream/ui/KifuStreamList";
import { useGame } from "@/entities/game";
import GameControls from "@/widgets/game-board/ui/GameControls";
import { useClearBoardSelection } from "@/features/clear-board-selection";
import { AppErrorBoundary, RETRY_LABEL } from "@/shared/ui/AppErrorBoundary";

const AppLayout = () => {
  // 開閉は持ち越さない。**起動のたびに開いた状態で始まる**のが既定で、これは意匠。
  // どのパネルを出すかは URL（`panel/*`）が持つが、開閉はそちらへ揃えない
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const { view: gameView } = useGame();

  const toggleSidebar = () => setIsSidebarOpen((v) => !v);

  // 「棋譜が無ければ WelcomeScreen、あれば作業面」は画面全体の切り替えなので、
  // 判断はここに置く。**何をもって「ある」とするかは game が決める**
  const { hasKifu } = gameView;

  // 「盤の外」は盤より広い範囲を見ないと判定できないので、捕まえるのはここ。
  // 何が盤の内側かは feature が知っている
  const onPointerDownCapture = useClearBoardSelection();

  return (
    <div
      className={`app-layout ${isSidebarOpen ? "" : "app-layout--sidebar-closed"}`}
      onPointerDownCapture={onPointerDownCapture}
    >
      {/*
        モーダル1枚の事故で本体まで unmount させない。**境界は `AppModalLayer` の中にある**
        （鍵を読むために、ここが `FileTreeContext` を購読しないため）。

        **`.app-layout` は `grid-template-rows` が2段で、ヘッダと本体でちょうど埋まっている。**
        ここに置けるのは、この層が平常時 in-flow の子を1つも作らないから。
        その条件は `pages/AppModalLayer.tsx` の `ModalLayerContent` が持つ
      */}
      <AppModalLayer />

      <AppLayoutHeader toggleSidebar={toggleSidebar} isSidebarOpen={isSidebarOpen} />

      <div className="app-layout__body">
        <aside className="app-layout__sidebar-slot">
          {/* `panel/*` のルートがここに入る。行き先は AppRouter を見る */}
          <Sidebar isOpen={isSidebarOpen}>
            <Outlet />
          </Sidebar>
        </aside>
        <main className="app-layout__main">
          {!hasKifu ? (
            <div className="app-layout__empty">
              <WelcomeScreen />
            </div>
          ) : (
            <div className="workspace">
              <div className="workspace__surface">
                <section className="workspace__main">
                  <div className="workspace__boardPane">
                    {/*
                      盤は局面から駒の配置を組み直すので、棋譜が壊れていれば描く前に落ちる。
                      畳むのは盤と操作列だけで、棋譜一覧と解析は残す
                    */}
                    <AppErrorBoundary
                      label="盤"
                      // 同じ棋譜をツリーで押しても `openKifuNode` は走らない
                      // （`FileNode` の `isActive` の関門）。効くのは別の棋譜を開くこと
                      hint={`別の棋譜を開いてから「${RETRY_LABEL}」を押してください。`}
                    >
                      <GameBoard
                        topLeft={<Hand isSente={false} />}
                        center={<Board />}
                        bottomRight={<Hand isSente={true} />}
                      />
                      <div className="workspace__controls">
                        <GameControls />
                      </div>
                    </AppErrorBoundary>
                  </div>
                  <aside className="workspace__kifuPane">
                    {/*
                      `buildStreamRowsFromCursor` は盤上で再生できない手で投げる（→ #277。症状は #295 の本文）。
                      畳むのは一覧だけで、盤と解析は残す
                    */}
                    <AppErrorBoundary
                      label="棋譜一覧"
                      hint={`別の棋譜を開いてから「${RETRY_LABEL}」を押してください。`}
                    >
                      <KifuStreamList />
                    </AppErrorBoundary>
                  </aside>
                </section>

                <section className="workspace__dock">
                  {/*
                    エンジンの応答は形が保証されていないので、描く段で落ちうる。
                    畳むのはドックの中だけで、盤と棋譜一覧は残す
                  */}
                  <AppErrorBoundary
                    label="解析"
                    hint={`設定からエンジンを選び直してから「${RETRY_LABEL}」を押してください。`}
                  >
                    <AnalysisPane />
                  </AppErrorBoundary>
                </section>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
