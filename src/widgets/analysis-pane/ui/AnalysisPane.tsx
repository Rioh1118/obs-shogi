import {
  convertSfenSequence,
  evaluationToPercentage,
} from "@/widgets/analysis-pane/lib/sfenConverter";
import { useEffect, useMemo, useState } from "react";
import CandidateDetail from "./CandidateDetail";
import CandidatesSection from "./CandidatesSection";
import CandidateTable from "./CandidateTable";
import EvaluationBar from "./EvaluationBar";
import { convertCandidateToSenteView } from "@/widgets/analysis-pane/lib/usi";
import {
  buildCandidateRows,
  MAX_VISIBLE_CANDIDATES,
} from "@/widgets/analysis-pane/lib/candidateRows";
import "./AnalysisPane.scss";
import StatsSection from "./StatsSection";
import { useAppConfig } from "@/entities/app-config";
import { useFileTree } from "@/entities/file-tree";
import { useGame } from "@/entities/game";
import { useEnginePresets } from "@/entities/engine-presets/model/useEnginePresets";
import type { AnalysisCandidate, Evaluation } from "@/entities/engine";
import { pickTopCandidate, resolveAnalysisDisplayMode, useAnalysis } from "@/entities/analysis";

function AnalysisPane() {
  // 選んでいる候補は**3つの見せ方で共有する**（切り替えても選択が動かない）。
  // 局面が変わっても落とさない —— 手を進めながら3番手を追う読み方ができなくなる。
  // 指す先が消えた回は最善手へ落ちる（各モードの側）
  const [selectedRank, setSelectedRank] = useState<number | null>(null);
  // **控えの持ち主は `entities/analysis`。** この画面は鍵を組んで読み書きするだけで、
  // 保存場所を持たない。持つと、この画面が作り直された回だけ停止中の候補手が消える
  // （理由は `entities/analysis/lib/candidateCache.ts`）。
  const { state, candidateCache } = useAnalysis();

  const { config } = useAppConfig();
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
    // エンジンが読んだ局面が盤と違うなら控えない。控えると、鍵が指す局面とは
    // 別の局面の候補手が、停止したあとその局面の結果として出る。
    //
    // **`analyzedSfen` が無い回も閉じる。** いま `candidates` が空でない回は必ず
    // `start_analysis` を通っているので null にはならないが、`stop_analysis` で
    // null へ戻す整理を入れると、短絡で門が開いて古い候補手が別の鍵へ焼き付く。
    //
    // **突き合わせるのは局面だけ。** 鍵が指す棋譜とエンジンの側は誰も見ていない → #568
    if (state.analyzedSfen !== currentSfen) return;

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

  const rows = useMemo(() => {
    const shown = visibleCandidates.slice(0, MAX_VISIBLE_CANDIDATES);
    const canConvert = !!pvBaseSfen && shown.length > 0;

    const senteCandidates: AnalysisCandidate[] = shown.map((c) =>
      convertCandidateToSenteView(c, currentTurn),
    );

    const senteMoves = canConvert
      ? senteCandidates.map((c) =>
          convertSfenSequence(
            pvBaseSfen,
            c.pv_line?.length ? c.pv_line : c.first_move ? [c.first_move] : [],
          ),
        )
      : shown.map(() => []);

    const senteEvaluations: (Evaluation | null)[] = senteCandidates.map(
      (c) => c.evaluation ?? null,
    );

    // Δ は**手番視点のまま**の候補（`shown`）から取る。先手視点に揃えたあとだと
    // 後手番で符号が反転して「最善手がいちばん小さい Δ」になる
    return buildCandidateRows(shown, senteMoves, senteEvaluations);
  }, [pvBaseSfen, currentTurn, visibleCandidates]);

  const searchStats = useMemo(() => {
    const top = pickTopCandidate([...visibleCandidates]);
    return top
      ? { depth: top.depth ?? null, nodes: top.nodes ?? null, time_ms: top.time_ms ?? null }
      : null;
  }, [visibleCandidates]);

  // 見せ方は設定が決める（ADR-0010 決定4 の改訂）。**局面ごとに変える値ではなく好み**
  const mode = resolveAnalysisDisplayMode(config?.analysis_display_mode);

  // 評価値バーは**モードに依らず本体の上**に出す。どのモードでも最善手は1行目なので、
  // 特定の行にぶら下げる置き場が無い。出すかどうかは設定（既定は出さない。ADR-0010 決定4）
  const bestEvaluation = rows.find((r) => r.isBest)?.evaluation ?? null;

  return (
    <section className="analysis-pane">
      {config?.show_evaluation_bar === true && (
        <div className="analysis-pane__gauge">
          <EvaluationBar percentage={evaluationToPercentage(bestEvaluation)} />
        </div>
      )}

      <main className="analysis-pane__body">
        {mode === "table" && (
          <CandidateTable rows={rows} selectedRank={selectedRank} onSelect={setSelectedRank} />
        )}
        {mode === "detail" && (
          <CandidateDetail rows={rows} selectedRank={selectedRank} onSelect={setSelectedRank} />
        )}
        {mode === "rows" && <CandidatesSection rows={rows} />}
      </main>

      <footer className="analysis-pane__footer">
        <StatsSection searchStats={searchStats} />
      </footer>
    </section>
  );
}

export default AnalysisPane;
