import Modal from "../Modal";
import { useURLParams } from "@/hooks/useURLParams";
import { useState, useEffect, useCallback, useMemo } from "react";
import { JKFPlayer } from "json-kifu-format";
import PreviewPane from "./PreviewPane";
import BranchList from "./BranchList";
import "./PositionNavigationModal.scss";
import {
  type NavigationState,
  type BranchOption,
  type KifuCursor,
  type TesuuPointer,
} from "@/types";
import { useGame } from "@/contexts/GameContext";
import { appliedForkPointers } from "@/utils/kifuCursor";
import { buildNextOptions, buildPreviewData } from "@/utils/buildPreviewData";
import { removeForkPointer, upsertForkPointer } from "@/utils/kifuPlan";
import PositionNavigationHeader from "./PositionNavigationHeader";
import PositionNavigationFooter from "./PositionNavigationFooter";

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "navigation";

  const { state: gameState, applyCursor } = useGame();

  const [nav, setNav] = useState<NavigationState>({
    PreviewCursor: { tesuu: 0, forkPointers: [] },
    selectedBranchIndex: 0,
  });

  useEffect(() => {
    // 棋譜が切り替わったら、前棋譜の nav を捨てる
    if (!gameState.jkfPlayer) {
      setNav({
        PreviewCursor: { tesuu: 0, forkPointers: [] },
        selectedBranchIndex: 0,
      });
      return;
    }

    const cur = gameState.cursor;
    setNav({
      PreviewCursor: {
        tesuu: cur?.tesuu ?? 0,
        forkPointers: cur?.forkPointers ?? [],
      },
      selectedBranchIndex: 0,
    });
  }, [gameState.jkfPlayer, gameState.cursor]);

  useEffect(() => {
    if (!isOpen) return;

    const cur = gameState.cursor;
    setNav({
      PreviewCursor: {
        tesuu: cur?.tesuu ?? 0,
        forkPointers: cur?.forkPointers ?? [],
      },
      selectedBranchIndex: 0,
    });
  }, [isOpen, gameState.cursor]);

  const { previewData, options } = useMemo(() => {
    if (!isOpen || !gameState.jkfPlayer) {
      return { previewData: null, options: [] as BranchOption[] };
    }

    const sim = new JKFPlayer(gameState.jkfPlayer.kifu);
    sim.goto(
      nav.PreviewCursor.tesuu,
      appliedForkPointers(
        {
          ...nav.PreviewCursor,
          tesuuPointer: "0,[]" as TesuuPointer, // TODO: これは参照されない変数
        },
        nav.PreviewCursor.tesuu,
      ),
    );

    const opts = buildNextOptions(sim);

    const nodeId = sim.getTesuuPointer(nav.PreviewCursor.tesuu);
    const pd = buildPreviewData(sim, nodeId);

    return { previewData: pd, options: opts };
  }, [isOpen, gameState.jkfPlayer, nav.PreviewCursor]);

  const handleSelectBranch = useCallback(
    (delta: number) => {
      setNav((prev) => ({
        ...prev,
        selectedBranchIndex: Math.max(
          0,
          Math.min(options.length - 1, prev.selectedBranchIndex + delta),
        ),
      }));
    },
    [options.length],
  );

  const handleNext = useCallback(() => {
    if (options.length === 0) return;

    setNav((prev) => {
      const nextTe = prev.PreviewCursor.tesuu + 1;
      const sel = options[prev.selectedBranchIndex];
      if (!sel) return prev;

      let fps = prev.PreviewCursor.forkPointers;

      if (sel.isMainLine) {
        fps = removeForkPointer(fps, nextTe);
      } else {
        if (typeof sel.forkIndex === "number") {
          fps = upsertForkPointer(fps, nextTe, sel.forkIndex);
        }
      }
      return {
        PreviewCursor: { tesuu: nextTe, forkPointers: fps },
        selectedBranchIndex: 0,
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
        selectedBranchIndex: 0,
      };
    });
  }, []);

  const handleConfirm = useCallback(() => {
    if (!gameState.jkfPlayer) return;

    const sim = new JKFPlayer(gameState.jkfPlayer.kifu);
    sim.goto(
      nav.PreviewCursor.tesuu,
      appliedForkPointers(
        {
          ...nav.PreviewCursor,
          tesuuPointer: "0,[]" as TesuuPointer,
        },
        nav.PreviewCursor.tesuu,
      ),
    );

    const cursor: KifuCursor = {
      tesuu: nav.PreviewCursor.tesuu,
      forkPointers: nav.PreviewCursor.forkPointers,
      tesuuPointer: sim.getTesuuPointer(
        nav.PreviewCursor.tesuu,
      ) as TesuuPointer,
    };

    applyCursor(cursor);
    closeModal();
  }, [applyCursor, closeModal, gameState.jkfPlayer, nav.PreviewCursor]);

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
  }, [
    isOpen,
    handleNext,
    handlePrevious,
    handleSelectBranch,
    handleConfirm,
    closeModal,
  ]);

  const toKan = (k: string) => JKFPlayer.kindToKan(k as any) ?? k;

  // ---- render ----
  if (!isOpen) return null;

  return (
    <Modal onToggle={closeModal}>
      <div className="position-navigation-modal">
        <PositionNavigationHeader
          previewData={previewData}
          selectedBranchIndex={nav.selectedBranchIndex}
        />
        <div className="position-navigation-modal__content">
          <div className="position-navigation-modal__grid">
            <div className="position-navigation-modal__grid-left">
              <PreviewPane previewData={previewData} toKan={toKan} />
            </div>
            <div className="position-navigation-modal__grid-right">
              <BranchList
                branches={options}
                selectedIndex={nav.selectedBranchIndex}
                onSelectIndex={(idx) =>
                  setNav((s) => ({ ...s, selectedBranchIndex: idx }))
                }
              />
            </div>
          </div>
        </div>
        <PositionNavigationFooter />
      </div>
    </Modal>
  );
}

export default PositionNavigationModal;
