import { convertSfenSequence } from "@/widgets/analysis-pane/lib/sfenConverter";
import type { ConvertedMove } from "@/widgets/analysis-pane/lib/sfenConverter";
import { useEffect, useMemo } from "react";
import BestMoveSection from "./BestMoveSection";
import CandidatesSection from "./CandidatesSection";
import { convertCandidateToSenteView } from "@/widgets/analysis-pane/lib/usi";
import AnalysisPaneHeader from "./AnalysisPaneHeader";
import "./AnalysisPane.scss";
import StatsSection from "./StatsSection";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import type { AnalysisCandidate, Evaluation } from "@/entities/engine";
import { pickTopCandidate, useAnalysis } from "@/entities/analysis";

function AnalysisPane() {
  // **控えの持ち主は `entities/analysis`。** この画面は鍵を組んで読み書きするだけで、
  // 保存場所を持たない。持つと、この画面が作り直された回だけ停止中の候補手が消える
  // （理由は `entities/analysis/lib/candidateCache.ts`）。
  const { state, candidateCache } = useAnalysis();

  const { getCurrentTurn, state: gameState, view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const { selectedNode } = useFileTree();
  const { state: presetsState } = useEnginePresets();

  const engineKey = presetsState.selectedPresetId ?? "no-engine";
  const fileKey = selectedNode?.id ?? null;
  const tesuuPointer = gameState.cursor?.tesuuPointer ?? null;
  const cacheKey = fileKey && tesuuPointer ? `${engineKey}${fileKey}:${tesuuPointer}` : null;

  const currentTurn = getCurrentTurn();

  // **控える側（下の effect）より先に宣言する。** React は宣言順に effect を走らせる。
  // `scopeTo` は宣言された棋譜が前と同じなら何もしない（`candidateCache.ts` の早期 return）
  // ので、順序が効くのは `fileKey` が前の宣言と食い違うレンダだけ。そこで控える側が
  // 先に走ると、新しい棋譜の控えを書いた直後にそれを捨てる。
  useEffect(() => {
    candidateCache.scopeTo(fileKey);
  }, [candidateCache, fileKey]);

  useEffect(() => {
    if (!cacheKey) return;
    if (!currentSfen) return;
    if (state.candidates.length === 0) return;
    // エンジンが読んでいる局面が盤と離れている間は控えない。控えると、鍵が指す局面とは
    // 別の局面の候補手が、停止したあとその局面の結果として出る。
    // **突き合わせるのは局面だけ。** 鍵が指す棋譜とエンジンの側は誰も見ていない → #568
    if (state.analyzedSfen && state.analyzedSfen !== currentSfen) return;

    candidateCache.remember(cacheKey, state.candidates);
  }, [candidateCache, cacheKey, currentSfen, state.candidates, state.analyzedSfen]);

  // 停止中に出すのは控え。**控えを書くのはコミット後の effect なので、読むこのレンダは
  // 書かれる前の控えを見る。** 控えの先は ref で、書いても再レンダは起きないので、
  // ある鍵に初めて控えた回はその鍵が空のまま描かれ、次に deps が動くまで直らない。→ #569
  const visibleCandidates: readonly AnalysisCandidate[] = useMemo(() => {
    if (state.isAnalyzing) return state.candidates;
    return candidateCache.lookup(cacheKey);
  }, [candidateCache, state.isAnalyzing, state.candidates, cacheKey]);

  const pvBaseSfen = state.isAnalyzing ? state.analyzedSfen : currentSfen;

  const displayData = useMemo(() => {
    const canConvert = !!pvBaseSfen && !!visibleCandidates.length;

    const senteCandidates: AnalysisCandidate[] = visibleCandidates.map((c) =>
      convertCandidateToSenteView(c, currentTurn),
    );
    const top = pickTopCandidate(senteCandidates);
    const others = top ? senteCandidates.filter((c) => c.rank !== top.rank) : senteCandidates;

    const bestMoveSequence: ConvertedMove[] =
      canConvert && top?.pv_line?.length
        ? convertSfenSequence(pvBaseSfen!, top.pv_line)
        : top?.first_move
          ? convertSfenSequence(pvBaseSfen!, [top.first_move])
          : [];

    const candidateSequences: ConvertedMove[][] = canConvert
      ? others.map((c) =>
          convertSfenSequence(
            pvBaseSfen!,
            c.pv_line?.length ? c.pv_line : c.first_move ? [c.first_move] : [],
          ),
        )
      : [];

    const evaluation: Evaluation | null = top?.evaluation ?? null;

    const candidateEvaluations: (Evaluation | null)[] = others.map((c) => c.evaluation ?? null);

    const searchStats = top
      ? {
          depth: top.depth ?? null,
          nodes: top.nodes ?? null,
          time_ms: top.time_ms ?? null,
        }
      : null;

    return {
      bestMoveSequence,
      candidateSequences,
      evaluation,
      candidateEvaluations,
      searchStats,
      candidateCount: others.length,
    };
  }, [pvBaseSfen, currentTurn, visibleCandidates]);

  return (
    <section className="analysis-pane">
      <div className="analysis-pane__surface">
        <AnalysisPaneHeader />
        <main className="analysis-pane__body">
          <BestMoveSection
            bestMove={displayData.bestMoveSequence}
            evaluation={displayData.evaluation}
          />
          <CandidatesSection
            candidateSequences={displayData.candidateSequences}
            candidateEvaluations={displayData?.candidateEvaluations}
          />
        </main>
        <footer className="analysis-pane__footer">
          <StatsSection searchStats={displayData.searchStats} />
        </footer>
      </div>
    </section>
  );
}

export default AnalysisPane;
