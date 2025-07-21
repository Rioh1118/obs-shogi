import Modal from "../Modal";
import { useURLParams } from "@/hooks/useURLParams";
import { useGame } from "@/contexts/GameContext";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import BoardPreview from "../GameBoard/Board/BoardPreview";
import { Color, Piece } from "shogi.js";
import { BranchService } from "@/services/branch/BranchService";
import type { NavigationState, Branch, PreviewData } from "@/types/branch";
import "./PositionNavigationModal.scss";

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const { state: gameState, getCurrentMoveIndex, getTotalMoves } = useGame();

  // 新しい設計に基づく状態管理
  const [navigationState, setNavigationState] = useState<NavigationState>({
    currentTesuu: 0,
    selectedBranchIndex: 0,
    preview: {
      tesuu: 0,
      branchIndex: 0,
      branchSteps: 0,
    },
  });

  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [effectiveTotalMoves, setEffectiveTotalMoves] = useState(0);

  const branchSelectorRef = useRef<HTMLDivElement>(null);

  // BranchServiceのインスタンス（参照の安定性を保つ）
  const branchService = useMemo(() => {
    if (!gameState.jkfPlayer) return null;
    return new BranchService(gameState.jkfPlayer);
  }, [gameState.jkfPlayer]);

  // モーダル初期化
  useEffect(() => {
    if (params.modal === "navigation" && gameState.jkfPlayer) {
      const currentTesuu = getCurrentMoveIndex();
      const totalMoves = getTotalMoves();

      console.log("🚀 ナビゲーションモーダル初期化:", {
        currentTesuu,
        totalMoves,
      });

      setNavigationState({
        currentTesuu,
        selectedBranchIndex: 0,
        preview: {
          tesuu: currentTesuu,
          branchIndex: 0,
          branchSteps: 0,
        },
      });

      setEffectiveTotalMoves(totalMoves);
    }
  }, [params.modal, gameState.jkfPlayer, getCurrentMoveIndex, getTotalMoves]);

  // 分岐情報の取得（メモ化して頻繁な再計算を防ぐ）
  const branches = useMemo(() => {
    if (!branchService || navigationState.preview.branchIndex > 0) return [];

    const result = branchService.getBranchesAtTesuu(
      navigationState.preview.tesuu,
    );

    if (!result.error) {
      return result.branches;
    } else {
      console.warn("分岐取得失敗:", result.error);
      return [];
    }
  }, [
    branchService,
    navigationState.preview.tesuu,
    navigationState.preview.branchIndex,
  ]);

  // プレビューデータの生成（デバウンス付き）
  useEffect(() => {
    if (!branchService) return;

    const timeoutId = setTimeout(() => {
      const preview = branchService.generatePreview(navigationState, branches);
      setPreviewData(preview);
    }, 50); // 50msのデバウンス

    return () => clearTimeout(timeoutId);
  }, [branchService, navigationState, branches]);

  // キーボード操作
  useEffect(() => {
    if (params.modal !== "navigation") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      // ログを削減してパフォーマンスを改善
      // console.log("⌨️ キー入力:", event.key, "分岐数:", branches.length);

      switch (event.key.toLowerCase()) {
        case "h": // 前の手
          event.preventDefault();
          if (branchService) {
            const result = branchService.movePrevious(
              navigationState,
              branches,
            );
            if (result.success && result.newState) {
              setNavigationState(result.newState);
            }
          }
          break;

        case "l": // 次の手/分岐に入る
          event.preventDefault();
          if (branchService) {
            const result = branchService.moveNext(
              navigationState,
              branches,
              effectiveTotalMoves,
            );
            if (result.success && result.newState) {
              setNavigationState(result.newState);
            } else if (result.error) {
              console.log("移動不可:", result.error);
            }
          }
          break;

        case "j": // 下の分岐選択
          event.preventDefault();
          if (branchService && navigationState.preview.branchIndex === 0) {
            const result = branchService.selectBranch(
              navigationState,
              "down",
              branches.length,
            );
            if (result.success && result.newState) {
              setNavigationState(result.newState);
            }
          }
          break;

        case "k": // 上の分岐選択
          event.preventDefault();
          if (branchService && navigationState.preview.branchIndex === 0) {
            const result = branchService.selectBranch(
              navigationState,
              "up",
              branches.length,
            );
            if (result.success && result.newState) {
              setNavigationState(result.newState);
            }
          }
          break;

        case "enter": // 確定
          event.preventDefault();
          handleConfirm();
          break;

        case "escape": // キャンセル
          event.preventDefault();
          closeModal();
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [
    params.modal,
    branchService,
    navigationState,
    branches,
    effectiveTotalMoves,
  ]);

  // 局面確定
  const handleConfirm = useCallback(() => {
    if (!branchService) return;

    const result = branchService.confirmNavigation(navigationState, branches);
    if (result.success) {
      console.log("✅ 局面確定成功");
      closeModal();
    } else {
      console.error("❌ 局面確定失敗:", result.error);
    }
  }, [branchService, navigationState, branches, closeModal]);

  // 分岐選択時の自動スクロール（デバウンス付き）
  useEffect(() => {
    if (!branchSelectorRef.current) return;

    const timeoutId = setTimeout(() => {
      const cards = branchSelectorRef.current?.querySelectorAll(
        ".branch-selector__card",
      );
      const selectedIndex = navigationState.selectedBranchIndex;

      if (cards && selectedIndex < cards.length) {
        const selectedCard = cards[selectedIndex] as HTMLElement;
        selectedCard.scrollIntoView({
          behavior: "smooth",
          block: "nearest",
          inline: "nearest",
        });
      }
    }, 100);

    return () => clearTimeout(timeoutId);
  }, [navigationState.selectedBranchIndex]);

  if (params.modal !== "navigation") {
    return null;
  }

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
          {/* 盤面プレビューエリア */}
          <div className="position-navigation-modal__preview-container">
            <div className="position-navigation-modal__board-preview">
              {previewData ? (
                <BoardPreview
                  pieces={previewData.board}
                  hands={
                    previewData.hands as {
                      [Color.Black]: string[];
                      [Color.White]: string[];
                    }
                  }
                  size={160}
                  showCoordinates={false}
                  showLastMove={false}
                  showHands={false}
                  interactive={false}
                />
              ) : (
                <div className="board-preview-placeholder">
                  <p>局面を読み込み中...</p>
                </div>
              )}
            </div>

            {/* 手駒表示 */}
            {previewData && (
              <div className="position-navigation-modal__hands">
                <div className="position-navigation-modal__hand">
                  <div className="position-navigation-modal__hand-label">
                    ☗先手
                  </div>
                  <div className="position-navigation-modal__hand-pieces">
                    {(previewData.hands[Color.Black] || []).map(
                      (kind, index) => {
                        const kanjiKind =
                          (gameState.jkfPlayer?.constructor as any)[
                            "kindToKan"
                          ]?.(kind) || kind;
                        return (
                          <span
                            key={`black-${kind}-${index}`}
                            className="position-navigation-modal__hand-piece"
                          >
                            {kanjiKind}
                          </span>
                        );
                      },
                    )}
                    {(previewData.hands[Color.Black] || []).length === 0 && (
                      <span className="position-navigation-modal__hand-empty">
                        なし
                      </span>
                    )}
                  </div>
                </div>

                <div className="position-navigation-modal__hand">
                  <div className="position-navigation-modal__hand-label">
                    ☖後手
                  </div>
                  <div className="position-navigation-modal__hand-pieces">
                    {(previewData.hands[Color.White] || []).map(
                      (kind, index) => {
                        const kanjiKind =
                          (gameState.jkfPlayer?.constructor as any)[
                            "kindToKan"
                          ]?.(kind) || kind;
                        return (
                          <span
                            key={`white-${kind}-${index}`}
                            className="position-navigation-modal__hand-piece"
                          >
                            {kanjiKind}
                          </span>
                        );
                      },
                    )}
                    {(previewData.hands[Color.White] || []).length === 0 && (
                      <span className="position-navigation-modal__hand-empty">
                        なし
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 手順表示エリア */}
          <div className="position-navigation-modal__move-sequence">
            <div className="modal-move-sequence">
              {/* 現在の局面情報 */}
              <div className="move-sequence__info">
                <div className="move-sequence__position">
                  {navigationState.preview.branchIndex === 0
                    ? `本譜 ${navigationState.preview.tesuu}手目`
                    : `分岐${navigationState.preview.branchIndex} ${navigationState.preview.branchSteps + 1}手目`}
                </div>
                {previewData && (
                  <div className="move-sequence__turn">
                    {previewData.turn === 0 ? "☗先手番" : "☖後手番"}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 分岐選択エリア */}
          <div className="position-navigation-modal__branch-selector">
            <div className="branch-selector" ref={branchSelectorRef}>
              {/* メイン線 */}
              <div
                className={`branch-selector__card ${navigationState.selectedBranchIndex === 0 ? "branch-selector__card--selected" : ""}`}
                onClick={() =>
                  setNavigationState({
                    ...navigationState,
                    selectedBranchIndex: 0,
                  })
                }
              >
                <div className="branch-selector__header">
                  <span className="branch-selector__move">本譜</span>
                  <span className="branch-selector__evaluation">
                    メイン線の手順
                  </span>
                </div>
                <div className="branch-selector__sequence">
                  → 棋譜の本線を進む
                </div>
              </div>

              {/* 分岐線 */}
              {branches.length > 0 ? (
                branches.map((branch, index) => (
                  <div
                    key={branch.id}
                    className={`branch-selector__card ${index + 1 === navigationState.selectedBranchIndex ? "branch-selector__card--selected" : ""}`}
                    onClick={() =>
                      setNavigationState({
                        ...navigationState,
                        selectedBranchIndex: index + 1,
                      })
                    }
                  >
                    <div className="branch-selector__header">
                      <span className="branch-selector__move">
                        <span className="branch-selector__move-number">
                          変化{index + 1}
                        </span>
                      </span>
                      <span className="branch-selector__evaluation">
                        <span className="branch-selector__move-text">
                          {branch.moves[0]?.description ||
                            (gameState.jkfPlayer?.constructor as any)[
                              "moveToReadableKifu"
                            ]?.({ move: branch.firstMove }) ||
                            String(branch.firstMove)}
                        </span>
                      </span>
                    </div>
                    <div className="branch-selector__sequence">
                      <span className="branch-selector__sequence-icon">→</span>
                      <span className="branch-selector__sequence-text">
                        {branch.startTesuu + 1}手目から {branch.length}手の変化
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="branch-selector__empty">
                  <p>この局面には分岐がありません</p>
                  <p>[j/k] キーで分岐を選択できます</p>
                </div>
              )}
            </div>
          </div>
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
