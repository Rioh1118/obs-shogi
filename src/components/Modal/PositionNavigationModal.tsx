import Modal from "../Modal";
import { useURLParams } from "@/hooks/useURLParams";
import { useBranch } from "@/contexts/BranchContext";
import { useState, useEffect, useCallback, useMemo } from "react";
import { JKFPlayer } from "json-kifu-format";
import PreviewPane from "./PreviewPane";
import InfoBar from "./InfoBar";
import BranchList from "./BranchList";
import "./PositionNavigationModal.scss";
import type { PositionNode, PreviewData } from "@/types";
import { useGame } from "@/contexts/GameContext";
import { BranchPreviewService } from "@/services/branch/BranchPreviewService";
import { logDetailedTreeStructure, logTreeSummary } from "@/utils/debugTree";

export interface NavigationState {
  currentNodeId: string;
  previewNodeId: string;
  selectedBranchIndex: number;
}

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "navigation";
  const {
    state: branchState,
    goToNode,
    getCurrentNode,
    getNode,
    getChildrenNodes,
    getPathToNode,
  } = useBranch();

  const { state: gameState } = useGame();

  // BranchPreviewServiceの初期化
  const previewService = useMemo(() => {
    if (!gameState.jkfPlayer) return null;
    return new BranchPreviewService(new JKFPlayer(gameState.jkfPlayer.kifu));
  }, [gameState.jkfPlayer]);

  // ------ Navigation state ------
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentNodeId: "",
    previewNodeId: "",
    selectedBranchIndex: 0,
  });
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);

  // previewDataの生成
  useEffect(() => {
    if (!previewService) {
      setPreviewData(null);
      return;
    }

    const previewNode = getNode(navigationState.previewNodeId);
    if (!previewNode) {
      setPreviewData(null);
      return;
    }

    // ノードへのパスを取得
    const pathIds = getPathToNode(previewNode.id);
    const pathNodes = pathIds
      .map((id) => getNode(id))
      .filter((node): node is PositionNode => node !== undefined);

    // プレビューデータを生成
    const preview = previewService.generateNodePreview(previewNode, pathNodes);
    setPreviewData(preview);
  }, [navigationState.previewNodeId, previewService, getPathToNode, getNode]);

  // Initialize modal
  useEffect(() => {
    if (!isOpen) return;

    const currentNode = getCurrentNode();
    if (!currentNode) return;

    setNavigationState({
      currentNodeId: currentNode.id,
      previewNodeId: currentNode.id,
      selectedBranchIndex: 0,
    });
  }, [isOpen, getCurrentNode]);

  // Get available branches
  const availableBranches = getChildrenNodes(navigationState.previewNodeId);

  // log
  // ====================================
  useEffect(() => {
    if (!isOpen) return;
    console.log(
      "[Nav] previewNodeId=",
      navigationState.previewNodeId,
      "children=",
      availableBranches.map((b, i) => ({
        i,
        id: b.id,
        isMainLine: b.isMainLine,
        tesuu: b.tesuu,
        move: b.move,
      })),
    );
    // どこでもOK（ロード時など）
  }, [isOpen, navigationState.previewNodeId, availableBranches]);
  const logCurrentTreeState = useCallback(() => {
    if (process.env.NODE_ENV === "development") {
      console.group("📋 PositionNavigationModal - ツリー状態");

      // 簡潔サマリー
      logTreeSummary(
        branchState.nodes,
        branchState.rootNodeId,
        branchState.currentPosition.nodeId,
      );

      // 詳細ツリー構造（深度3まで）
      logDetailedTreeStructure(
        branchState.nodes,
        branchState.rootNodeId,
        branchState.currentPosition.nodeId,
        {
          maxDepth: 5,
          showMoveDetails: true,
          showFullNodeIds: false,
        },
      );

      // 現在の利用可能な手
      console.log("🎯 現在位置の利用可能な手:");
      branchState.availableMovesFromCurrent.forEach((move, index) => {
        console.log(
          `  ${index}: ${move.preview} [${move.nodeId.slice(-6)}] ${move.isMainLine ? "🏠" : "🌿"}`,
        );
      });

      console.groupEnd();
    }
  }, [branchState]);

  // モーダルが開いた時とツリーが更新された時にログ出力
  useEffect(() => {
    logCurrentTreeState();
  }, [branchState.nodes.size, branchState.currentPosition.nodeId]);
  const kifu = gameState.jkfPlayer?.kifu;
  console.log(kifu);
  // ====================================

  // Navigation handlers
  //

  // 0=本譜, 1..=変化Nに対して、そのままoptions[idx]を使用
  const options = useMemo(() => {
    const raw = getChildrenNodes(navigationState.previewNodeId);
    const main = raw.find((n) => n.isMainLine);
    const vars = raw.filter((n) => !n.isMainLine);
    return main ? [main, ...vars] : raw;
  }, [navigationState.previewNodeId, getChildrenNodes]);

  const handleNext = useCallback(() => {
    if (options.length === 0) return;
    const idx = navigationState.selectedBranchIndex;
    const target = options[idx];
    if (!target) return;

    setNavigationState((prev) => ({
      ...prev,
      previewNodeId: target.id,
      selectedBranchIndex: 0,
    }));
  }, [navigationState.selectedBranchIndex, options]);

  const handlePrevious = useCallback(() => {
    const node = getNode(navigationState.previewNodeId);
    if (node?.parentId) {
      setNavigationState((prev) => ({
        ...prev,
        previewNodeId: node.parentId!,
        selectedBranchIndex: 0,
      }));
    }
  }, [navigationState.previewNodeId, getNode]);

  const handleSelectBranch = useCallback(
    (delta: number) => {
      setNavigationState((prev) => ({
        ...prev,
        selectedBranchIndex: Math.max(
          0,
          Math.min(options.length - 1, prev.selectedBranchIndex + delta),
        ),
      }));
    },
    [options.length],
  );

  const handleConfirm = useCallback(() => {
    goToNode(navigationState.previewNodeId);
    closeModal();
  }, [navigationState.previewNodeId, goToNode, closeModal]);

  // Keyboard navigation
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
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

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
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
            branches={options}
            selectedIndex={navigationState.selectedBranchIndex}
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
