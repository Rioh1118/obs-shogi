import { BranchCalculator } from './BranchCalculator';
import { PreviewController } from './PreviewController';
import { BranchNavigator } from './BranchNavigator';
import type { 
  Branch, 
  NavigationState, 
  BranchCalculationResult, 
  BranchNavigationResult,
  PreviewData
} from '@/types/branch';

export class BranchService {
  private calculator: BranchCalculator;
  private previewController: PreviewController;

  constructor(private jkfPlayer: any) {
    this.calculator = new BranchCalculator(jkfPlayer);
    this.previewController = new PreviewController(jkfPlayer);
  }

  /**
   * 指定された手数での分岐を取得
   */
  getBranchesAtTesuu(tesuu: number): BranchCalculationResult {
    return this.calculator.calculateBranchesAtTesuu(tesuu);
  }

  /**
   * プレビューデータを生成
   */
  generatePreview(state: NavigationState, branches: Branch[]): PreviewData | null {
    return this.previewController.generatePreviewData(state.preview, branches);
  }

  /**
   * 前の手に移動
   */
  movePrevious(currentState: NavigationState, branches: Branch[]): BranchNavigationResult {
    return BranchNavigator.movePrevious(currentState, branches);
  }

  /**
   * 次の手に移動
   */
  moveNext(
    currentState: NavigationState, 
    branches: Branch[], 
    maxTesuu: number
  ): BranchNavigationResult {
    return BranchNavigator.moveNext(currentState, branches, maxTesuu);
  }

  /**
   * 分岐選択
   */
  selectBranch(
    currentState: NavigationState, 
    direction: 'up' | 'down', 
    branchCount: number
  ): BranchNavigationResult {
    return BranchNavigator.selectBranch(currentState, direction, branchCount);
  }

  /**
   * 局面確定
   */
  confirmNavigation(currentState: NavigationState, branches: Branch[]): BranchNavigationResult {
    return BranchNavigator.confirmNavigation(currentState, branches, this.jkfPlayer);
  }

  /**
   * サービス情報を取得（デバッグ用）
   */
  getServiceInfo(): object {
    return {
      hasJkfPlayer: !!this.jkfPlayer,
      currentTesuu: this.jkfPlayer?.tesuu,
      currentTurn: this.jkfPlayer?.shogi?.turn
    };
  }
}
