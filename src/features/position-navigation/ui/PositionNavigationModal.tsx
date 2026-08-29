import Modal from "@/shared/ui/Modal";
import { useURLParams } from "@/shared/lib/router/useURLParams";
import { useState, useEffect, useCallback, useMemo } from "react";
import { JKFPlayer } from "json-kifu-format";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import BranchList from "./BranchList";
import "./PositionNavigationModal.scss";
import { buildNextOptions } from "@/entities/kifu/lib/buildNextOptions";
import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import { truncatePlanFrom, upsertForkPointer } from "@/features/position-navigation/lib/kifuPlan";
import PositionNavigationHeader from "./PositionNavigationHeader";
import PositionNavigationFooter from "./PositionNavigationFooter";
import { useGame } from "@/entities/game";
import { normalizeForkPointers } from "@/entities/kifu/model/cursor";
import type { KifuCursor, TesuuPointer } from "@/entities/kifu/model/cursor";
import type { BranchOption } from "@/entities/kifu/model/branch";
import type { NavigationState } from "@/features/position-navigation/model/types";

/**
 * プレビュー用に棋譜を辿る。辿れなければ null。
 *
 * 盤上で再生できない手を含む棋譜（正規化に失敗して未正規化のまま開いたもの）では
 * `goto` が throw する。呼び出し側はレンダ中なので、ここで拾わないと画面が消える。
 */
function gotoPreview(
  player: JKFPlayer,
  cursor: NavigationState["PreviewCursor"],
): JKFPlayer | null {
  const sim = new JKFPlayer(player.kifu);
  try {
    sim.goto(cursor.tesuu, normalizeForkPointers(cursor.forkPointers, cursor.tesuu));
    return sim;
  } catch {
    return null;
  }
}

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "navigation";

  const { state: gameState, view: gameView, applyCursor } = useGame();

  const [nav, setNav] = useState<NavigationState>({
    PreviewCursor: { tesuu: 0, forkPointers: [] },
    selectedOptionIndex: 0,
  });

  useEffect(() => {
    // 棋譜が切り替わったら、前棋譜の nav を捨てる
    if (!gameView.player) {
      setNav({
        PreviewCursor: { tesuu: 0, forkPointers: [] },
        selectedOptionIndex: 0,
      });
      return;
    }

    const cur = gameState.cursor;
    setNav({
      PreviewCursor: {
        tesuu: cur?.tesuu ?? 0,
        forkPointers: cur?.forkPointers ?? [],
      },
      selectedOptionIndex: 0,
    });
  }, [gameView.player, gameState.cursor]);

  useEffect(() => {
    if (!isOpen) return;

    const cur = gameState.cursor;
    setNav({
      PreviewCursor: {
        tesuu: cur?.tesuu ?? 0,
        forkPointers: cur?.forkPointers ?? [],
      },
      selectedOptionIndex: 0,
    });
  }, [isOpen, gameState.cursor]);

  const { previewData, options, unreachable } = useMemo(() => {
    if (!isOpen || !gameView.player) {
      return { previewData: null, options: [] as BranchOption[], unreachable: false };
    }

    // 盤上で再生できない手を含む棋譜では goto が throw する。ここはレンダ中なので、
    // 拾わないと React が root ごと unmount してウィンドウが白紙になる。
    const sim = gotoPreview(gameView.player, nav.PreviewCursor);
    if (!sim) {
      return {
        previewData: null,
        options: [] as BranchOption[],
        unreachable: true,
      };
    }

    return {
      previewData: buildPreviewData(sim, sim.getTesuuPointer(nav.PreviewCursor.tesuu)),
      options: buildNextOptions(sim),
      unreachable: false,
    };
  }, [isOpen, gameView.player, nav.PreviewCursor]);

  const handleSelectBranch = useCallback(
    (delta: number) => {
      setNav((prev) => ({
        ...prev,
        selectedOptionIndex: Math.max(
          0,
          Math.min(options.length - 1, prev.selectedOptionIndex + delta),
        ),
      }));
    },
    [options.length],
  );

  const handleNext = useCallback(() => {
    if (options.length === 0) return;

    setNav((prev) => {
      const nextTe = prev.PreviewCursor.tesuu + 1;
      const sel = options[prev.selectedOptionIndex];
      if (!sel) return prev;

      // nextTe の選択を変える以上、その先の計画は捨てる。捨てないと、
      // 変化を見て戻って選び直したあとに、見ていない枝へ盤が進む。
      const fps = sel.isMainLine
        ? truncatePlanFrom(prev.PreviewCursor.forkPointers, nextTe)
        : upsertForkPointer(
            truncatePlanFrom(prev.PreviewCursor.forkPointers, nextTe),
            nextTe,
            sel.forkIndex,
          );
      return {
        PreviewCursor: { tesuu: nextTe, forkPointers: fps },
        selectedOptionIndex: 0,
      };
    });
  }, [options]);

  const handlePrevious = useCallback(() => {
    setNav((prev) => {
      if (prev.PreviewCursor.tesuu <= 0) return prev;
      return {
        PreviewCursor: {
          ...prev.PreviewCursor,
          tesuu: prev.PreviewCursor.tesuu - 1,
        },
        selectedOptionIndex: 0,
      };
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!gameView.player) return;

    const sim = gotoPreview(gameView.player, nav.PreviewCursor);
    if (!sim) return;

    const cursor: KifuCursor = {
      tesuu: nav.PreviewCursor.tesuu,
      forkPointers: nav.PreviewCursor.forkPointers,
      tesuuPointer: sim.getTesuuPointer(nav.PreviewCursor.tesuu) as TesuuPointer,
    };

    applyCursor(cursor);
    closeModal();
  }, [applyCursor, closeModal, gameView.player, nav.PreviewCursor]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const onKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();

      switch (e.key) {
        case "l":
        case "ArrowRight":
          handleNext();
          break;
        case "h":
        case "ArrowLeft":
          handlePrevious();
          break;
        case "j":
        case "ArrowDown":
          handleSelectBranch(1);
          break;
        case "k":
        case "ArrowUp":
          handleSelectBranch(-1);
          break;
        case "Enter":
          handleConfirm();
          break;
        case "Escape":
          closeModal();
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, handleNext, handlePrevious, handleSelectBranch, handleConfirm, closeModal]);

  // ---- render ----
  if (!isOpen) return null;

  return (
    <Modal
      onClose={closeModal}
      theme="light"
      variant="workspace"
      size="xl"
      chrome="none"
      padding="none"
      scroll="none"
    >
      <div className="position-navigation-modal">
        <PositionNavigationHeader
          previewData={previewData}
          selectedBranch={options[nav.selectedOptionIndex]}
        />
        <main className="position-navigation-modal__content">
          <div className="position-navigation-modal__grid">
            <div className="position-navigation-modal__grid-left">
              <PreviewPane previewData={previewData} />
            </div>
            <div className="position-navigation-modal__grid-right">
              {unreachable ? (
                <div className="branch-selector">
                  <div className="branch-selector__empty">
                    <p>
                      この棋譜は{nav.PreviewCursor.tesuu}
                      手目を盤上で再現できません。ここから先へは進めません。
                    </p>
                  </div>
                </div>
              ) : (
                <BranchList
                  branches={options}
                  selectedIndex={nav.selectedOptionIndex}
                  onSelectIndex={(idx) => setNav((s) => ({ ...s, selectedOptionIndex: idx }))}
                />
              )}
            </div>
          </div>
        </main>
        <PositionNavigationFooter />
      </div>
    </Modal>
  );
}

export default PositionNavigationModal;
