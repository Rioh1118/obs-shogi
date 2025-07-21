import Modal from "../Modal";
import { useURLParams } from "@/hooks/useURLParams";
import { useGame } from "@/contexts/GameContext";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import BoardPreview from "../GameBoard/Board/BoardPreview";
import { Color } from "shogi.js";
import { ChevronRight } from "lucide-react";
import { BranchService } from "@/services/branch/BranchService";
import { NavigationState, Branch } from "@/types/branch";
import type { PreviewData } from "@/services/branch/PreviewController";
import "./PositionNavigationModal.scss";

function PositionNavigationModal() {
  const { params, closeModal } = useURLParams();
  const { state: gameState, getCurrentMoveIndex, getTotalMoves, goToIndex } = useGame();
  const { getAvailableBranchesAtTesuu } = useBranch();
  
  // ナビゲーション状態
  const [currentTesuu, setCurrentTesuu] = useState(0);
  const [selectedBranchIndex, setSelectedBranchIndex] = useState(0);
  const [previewBoard, setPreviewBoard] = useState<Piece[][] | null>(null);
  const [previewHands, setPreviewHands] = useState<{ [key: number]: string[] } | null>(null);

  // プレビュー探索状態（モーダル内でのみ使用、実際のゲームには反映されない）
  const [previewTesuu, setPreviewTesuu] = useState(0);
  const [previewBranchIndex, setPreviewBranchIndex] = useState(0);
  const [previewBranchSteps, setPreviewBranchSteps] = useState(0); // 分岐内での進行手数
  const [currentBranchPath, setCurrentBranchPath] = useState<any[]>([]); // 現在の分岐パス

  // 分岐選択エリアのスクロール用ref
  const branchSelectorRef = useRef<HTMLDivElement>(null);

  // 軽量な分岐操作ヘルパー（計算のみ、jkfPlayer操作なし）
  const branchHelper = useMemo(() => ({
    // 分岐に入る時の次の状態を計算
    calculateEnterBranch: (branchIndex: number, branches: any[]) => {
      if (branchIndex <= 0 || branchIndex > branches.length) return null;
      const selectedBranch = branches[branchIndex - 1];
      return {
        tesuu: selectedBranch.startTesuu + 1, // 分岐の最初の手の位置
        branchIndex: branchIndex,
        branchSteps: 0 // 分岐内の0手目（最初の手）
      };
    },

    // 分岐内で進む時の次の状態を計算（分岐の長さ制限を考慮）
    calculateMoveForward: (currentTesuu: number, currentSteps: number, branchIndex: number, branches: any[]) => {
      // 分岐内にいる場合は分岐の長さをチェック
      if (branchIndex > 0 && branches.length >= branchIndex) {
        const selectedBranch = branches[branchIndex - 1];
        const maxSteps = selectedBranch.length - 1; // 分岐の最大手数（最初の手は0ステップ）
        
        if (currentSteps >= maxSteps) {
          console.log(`分岐の終端に到達: 現在${currentSteps}手, 最大${maxSteps}手`);
          return { tesuu: currentTesuu, branchSteps: currentSteps }; // 進まない
        }
      }
      
      return {
        tesuu: currentTesuu + 1,
        branchSteps: currentSteps + 1
      };
    },

    // 分岐内で戻る時の次の状態を計算
    calculateMoveBackward: (currentTesuu: number, currentSteps: number) => {
      return {
        tesuu: Math.max(0, currentTesuu - 1),
        branchSteps: Math.max(0, currentSteps - 1)
      };
    },

    // 分岐から抜ける時の状態を計算
    calculateExitBranch: (branches: any[], branchIndex: number) => {
      if (branchIndex <= 0 || branchIndex > branches.length) return { tesuu: 0 };
      const selectedBranch = branches[branchIndex - 1];
      return { tesuu: selectedBranch.startTesuu };
    },

    // 分岐の進行状況を取得
    getBranchProgress: (branchIndex: number, branchSteps: number, branches: any[]) => {
      if (branchIndex <= 0 || branchIndex > branches.length) return null;
      const selectedBranch = branches[branchIndex - 1];
      const maxSteps = selectedBranch.length - 1;
      return {
        current: branchSteps,
        max: maxSteps,
        isAtEnd: branchSteps >= maxSteps
      };
    },

    // 実際のjkfPlayer操作（確定時のみ使用）
    executeMovement: (tesuu: number, branchIndex: number, branchSteps: number, branches: any[]) => {
      if (!gameState.jkfPlayer) {
        console.error("jkfPlayerが存在しません");
        return false;
      }
      
      try {
        console.log("確定移動実行:", { tesuu, branchIndex, branchSteps, branchesLength: branches.length });
        
        if (branchIndex > 0 && branches.length >= branchIndex) {
          // 分岐に移動
          const selectedBranch = branches[branchIndex - 1];
          console.log("分岐に確定移動:", selectedBranch);
          
          gameState.jkfPlayer.goto(selectedBranch.startTesuu);
          console.log("分岐開始点に移動完了:", selectedBranch.startTesuu);
          
          gameState.jkfPlayer.forkAndForward(selectedBranch.forkPointers[0].forkIndex);
          console.log("分岐に入りました:", selectedBranch.forkPointers[0].forkIndex);
          
          // 分岐内で指定された手数だけ進む
          for (let i = 0; i < branchSteps; i++) {
            const moved = gameState.jkfPlayer.forward();
            console.log(`分岐内で${i + 1}手進む:`, moved);
            if (!moved) break;
          }
          
          // 最終的な状態をログ出力
          const finalState = {
            tesuu: gameState.jkfPlayer.tesuu,
            forkPointers: gameState.jkfPlayer.getForkPointers()
          };
          console.log("確定後の最終状態:", finalState);
        } else {
          // 通常の手数移動
          console.log("メイン線に確定移動:", tesuu);
          gameState.jkfPlayer.goto(tesuu);
        }
        return true;
      } catch (error) {
        console.error("局面移動に失敗:", error);
        return false;
      }
    }
  }), [gameState.jkfPlayer, currentTesuu]);



  // 現在の手数と分岐を取得（現在の実際の局面に基づく）
  // const totalMoves = getTotalMoves(); // 現在未使用
  // 分岐情報を取得（プレビュー用）- UI表示には使わない
  const allBranches = useMemo(() => {
    if (!gameState.jkfPlayer || currentTesuu === undefined) return [];
    
    try {
      // 現在の手数での分岐を常に取得（プレビューで必要）
      const baseTesuu = currentTesuu;
      const targetTesuu = baseTesuu + 1;
      
      const moveFormat = gameState.jkfPlayer["getMoveFormat"]?.(targetTesuu);
      if (!moveFormat?.forks || moveFormat.forks.length === 0) return [];
      
      const mainLineMove = moveFormat.move;
      let mainLineMoveKey = null;
      if (mainLineMove) {
        mainLineMoveKey = `${mainLineMove.from?.x || 'null'}-${mainLineMove.from?.y || 'null'}-${mainLineMove.to.x}-${mainLineMove.to.y}-${mainLineMove.piece}`;
      }
      
      const branches: any[] = [];
      const seenMoves = new Set();
      
      moveFormat.forks.forEach((fork: any, forkIndex: number) => {
        const firstMove = fork[0]?.move;
        if (firstMove) {
          const moveKey = `${firstMove.from?.x || 'null'}-${firstMove.from?.y || 'null'}-${firstMove.to.x}-${firstMove.to.y}-${firstMove.piece}`;
          
          if (mainLineMoveKey && moveKey === mainLineMoveKey) return;
          if (seenMoves.has(moveKey)) return;
          
          seenMoves.add(moveKey);
          const branch = {
            id: `${baseTesuu}-${forkIndex}`,
            startTesuu: baseTesuu,
            forkPointers: [{ te: targetTesuu, forkIndex }],
            firstMove: firstMove,
            depth: 1,
            length: fork.length,
          };
          branches.push(branch);
        }
      });
      
      return branches;
    } catch (error) {
      console.warn("分岐取得に失敗:", error);
      return [];
    }
  }, [currentTesuu, gameState.jkfPlayer]);

  // UI表示用の分岐リスト
  const availableBranches = useMemo(() => {
    // 分岐プレビュー中でない場合は、プレビュー手数での分岐を取得
    if (!gameState.jkfPlayer) return [];
    
    try {
      if (previewBranchIndex > 0) {
        // 分岐プレビュー中は分岐リストを表示しない
        console.log(`=== 分岐プレビュー中のため分岐リストなし ===`);
        return [];
      }
      
      // メイン線プレビュー中：プレビュー手数での分岐を取得
      const baseTesuu = previewTesuu;
      
      // JKFでは、手数Nの次の手（手数N+1）の選択肢として分岐が格納される
      const targetTesuu = baseTesuu + 1;
      console.log(`=== 手数${targetTesuu}の分岐調査（プレビュー手数${baseTesuu}） ===`);
      
      // JKFフォーマットでは、分岐は現在の手の代替手として格納される
      const moveFormat = gameState.jkfPlayer["getMoveFormat"]?.(targetTesuu);
      
      // デバッグ情報を追加
      console.log(`分岐探索: targetTesuu=${targetTesuu}, moveFormat存在=${!!moveFormat}, forks存在=${!!moveFormat?.forks}, forks長=${moveFormat?.forks?.length || 0}`);
      
      if (!moveFormat?.forks || moveFormat.forks.length === 0) {
        console.log(`分岐なし（手数${targetTesuu}にはフォーク情報がありません）`);
        if (moveFormat) {
          console.log("moveFormat詳細:", { 
            move: moveFormat.move, 
            hasMove: !!moveFormat.move,
            hasForks: !!moveFormat.forks 
          });
        }
        return [];
      }
      
      // 本譜の手を取得
      const mainLineMove = moveFormat.move;
      let mainLineMoveKey = null;
      if (mainLineMove) {
        mainLineMoveKey = `${mainLineMove.from?.x || 'null'}-${mainLineMove.from?.y || 'null'}-${mainLineMove.to.x}-${mainLineMove.to.y}-${mainLineMove.piece}`;
        console.log("本譜の手のmoveKey:", mainLineMoveKey);
      }
      
      // 各分岐の詳細を調査 + 本譜との重複除去
      const branches: any[] = [];
      const seenMoves = new Set();
      
      moveFormat.forks.forEach((fork: any, forkIndex: number) => {
        const firstMove = fork[0]?.move;
        if (firstMove) {
          // 手の一意性チェック（from, to, pieceの組み合わせ）
          const moveKey = `${firstMove.from?.x || 'null'}-${firstMove.from?.y || 'null'}-${firstMove.to.x}-${firstMove.to.y}-${firstMove.piece}`;
          
          // 本譜と同じ手は除外
          if (mainLineMoveKey && moveKey === mainLineMoveKey) {
            console.log(`本譜と重複: 分岐${forkIndex}はスキップ (moveKey: ${moveKey})`);
            return;
          }
          
          // 既に見た手は除外
          if (seenMoves.has(moveKey)) {
            console.log(`重複除去: 分岐${forkIndex}はスキップ (moveKey: ${moveKey})`);
            return;
          }
          
          seenMoves.add(moveKey);
          const branch = {
            id: `${baseTesuu}-${forkIndex}`,
            startTesuu: baseTesuu,
            forkPointers: [{ te: targetTesuu, forkIndex }],
            firstMove: firstMove,
            depth: 1,
            length: fork.length,
          };
          console.log(`追加する分岐${forkIndex}:`, {
            id: branch.id,
            length: branch.length,
            firstMove: branch.firstMove,
            startTesuu: branch.startTesuu
          });
          branches.push(branch);
        }
      });
      
      console.log("最終的な分岐リスト:", branches);
      console.log(`=== 分岐調査終了（${branches.length}個の分岐） ===`);
      return branches;
    } catch (error) {
      console.warn("分岐取得に失敗:", error);
      return [];
    }
  }, [previewTesuu, previewBranchIndex, gameState.jkfPlayer]);

  // 手順の日本語表記を取得（分岐プレビュー対応）
  const moveSequence = useMemo(() => {
    if (!gameState.jkfPlayer) return [];
    
    try {
      // 分岐プレビュー中の場合は分岐の手順を取得
      if (previewBranchIndex > 0 && allBranches.length >= previewBranchIndex) {
        const selectedBranch = allBranches[previewBranchIndex - 1];
        const targetTesuu = selectedBranch.startTesuu + 1;
        const moveFormat = gameState.jkfPlayer["getMoveFormat"]?.(targetTesuu);
        
        if (moveFormat?.forks && moveFormat.forks[selectedBranch.forkPointers[0].forkIndex]) {
          const branchMoves = moveFormat.forks[selectedBranch.forkPointers[0].forkIndex];
          const branchMoveStrings = branchMoves
            .map((branchMove: any) => branchMove.move)
            .filter(Boolean);
          
          // 分岐開始点までのメイン線 + 分岐の手順
          const mainMoveList = gameState.jkfPlayer.kifu?.moves || [];
          const mainMoveStrings = mainMoveList
            .slice(1, selectedBranch.startTesuu + 1)
            .map(move => move.move)
            .filter(Boolean);
          
          const combinedMoves = [...mainMoveStrings, ...branchMoveStrings];
          
          // 平手初期局面のSFEN
          const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
          return convertSfenSequence(sfen, combinedMoves);
        }
      }
      
      // メイン線の手順を取得
      const sfen = 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1';
      const moveList = gameState.jkfPlayer.kifu?.moves || [];
      const moveStrings = moveList.slice(1).map((move: any) => move.move).filter(Boolean);
      
      return convertSfenSequence(sfen, moveStrings as string[]);
    } catch (error) {
      console.error("手順の変換に失敗:", error);
      return [];
    }
  }, [gameState.jkfPlayer, previewBranchIndex, allBranches]);

  // 有効な手数の計算（分岐プレビュー対応）
  const effectiveTotalMoves = useMemo(() => {
    if (previewBranchIndex > 0 && allBranches.length >= previewBranchIndex) {
      const selectedBranch = allBranches[previewBranchIndex - 1];
      return selectedBranch.startTesuu + selectedBranch.length;
    }
    return getTotalMoves();
  }, [previewBranchIndex, allBranches, getTotalMoves]);

  // 初期化：現在の局面を設定
  useEffect(() => {
    if (params.modal === 'navigation') {
      const initialTesuu = getCurrentMoveIndex();
      setCurrentTesuu(initialTesuu);
      setSelectedBranchIndex(0);
      // プレビュー状態も初期化
      setPreviewTesuu(initialTesuu);
      setPreviewBranchIndex(0);
      setPreviewBranchSteps(0);
      // 現在の分岐パスを保存
      if (gameState.jkfPlayer) {
        setCurrentBranchPath(gameState.jkfPlayer.getForkPointers());
      }
    }
  }, [params.modal, getCurrentMoveIndex, gameState.jkfPlayer]);

  // プレビュー局面の更新（プレビュー状態に基づく）
  useEffect(() => {
    if (!gameState.jkfPlayer) return;

    try {
      // 一時的に指定手数に移動してプレビュー用の盤面を取得
      const originalTesuu = gameState.jkfPlayer.tesuu;
      const originalForkPointers = gameState.jkfPlayer.getForkPointers();
      
      console.log("プレビュー更新:", { previewTesuu, previewBranchIndex });
      
      // プレビューで分岐が選択されている場合の処理
      if (previewBranchIndex > 0 && allBranches.length >= previewBranchIndex) {
        const selectedBranch = allBranches[previewBranchIndex - 1];
        console.log("=== プレビュー分岐処理開始 ===");
        console.log("分岐プレビュー:", selectedBranch, "分岐内手数:", previewBranchSteps);
        
        // 分岐の開始点に移動
        gameState.jkfPlayer.goto(selectedBranch.startTesuu);
        console.log("プレビュー: 分岐開始点に移動完了:", selectedBranch.startTesuu);
        
        // 分岐に入る（これで分岐の最初の手が指される）
        gameState.jkfPlayer.forkAndForward(selectedBranch.forkPointers[0].forkIndex);
        console.log("プレビュー: 分岐に入りました:", selectedBranch.forkPointers[0].forkIndex);
        console.log("分岐後の手番:", {
          shogiTurn: gameState.jkfPlayer.shogi.turn,
          shogiTurnName: gameState.jkfPlayer.shogi.turn === Color.Black ? '先手' : '後手',
          tesuu: gameState.jkfPlayer.tesuu,
          tesuuBasedTurn: gameState.jkfPlayer.tesuu % 2 === 0 ? '先手番' : '後手番',
          branchLength: selectedBranch.length,
          branchSteps: previewBranchSteps
        });
        
        // 分岐内で指定された手数だけさらに進む（効率化）
        if (previewBranchSteps > 0) {
          console.log(`プレビュー: 分岐内で${previewBranchSteps}手一括進行`);
          for (let i = 0; i < previewBranchSteps; i++) {
            const moved = gameState.jkfPlayer.forward();
            if (!moved) {
              console.log(`プレビュー: ${i + 1}手目で移動失敗`);
              break;
            }
          }
        }
        
        // プレビュー後の状態をログ出力
        const previewState = {
          tesuu: gameState.jkfPlayer.tesuu,
          forkPointers: gameState.jkfPlayer.getForkPointers()
        };
        console.log("プレビュー後の状態:", previewState);
        console.log("=== プレビュー分岐処理終了 ===");
      } else {
        // 通常の手数移動（メイン線）
        console.log("プレビュー: メイン線に移動:", previewTesuu);
        gameState.jkfPlayer.goto(previewTesuu);
      }
      
      // プレビュー用の盤面データを取得（正しい座標系で）
      console.log("🏠 盤面の駒配置をスキャン開始:");
      const pieces: Piece[][] = [];
      let totalPiecesOnBoard = 0;
      
      for (let x = 1; x <= 9; x++) {
        pieces[x - 1] = [];
        for (let y = 1; y <= 9; y++) {
          const piece = gameState.jkfPlayer.shogi.get(x, y);
          pieces[x - 1][y - 1] = piece;
          
          if (piece) {
            totalPiecesOnBoard++;
            // 全ての駒の位置をログ出力
            console.log(`🔸 ${x}${y}: ${piece.kind} (${piece.color === Color.Black ? '先手' : '後手'})`);
          }
        }
      }
      
      console.log(`📊 盤面統計:`, {
        totalPiecesOnBoard,
        currentTesuu: gameState.jkfPlayer.tesuu,
        currentTurn: gameState.jkfPlayer.shogi.turn,
        currentTurnName: gameState.jkfPlayer.shogi.turn === Color.Black ? '先手番' : '後手番'
      });
      setPreviewBoard(pieces);

      // プレビュー用の手駒データを取得（正しいMap形式で）
      console.log("🎯 手駒データを取得開始:");
      const shogiHands = gameState.jkfPlayer.shogi.hands;
      console.log("手駒の生データ:", {
        blackHandRaw: shogiHands[Color.Black],
        whiteHandRaw: shogiHands[Color.White],
        blackHandSize: shogiHands[Color.Black]?.size || 0,
        whiteHandSize: shogiHands[Color.White]?.size || 0
      });
      
      const hands = {
        [Color.Black]: Array.from(shogiHands[Color.Black] || []).map(piece => piece.kind), // 先手の手駒
        [Color.White]: Array.from(shogiHands[Color.White] || []).map(piece => piece.kind)  // 後手の手駒
      };
      
      console.log("🎯 変換後の手駒:", {
        blackHand: hands[Color.Black],
        whiteHand: hands[Color.White],
        blackHandCount: hands[Color.Black].length,
        whiteHandCount: hands[Color.White].length
      });
      
      setPreviewHands(hands);
      
      // デバッグ：現在の手番と手駒情報を確認
      console.log("📈 プレビュー最終状態:", {
        tesuu: gameState.jkfPlayer.tesuu,
        actualTurn: gameState.jkfPlayer.shogi.turn,
        actualTurnName: gameState.jkfPlayer.shogi.turn === Color.Black ? '先手番' : '後手番',
        totalPiecesOnBoard,
        totalPiecesInHands: hands[Color.Black].length + hands[Color.White].length,
        previewTesuu,
        previewBranchIndex
      });
      
      // 元の局面に戻す（分岐パスも復元）
      if (currentBranchPath.length > 0) {
        // 分岐パスがある場合は、分岐を含めて復元
        gameState.jkfPlayer.goto(originalTesuu, originalForkPointers);
      } else {
        // 分岐パスがない場合は通常の復元
        gameState.jkfPlayer.goto(originalTesuu, originalForkPointers);
      }
    } catch (error) {
      console.error("プレビュー局面の更新に失敗:", error);
      setPreviewBoard(null);
      setPreviewHands(null);
    }
  }, [previewTesuu, previewBranchIndex, previewBranchSteps, allBranches, gameState.jkfPlayer]);



  // 分岐選択時の自動スクロール
  useEffect(() => {
    if (!branchSelectorRef.current) return;
    
    // 選択された分岐カードにスクロール
    const selectedCardIndex = selectedBranchIndex; // 0: メイン線, 1~: 分岐1~
    const cards = branchSelectorRef.current.querySelectorAll('.branch-selector__card');
    
    if (selectedCardIndex < cards.length) {
      const selectedCard = cards[selectedCardIndex] as HTMLElement;
      console.log("分岐カードスクロール:", selectedCardIndex, selectedCard);
      
      // 選択されたカードが見えるようにスクロール
      selectedCard.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'nearest'
      });
    }
  }, [selectedBranchIndex]);

  // 局面確定ハンドラー
  const handleConfirm = useCallback(async () => {
    try {
      if (!gameState.jkfPlayer) return;
      
      // 分岐が選択されている場合は分岐に移動
      if (availableBranches.length > 0 && selectedBranchIndex > 0 && selectedBranchIndex <= availableBranches.length) {
        const selectedBranch = availableBranches[selectedBranchIndex - 1];
        // 直接JKFPlayerを操作
        gameState.jkfPlayer.goto(currentTesuu);
        gameState.jkfPlayer.forkAndForward(selectedBranch.forkPointers[0].forkIndex);
      } else {
        // 通常の局面移動
        await goToIndex(currentTesuu);
      }
      
      // モーダルを閉じる
      closeModal();
    } catch (error) {
      console.error("局面移動に失敗:", error);
    }
  }, [currentTesuu, availableBranches, selectedBranchIndex, goToIndex, gameState.jkfPlayer, closeModal]);

  // キーボードナビゲーション
  useEffect(() => {
    if (params.modal !== 'navigation') return;

    const handleKeyDown = (event: KeyboardEvent) => {
      console.log("キー押下:", event.key, "分岐数:", availableBranches.length, "選択中の分岐:", selectedBranchIndex);
      
      switch (event.key.toLowerCase()) {
        case 'h': // 前の手（プレビューのみ）
          event.preventDefault();
          
          if (previewBranchIndex > 0 && previewBranchSteps > 0) {
            // 分岐内で戻る
            const nextState = branchHelper.calculateMoveBackward(previewTesuu, previewBranchSteps);
            setPreviewTesuu(nextState.tesuu);
            setPreviewBranchSteps(nextState.branchSteps);
          } else if (previewBranchIndex > 0 && previewBranchSteps === 0) {
            // 分岐プレビューから抜ける
            const exitState = branchHelper.calculateExitBranch(allBranches, previewBranchIndex);
            setPreviewTesuu(exitState.tesuu);
            setPreviewBranchIndex(0);
            setPreviewBranchSteps(0);
          } else {
            // 通常の前の手
            setPreviewTesuu(prev => Math.max(0, prev - 1));
            setPreviewBranchIndex(0);
            setPreviewBranchSteps(0);
            setSelectedBranchIndex(0);
          }
          break;
          
        case 'l': // 次の手 または 分岐に入る（プレビューのみ）
          event.preventDefault();
          
          if (previewBranchIndex > 0) {
            // 既に分岐プレビュー中の場合は分岐内で進む（分岐の長さ制限）
            const selectedBranch = allBranches[previewBranchIndex - 1];
            const maxBranchSteps = selectedBranch.length - 1;
            
            if (previewBranchSteps < maxBranchSteps) {
              setPreviewTesuu(prev => prev + 1);
              setPreviewBranchSteps(prev => prev + 1);
              console.log(`分岐内で進行: ${previewBranchSteps + 1}/${maxBranchSteps}`);
            } else {
              console.log(`分岐の終端に到達: ${previewBranchSteps}/${maxBranchSteps}`);
            }
          } else if (selectedBranchIndex > 0 && allBranches[selectedBranchIndex - 1]) {
            // 分岐が選択されている場合はその分岐のプレビューに入る
            const nextState = branchHelper.calculateEnterBranch(selectedBranchIndex, allBranches);
            if (nextState) {
              setPreviewTesuu(nextState.tesuu);
              setPreviewBranchIndex(nextState.branchIndex);
              setPreviewBranchSteps(nextState.branchSteps);
              setSelectedBranchIndex(0);
            }
          } else {
            // 通常の次の手のプレビューに移動（効果的な手数制限）
            setPreviewTesuu(prev => Math.min(effectiveTotalMoves, prev + 1));
            setPreviewBranchIndex(0);
            setPreviewBranchSteps(0);
            setSelectedBranchIndex(0);
          }
          break;
          
        case 'j': // 下の分岐
          event.preventDefault();
          if (previewBranchIndex === 0) { // 分岐プレビュー中でない場合のみ
            setSelectedBranchIndex(prev => {
              const newIndex = Math.min(availableBranches.length, prev + 1);
              console.log("j押下 - 分岐選択", prev, "→", newIndex);
              return newIndex;
            });
          }
          break;
          
        case 'k': // 上の分岐
          event.preventDefault();
          if (previewBranchIndex === 0) { // 分岐プレビュー中でない場合のみ
            setSelectedBranchIndex(prev => {
              const newIndex = Math.max(0, prev - 1);
              console.log("k押下 - 分岐選択", prev, "→", newIndex);
              return newIndex;
            });
          }
          break;
          
        case 'enter': // 確定（プレビュー状態を実際のゲームに反映）
          event.preventDefault();
          
          // 分岐選択されている場合、または分岐プレビュー中の場合
          const effectiveBranchIndex = selectedBranchIndex > 0 ? selectedBranchIndex : previewBranchIndex;
          console.log("=== Enter確定処理開始 ===");
          console.log("確定時の状態:", { previewTesuu, effectiveBranchIndex, previewBranchSteps, selectedBranchIndex, previewBranchIndex });
          console.log("分岐リスト長:", allBranches.length);
          
          if (gameState.jkfPlayer) {
            try {
              if (effectiveBranchIndex > 0 && allBranches.length >= effectiveBranchIndex) {
                // 分岐に移動
                const selectedBranch = allBranches[effectiveBranchIndex - 1];
                console.log("分岐に確定移動:", selectedBranch);
                
                gameState.jkfPlayer.goto(selectedBranch.startTesuu);
                gameState.jkfPlayer.forkAndForward(selectedBranch.forkPointers[0].forkIndex);
                
                // 分岐内で指定された手数だけ進む
                for (let i = 0; i < previewBranchSteps; i++) {
                  const moved = gameState.jkfPlayer.forward();
                  console.log(`確定: 分岐内で${i + 1}手進む:`, moved);
                  if (!moved) break;
                }
                
                console.log("確定後の分岐状態:", {
                  tesuu: gameState.jkfPlayer.tesuu,
                  forkPointers: gameState.jkfPlayer.getForkPointers()
                });
              } else {
                // 通常の手数移動
                console.log("メイン線に確定移動:", previewTesuu);
                gameState.jkfPlayer.goto(previewTesuu);
              }
            } catch (error) {
              console.error("確定移動に失敗:", error);
            }
          }
          
          closeModal();
          break;
          
        case 'escape': // キャンセル
          event.preventDefault();
          closeModal();
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [params.modal, effectiveTotalMoves, availableBranches.length, closeModal, handleConfirm]);

  if (params.modal !== 'navigation') {
    return null;
  }

  return (
    <Modal onToggle={closeModal}>
      <div className="position-navigation-modal">
        <div className="position-navigation-modal__header">
          <h2 className="position-navigation-modal__title">局面ナビゲーション</h2>
          <p className="position-navigation-modal__subtitle">
            nvim風操作で高速ナビゲーション
          </p>
        </div>

        <div className="position-navigation-modal__content">
          {/* 盤面プレビューエリア */}
          <div className="position-navigation-modal__preview-container">
            <div className="position-navigation-modal__board-preview">
              {previewBoard ? (
                <BoardPreview
                  pieces={previewBoard}
                  hands={previewHands || undefined}
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
            {previewHands && (
              <div className="position-navigation-modal__hands">
                <div className="position-navigation-modal__hand">
                  <div className="position-navigation-modal__hand-label">☗先手</div>
                  <div className="position-navigation-modal__hand-pieces">
                    {(previewHands[Color.Black] || []).map((kind, index) => {
                      // JKFPlayerのkindToKan関数を使用して日本語表記に変換
                      const kanjiKind = (gameState.jkfPlayer?.constructor as any)["kindToKan"]?.(kind) || kind;
                      return (
                        <span key={`black-${kind}-${index}`} className="position-navigation-modal__hand-piece">
                          {kanjiKind}
                        </span>
                      );
                    })}
                    {(previewHands[Color.Black] || []).length === 0 && <span className="position-navigation-modal__hand-empty">なし</span>}
                  </div>
                </div>
                
                <div className="position-navigation-modal__hand">
                  <div className="position-navigation-modal__hand-label">☖後手</div>
                  <div className="position-navigation-modal__hand-pieces">
                    {(previewHands[Color.White] || []).map((kind, index) => {
                      // JKFPlayerのkindToKan関数を使用して日本語表記に変換
                      const kanjiKind = (gameState.jkfPlayer?.constructor as any)["kindToKan"]?.(kind) || kind;
                      return (
                        <span key={`white-${kind}-${index}`} className="position-navigation-modal__hand-piece">
                          {kanjiKind}
                        </span>
                      );
                    })}
                    {(previewHands[Color.White] || []).length === 0 && <span className="position-navigation-modal__hand-empty">なし</span>}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 手順表示エリア */}
          <div className="position-navigation-modal__move-sequence">
            <div className="modal-move-sequence">
              {(() => {
                // 表示する手数の範囲を計算
                const maxDisplay = 7; // 表示する手数の最大数
                let startTesuu: number;
                let endTesuu: number;

                if (effectiveTotalMoves === 0) {
                  // 手数がない場合は初期局面のみ
                  startTesuu = 0;
                  endTesuu = 0;
                } else if (previewTesuu <= Math.floor(maxDisplay / 2)) {
                  // 開始付近では0から始める
                  startTesuu = 0;
                  endTesuu = Math.min(effectiveTotalMoves, maxDisplay - 1);
                } else if (previewTesuu >= effectiveTotalMoves - Math.floor(maxDisplay / 2)) {
                  // 終了付近では最後から逆算
                  startTesuu = Math.max(0, effectiveTotalMoves - maxDisplay + 1);
                  endTesuu = effectiveTotalMoves;
                } else {
                  // 中間ではプレビュー手数を中心に配置
                  const half = Math.floor(maxDisplay / 2);
                  startTesuu = previewTesuu - half;
                  endTesuu = previewTesuu + half;
                }

                const displayItems = [];
                for (let tesuu = startTesuu; tesuu <= endTesuu; tesuu++) {
                  const isCurrentMove = tesuu === previewTesuu;
                  
                  const moveData = moveSequence[tesuu - 1];
                  const moveText = tesuu === 0 ? "初期局面" : 
                    moveData?.move ? 
                      `${tesuu}.${moveData.move}` : 
                      `${tesuu}手目`;

                  displayItems.push(
                    <span key={tesuu} className="modal-move-sequence__item">
                      <span 
                        className={`modal-move-sequence__move ${isCurrentMove ? 'modal-move-sequence__move--current' : ''}`}
                      >
                        {moveText}
                      </span>
                      {tesuu < endTesuu && (
                        <ChevronRight className="modal-move-sequence__arrow" size={16} />
                      )}
                    </span>
                  );
                }

                return displayItems;
              })()}
            </div>
          </div>

          {/* 分岐選択エリア */}
          <div className="position-navigation-modal__branch-selector">
            <div className="branch-selector" ref={branchSelectorRef}>
              {/* メイン線 */}
              <div 
                className={`branch-selector__card ${selectedBranchIndex === 0 ? 'branch-selector__card--selected' : ''}`}
                onClick={() => setSelectedBranchIndex(0)}
              >
                <div className="branch-selector__header">
                  <span className="branch-selector__move">
                    メイン線
                  </span>
                  <span className="branch-selector__evaluation">
                    本譜
                  </span>
                </div>
                <div className="branch-selector__sequence">
                  → 棋譜の本線
                </div>
              </div>

              {/* 分岐線 */}
              {availableBranches.length > 0 ? 
                availableBranches.map((branch, index) => (
                  <div 
                    key={branch.id}
                    className={`branch-selector__card ${index + 1 === selectedBranchIndex ? 'branch-selector__card--selected' : ''}`}
                    onClick={() => setSelectedBranchIndex(index + 1)}
                  >
                    <div className="branch-selector__header">
                      <span className="branch-selector__move">
                        <span className="branch-selector__move-number">分岐 {index + 1}</span>
                      </span>
                      <span className="branch-selector__evaluation">
                        <span className="branch-selector__move-text">
                          {(gameState.jkfPlayer?.constructor as any)["moveToReadableKifu"]?.({move: branch.firstMove}) || String(branch.firstMove)}
                        </span>
                      </span>
                    </div>
                    <div className="branch-selector__sequence">
                      <span className="branch-selector__sequence-icon">→</span>
                      <span className="branch-selector__sequence-text">
                        {branch.startTesuu + 1}手目からの変化 ({branch.length}手)
                      </span>
                    </div>
                  </div>
                )) : (
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
