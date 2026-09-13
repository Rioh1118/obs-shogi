import "./DisplayModePreview.scss";
import type { AnalysisDisplayMode } from "@/entities/analysis";

/**
 * 候補手の見せ方の見本。**言葉より先に形を見せる。**
 *
 * 「表 / 行」は名前だけでは何が変わるか読めない。選ぶ前に並び方そのものを出す。
 *
 * **中身は持たない。** 実データを描くと、設定を開いた時点の解析結果に見えてしまう。
 * 出すのは骨だけで、読み上げは選択肢のラベルが担う（`aria-hidden`）。
 */
function DisplayModePreview({ mode }: { mode: AnalysisDisplayMode }) {
  return (
    <span className={`displayModePreview displayModePreview--${mode}`} aria-hidden="true">
      {/* 行: 列を作らず、詰めて並べる */}
      {mode === "rows" &&
        [0, 1, 2, 3, 4, 5].map((n) => (
          <i
            key={n}
            className={`displayModePreview__fill ${n === 0 ? "displayModePreview__fill--best" : ""}`}
          />
        ))}

      {/* 表: 見出しの段があり、下が列で揃う */}
      {mode === "table" && (
        <>
          <span className="displayModePreview__cells displayModePreview__cells--head">
            {[0, 1, 2, 3].map((n) => (
              <i key={n} className="displayModePreview__cell" />
            ))}
          </span>
          {[0, 1, 2].map((n) => (
            <span key={n} className="displayModePreview__cells">
              {[0, 1, 2, 3].map((c) => (
                <i
                  key={c}
                  className={`displayModePreview__cell ${n === 0 ? "displayModePreview__cell--best" : ""}`}
                />
              ))}
            </span>
          ))}
        </>
      )}
    </span>
  );
}

export default DisplayModePreview;
