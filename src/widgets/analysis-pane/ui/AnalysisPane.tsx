import { evaluationToPercentage } from "@/widgets/analysis-pane/lib/evaluation";
import { formatMoveSequence } from "@/shared/lib/shogi/moveText";
import { useEffect, useMemo, type ReactNode } from "react";
import CandidatesSection from "./CandidatesSection";
import CandidateTable from "./CandidateTable";
import EvaluationBar from "./EvaluationBar";
import { convertCandidateToSenteView } from "@/widgets/analysis-pane/lib/senteView";
import {
  buildCandidateRows,
  MAX_VISIBLE_CANDIDATES,
  type CandidateRow,
} from "@/widgets/analysis-pane/lib/candidateRows";
import { candidatesAreStale } from "@/widgets/analysis-pane/lib/visibleCandidates";
import { useVisibleCandidates } from "@/widgets/analysis-pane/lib/useVisibleCandidates";
import "./AnalysisPane.scss";
import { useAppConfig } from "@/entities/app-config";
import { useGame } from "@/entities/game";
import { useMateSearch } from "@/entities/mate-search";
import { mateOutcomeText } from "@/widgets/analysis-pane/lib/mateOutcome";
import type { AnalysisCandidate, Evaluation } from "@/entities/engine";
import {
  resolveAnalysisDisplayMode,
  useAnalysis,
  type AnalysisDisplayMode,
} from "@/entities/analysis";

/**
 * 見せ方ごとの本体。`Record` なので、綴りを足して本体を足さないと tsc が落ちる。
 *
 * `{mode === "table" && …}` を並べると、足し忘れた綴りではどの分岐も偽になり、
 * **解析タブが真っ白になる。エラーは出ない。**
 */
const BODY: Record<AnalysisDisplayMode, (props: { rows: readonly CandidateRow[] }) => ReactNode> = {
  table: ({ rows }) => <CandidateTable rows={rows} />,
  rows: ({ rows }) => <CandidatesSection rows={rows} />,
};

function AnalysisPane() {
  // **キャッシュの持ち主は `entities/analysis`。** この画面は鍵を組んで読み書きするだけで、
  // 保存場所を持たない。持つと、この画面が作り直されたときだけ停止中の候補手が消える
  // （理由は `entities/analysis/lib/candidateCache.ts`）。
  const { state, candidateCache } = useAnalysis();

  const { config } = useAppConfig();
  const { view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;
  const mate = useMateSearch();
  const { candidates: visibleCandidates, status, fileKey, cacheKey } = useVisibleCandidates();

  const currentTurn = gameView.currentTurn;

  // 読み筋は盤の局面から組む。キャッシュの鍵が別の局面を指していると（#568）、盤の局面では
  // 指せない手の並びが出るか、手が組めずに評価値だけの行になる
  const pvBaseSfen = currentSfen;

  const rows = useMemo(() => {
    const shown = visibleCandidates.slice(0, MAX_VISIBLE_CANDIDATES);
    const canConvert = !!pvBaseSfen && shown.length > 0;

    const senteCandidates: AnalysisCandidate[] = shown.map((c) =>
      convertCandidateToSenteView(c, currentTurn),
    );

    const senteMoves = canConvert
      ? senteCandidates.map((c) =>
          formatMoveSequence(
            pvBaseSfen,
            c.pv_line?.length ? c.pv_line : c.first_move ? [c.first_move] : [],
          ),
        )
      : shown.map(() => []);

    const senteEvaluations: (Evaluation | null)[] = senteCandidates.map(
      (c) => c.evaluation ?? null,
    );

    return buildCandidateRows(shown, senteMoves, senteEvaluations);
  }, [pvBaseSfen, currentTurn, visibleCandidates]);

  // 見せ方は設定が決める（ADR-0010 決定4 の改訂）。**局面ごとに変える値ではなく好み**
  const mode = resolveAnalysisDisplayMode(config?.analysis_display_mode);

  // 評価値バーは**モードに依らず本体の上**に出す。どのモードでも最善手は1行目なので、
  // 特定の行にぶら下げる置き場が無い。出すかどうかは設定（既定は出さない。ADR-0010 決定4）
  const bestEvaluation = rows.find((r) => r.isBest)?.evaluation ?? null;

  // 止まる前の候補手は、表も評価値バーも薄く出す。今の結果のように見せない
  const staleClass = !mate.ownsTable && candidatesAreStale(status) ? " analysis-pane--stale" : "";

  const mateOutcome =
    mate.ownsTable && mate.state.phase === "finished"
      ? mateOutcomeText(mate.state.outcome, mate.state.sfen)
      : null;

  // **キャッシュする側（下の effect）より先に宣言する。** React は宣言順に effect を走らせる。
  // `scopeTo` は宣言された棋譜が前と同じなら何もしない（`candidateCache.ts` の早期 return）
  // ので、順序が効くのは `fileKey` が前の宣言と食い違うレンダだけ。そこでキャッシュする側が
  // 先に走ると、新しい棋譜のキャッシュを書いた直後にそれを捨てる。
  useEffect(() => {
    candidateCache.scopeTo(fileKey);
  }, [candidateCache, fileKey]);

  useEffect(() => {
    if (!cacheKey) return;
    if (!currentSfen) return;
    if (state.candidates.length === 0) return;
    // エンジンが読んだ局面が盤と違うならキャッシュしない。キャッシュすると、鍵が指す局面とは
    // 別の局面の候補手が、停止したあとその局面の結果として出る。
    //
    // `analyzedSfen` が null のときもキャッシュしない。いま `candidates` が空でないときは必ず
    // `start_analysis` を通っているので null にはならないが、`stop_analysis` で
    // null へ戻す整理を入れると、短絡で判定が通って古い候補手が別の鍵へ焼き付く。
    //
    // **突き合わせるのは局面だけ。** 鍵が指す棋譜とエンジンの側は誰も見ていない → #568
    if (state.analyzedSfen !== currentSfen) return;

    candidateCache.remember(cacheKey, state.candidates);
  }, [candidateCache, cacheKey, currentSfen, state.candidates, state.analyzedSfen]);

  return (
    <section className="analysis-pane">
      {config?.show_evaluation_bar === true && (
        <div className={`analysis-pane__gauge${staleClass}`}>
          <EvaluationBar percentage={evaluationToPercentage(bestEvaluation)} />
        </div>
      )}

      {mateOutcome !== null && (
        <p className="analysis-pane__outcome" role="status">
          {mateOutcome}
        </p>
      )}

      <main className={`analysis-pane__body${staleClass}`}>{BODY[mode]({ rows })}</main>
    </section>
  );
}

export default AnalysisPane;
