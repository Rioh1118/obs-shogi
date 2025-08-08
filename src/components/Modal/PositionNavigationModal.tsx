import Modal from "../Modal";
import { useURLParams } from "@/hooks/useURLParams";
import { useGame } from "@/contexts/GameContext";
import { useState, useEffect, useMemo } from "react";
import { JKFPlayer } from "json-kifu-format";
import PreviewPane from "./PreviewPane";
import InfoBar from "./InfoBar";
import BranchList from "./BranchList";
import useNavKeys from "./useNavKeys";
import { BranchService } from "@/services/branch/BranchService";
import type {
  NavigationState,
  Branch,
  PreviewData,
  Pointer,
} from "@/types/branchNav";
import "./PositionNavigationModal.scss";
import { branchesBrief, pointerStr, previewBrief, trace } from "./debug";

// ---- utils ----
const trimPathByTesuu = (p: Pointer): Pointer => {
  const path = p.path.filter((fp) => fp.te <= p.tesuu);
  return path.length === p.path.length ? p : { tesuu: p.tesuu, path };
};

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "navigation"; // ← 早期 return しない
  const { state: gameState, getCurrentMoveIndex, getTotalMoves } = useGame();

  // ------ state ------
  const [navigationState, setNavigationState] = useState<NavigationState>({
    current: { tesuu: 0, path: [] },
    preview: { tesuu: 0, path: [] },
    selectedFork: 0,
  });
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [effectiveTotalMoves, setEffectiveTotalMoves] = useState(0);

  // ------ services ------
  const branchService = useMemo(
    () => (gameState.jkfPlayer ? new BranchService(gameState.jkfPlayer) : null),
    [gameState.jkfPlayer],
  );

  // ------ init modal ------
  useEffect(() => {
    if (!isOpen || !gameState.jkfPlayer) return;
    const currentTesuu = getCurrentMoveIndex();
    const totalMoves = getTotalMoves();

    const forkPointers = gameState.jkfPlayer.getForkPointers() ?? [];
    setNavigationState({
      current: { tesuu: currentTesuu, path: forkPointers },
      preview: { tesuu: currentTesuu, path: forkPointers },
      selectedFork: 0,
    });
    setEffectiveTotalMoves(totalMoves);
    trace("MODAL:init", { currentTesuu, totalMoves, forkPointers });
  }, [isOpen, gameState.jkfPlayer, getCurrentMoveIndex, getTotalMoves]);

  // ------ pointer for list ------
  const listPointer = useMemo(
    () => trimPathByTesuu(navigationState.preview),
    [navigationState.preview],
  );

  // ------ branch list ------
  const viewBranches: Branch[] = useMemo(() => {
    if (!branchService) return [];
    const { branches } = branchService.getForks(listPointer);
    trace("BRANCHES: update", {
      listPointer: pointerStr(listPointer),
      branches: branchesBrief(branches),
    });
    return branchService.getForks(listPointer).branches;
  }, [branchService, listPointer]);

  // ------ preview ------
  useEffect(() => {
    if (!branchService || !isOpen) return;
    const id = setTimeout(() => {
      const p = branchService.generatePreview(navigationState.preview);
      setPreviewData(p);
      trace("PREVIEW:update", {
        previewPointer: pointerStr(navigationState.preview),
        preview: previewBrief(p),
      });
    }, 30);
    return () => clearTimeout(id);
  }, [branchService, navigationState.preview, isOpen]);

  // ------ confirm ------
  const confirm = () => {
    if (!branchService) return;
    const result = branchService.confirm(navigationState);
    if (result.success && result.newState) {
      setNavigationState(result.newState);
      closeModal();
    } else {
      console.error("❌ 局面確定失敗:", result.error);
    }
  };

  // ------ key handler ------
  useNavKeys({
    enabled: isOpen,
    branchService,
    navigationState,
    branches: viewBranches,
    effectiveTotalMoves,
    setNavigationState,
    onConfirm: confirm,
    onClose: closeModal,
  });

  const toKan = (k: string) => JKFPlayer.kindToKan(k as any) ?? k;

  // ---- render ----
  if (!isOpen) return null;

  return (
    <Modal onToggle={closeModal}>
      <div className="position-navigation-modal">
        <div className="position-navigation-modal__header">
          <h2 className="position-navigation-modal__title">
            局面ナビゲーション
          </h2>
          <p className="position-navigation-modal__subtitle">
            nvim風操作で高速ナビゲーション
          </p>
        </div>

        <div className="position-navigation-modal__content">
          <PreviewPane previewData={previewData} toKan={toKan} />
          <InfoBar
            navigationState={navigationState}
            previewData={previewData}
          />

          <BranchList
            key={`${listPointer.tesuu}-${navigationState.preview.path.length}-${navigationState.selectedFork}`}
            branches={viewBranches}
            selectedFork={navigationState.selectedFork}
            activePath={navigationState.preview.path}
            setNavigationState={setNavigationState}
          />
        </div>

        <div className="position-navigation-modal__footer">
          <div className="position-navigation-modal__shortcuts">
            <span>[h/l] 手順移動/分岐移動</span>
            <span>[j/k] 分岐選択</span>
            <span>[Enter] 確定</span>
            <span>[Esc] キャンセル</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default PositionNavigationModal;
