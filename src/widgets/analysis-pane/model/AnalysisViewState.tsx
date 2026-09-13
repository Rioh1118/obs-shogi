import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useAppConfig } from "@/entities/app-config";
import {
  resolveAnalysisDisplayMode,
  type AnalysisDisplayMode,
} from "@/widgets/analysis-pane/model/displayMode";

type AnalysisViewState = {
  mode: AnalysisDisplayMode;
  setMode: (mode: AnalysisDisplayMode) => void;
  /** 選んでいる候補の `rank`。まだ選んでいなければ `null` */
  selectedRank: number | null;
  setSelectedRank: (rank: number) => void;
};

const AnalysisViewStateContext = createContext<AnalysisViewState | null>(null);

/**
 * 解析ビューが操作列と本体で分け合う状態。
 *
 * **操作列と本体はドックの別々の段に描かれる**ので、状態を prop で渡せない。
 * ドックはビューの `Provider` を両方の外側に巻く（`DockViewBinding.Provider`）。
 *
 * 表示モードは設定に残す（ADR-0010 決定3）。**選んだ候補は残さない** ——
 * 局面ごとに意味が変わる値で、恒久的な構成ではない。
 */
export function AnalysisViewStateProvider({ children }: { children: ReactNode }) {
  const { config, setDisplayConfig } = useAppConfig();
  const [selectedRank, setSelectedRank] = useState<number | null>(null);

  const mode = resolveAnalysisDisplayMode(config?.analysis_display_mode);

  const value = useMemo<AnalysisViewState>(
    () => ({
      mode,
      setMode: (next) => {
        // 押した結果が設定の既定として残る（ADR-0010 決定4）。書き損ねたときに
        // 出す場所はここに無いので、失敗しても表示は変わらない
        void setDisplayConfig({ analysis_display_mode: next }); // async-result-ignored: 出す場所が無く、失敗しても表示は動かない
      },
      selectedRank,
      // **局面が変わっても選択は落とさない。** 落とすと、手を進めながら3番目の候補を
      // 追う読み方ができない。指す先が消えた回は最善手へ落ちる（各モードの側）
      setSelectedRank,
    }),
    [mode, selectedRank, setDisplayConfig],
  );

  return (
    <AnalysisViewStateContext.Provider value={value}>{children}</AnalysisViewStateContext.Provider>
  );
}

export function useAnalysisViewState(): AnalysisViewState {
  const ctx = useContext(AnalysisViewStateContext);
  if (!ctx) {
    throw new Error("useAnalysisViewState must be used within AnalysisViewStateProvider");
  }
  return ctx;
}
