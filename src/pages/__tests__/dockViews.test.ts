import { describe, expect, test } from "vitest";

import { BOUNDARY_LABELS } from "@/shared/ui/AppErrorBoundary";
import AnalysisControls from "@/widgets/analysis-pane/ui/AnalysisControls";
import AnalysisPane from "@/widgets/analysis-pane/ui/AnalysisPane";
import BookControls from "@/widgets/book-view/ui/BookControls";
import BookView from "@/widgets/book-view/ui/BookView";
import { DOCK_VIEWS_BINDINGS } from "../dockViews";

/**
 * ドックのタブごとに、本体と操作列と境界の名乗りを取り違えていないこと。
 *
 * 取り違えても型は通る（どの部品も同じ形で受ける）。定跡のタブに解析の操作列が出るか、
 * 定跡が落ちたのに「検討を表示できませんでした」と出る。
 */
describe("ドックの割り当て", () => {
  test("検討のタブは検討の部品と名乗りを持つ", () => {
    expect(DOCK_VIEWS_BINDINGS.analysis).toMatchObject({
      Body: AnalysisPane,
      Controls: AnalysisControls,
      boundary: BOUNDARY_LABELS.analysis,
    });
  });

  test("定跡のタブは定跡の部品と名乗りを持つ", () => {
    expect(DOCK_VIEWS_BINDINGS.book).toMatchObject({
      Body: BookView,
      Controls: BookControls,
      boundary: BOUNDARY_LABELS.book,
    });
  });
});
