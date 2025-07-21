import type { NavigationState, PreviewState, Branch, BranchNavigationResult } from '@/types/branch';

export class BranchNavigator {
  /**
   * 前の手に移動
   */
  static movePrevious(currentState: NavigationState, branches: Branch[]): BranchNavigationResult {
    const { preview } = currentState;

    if (preview.branchIndex > 0) {
      // 分岐内での移動
      if (preview.branchSteps > 0) {
        // 分岐内で戻る
        return {
          success: true,
          newState: {
            ...currentState,
            preview: {
              ...preview,
              tesuu: preview.tesuu - 1,
              branchSteps: preview.branchSteps - 1
            }
          }
        };
      } else {
        // 分岐から抜ける
        const branch = branches[preview.branchIndex - 1];
        return {
          success: true,
          newState: {
            ...currentState,
            preview: {
              tesuu: branch.startTesuu,
              branchIndex: 0,
              branchSteps: 0
            }
          }
        };
      }
    } else {
      // メイン線での移動
      const newTesuu = Math.max(0, preview.tesuu - 1);
      return {
        success: true,
        newState: {
          ...currentState,
          preview: {
            tesuu: newTesuu,
            branchIndex: 0,
            branchSteps: 0
          }
        }
      };
    }
  }

  /**
   * 次の手に移動、または分岐に入る
   */
  static moveNext(
    currentState: NavigationState, 
    branches: Branch[], 
    maxTesuu: number
  ): BranchNavigationResult {
    const { preview, selectedBranchIndex } = currentState;

    if (preview.branchIndex > 0) {
      // 分岐内での移動
      const branch = branches[preview.branchIndex - 1];
      const maxSteps = branch.length - 1;

      if (preview.branchSteps < maxSteps) {
        return {
          success: true,
          newState: {
            ...currentState,
            preview: {
              ...preview,
              tesuu: preview.tesuu + 1,
              branchSteps: preview.branchSteps + 1
            }
          }
        };
      } else {
        return {
          success: false,
          error: '分岐の終端に到達しました'
        };
      }
    } else if (selectedBranchIndex > 0 && branches[selectedBranchIndex - 1]) {
      // 分岐に入る
      const branch = branches[selectedBranchIndex - 1];
      console.log(`🔄 分岐${selectedBranchIndex}に入る:`, {
        branchId: branch.id,
        startTesuu: branch.startTesuu,
        length: branch.length,
        firstMove: branch.firstMove
      });
      
      return {
        success: true,
        newState: {
          ...currentState,
          selectedBranchIndex: 0, // 選択をリセット
          preview: {
            tesuu: branch.startTesuu + 1,
            branchIndex: selectedBranchIndex,
            branchSteps: 0
          }
        }
      };
    } else {
      // メイン線での移動
      const newTesuu = Math.min(maxTesuu, preview.tesuu + 1);
      return {
        success: true,
        newState: {
          ...currentState,
          preview: {
            tesuu: newTesuu,
            branchIndex: 0,
            branchSteps: 0
          }
        }
      };
    }
  }

  /**
   * 分岐選択を変更
   */
  static selectBranch(
    currentState: NavigationState, 
    direction: 'up' | 'down', 
    branchCount: number
  ): BranchNavigationResult {
    // 分岐プレビュー中は選択変更不可
    if (currentState.preview.branchIndex > 0) {
      return {
        success: false,
        error: '分岐プレビュー中は選択変更できません'
      };
    }

    const current = currentState.selectedBranchIndex;
    let newIndex: number;

    if (direction === 'down') {
      newIndex = Math.min(branchCount, current + 1);
    } else {
      newIndex = Math.max(0, current - 1);
    }

    return {
      success: true,
      newState: {
        ...currentState,
        selectedBranchIndex: newIndex
      }
    };
  }

  /**
   * 局面を確定（実際のゲーム状態に反映）
   */
  static confirmNavigation(
    currentState: NavigationState, 
    branches: Branch[],
    jkfPlayer: any
  ): BranchNavigationResult {
    try {
      const { preview } = currentState;

      if (preview.branchIndex === 0) {
        // メイン線への移動
        jkfPlayer.goto(preview.tesuu);
      } else {
        // 分岐への移動
        const branch = branches[preview.branchIndex - 1];
        
        // 分岐開始点まで移動
        jkfPlayer.goto(branch.startTesuu);
        
        // 分岐の手順を進行
        for (let step = 0; step < preview.branchSteps; step++) {
          const moved = jkfPlayer.forward();
          if (!moved) {
            throw new Error(`分岐内移動失敗: step=${step + 1}`);
          }
        }
      }

      return {
        success: true,
        newState: {
          currentTesuu: jkfPlayer.tesuu,
          selectedBranchIndex: 0,
          preview: {
            tesuu: jkfPlayer.tesuu,
            branchIndex: 0,
            branchSteps: 0
          }
        }
      };

    } catch (error) {
      return {
        success: false,
        error: String(error)
      };
    }
  }
}
