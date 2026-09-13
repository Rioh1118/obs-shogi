import { BOUNDARY_LABELS } from "@/shared/ui/AppErrorBoundary";
import { RETRY_LABEL } from "@/shared/ui/error-fallback/ErrorFallbackBody";
import AnalysisPane from "@/widgets/analysis-pane/ui/AnalysisPane";
import AnalysisControls from "@/widgets/analysis-pane/ui/AnalysisControls";
import type { DockViewBindings } from "@/widgets/dock/model/bindings";

/**
 * ドックのタブの綴りから、実際の部品へ。**面を1枚足すときに触るのはここだけ。**
 *
 * 名簿（見出し・既定・外せるか）は `entities/dock`、器は `widgets/dock`。
 * 割り当てだけがここに在るのは、`widgets/dock` がビューのスライスを直に読むと
 * 「widgets に同層横断を1組も作らない」を破るため。`AppLayout` はこの表の中身を
 * 知らないので、**面を足しても `AppLayout.tsx` は1文字も動かない。**
 */
// **名乗り（`boundary`）はビューごとに別のものを選ぶ。** 2枚が同じ名乗りだと、
// 落ちたのがどちらかを画面からもログからも特定できない（`BOUNDARY_LABELS` の doc）
export const DOCK_VIEWS_BINDINGS: DockViewBindings = {
  analysis: {
    Body: AnalysisPane,
    Controls: AnalysisControls,
    boundary: BOUNDARY_LABELS.analysis,
    fallbackHint: `設定からエンジンを選び直してから「${RETRY_LABEL}」を押してください。`,
  },
};
