import { useMemo } from "react";
import { kifuOverview } from "@/entities/kifu/lib/kifuOverview";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";
import "./ImportedKifuSummary.scss";

interface ImportedKifuSummaryProps {
  format: KifuFormat;
  moves: number;
  jkf: JKFData;
}

/**
 * 読み取った棋譜の素性
 *
 * **「読めました」の1行より確かめられるものを出す。** 貼った人が知りたいのは
 * 「読めたか」ではなく**「貼ろうとした棋譜がこれか」**で、それに答えるのは
 * 対局者と棋戦と日付。取り違えて貼っても、いまは作ってから開くまで気づけない。
 *
 * **欄の並びと欄名は `kifuOverview` が決める**（JKF の語彙なので）。
 * ここが決めるのは、それをどう並べるかだけ。
 */
function ImportedKifuSummary({ format, moves, jkf }: ImportedKifuSummaryProps) {
  // 棋譜が変わったときだけ組み直す。ヘッダを全部なめる
  const facts = useMemo(() => kifuOverview(jkf), [jkf]);

  return (
    <dl className="kifu-import__summary" role="status">
      {/* 読み取りの結果は棋譜に書いてあることではないので、欄名で区別を付ける */}
      <div className="kifu-import__fact">
        <dt>読み取った形式</dt>
        <dd>{format}</dd>
      </div>
      <div className="kifu-import__fact">
        <dt>手数</dt>
        <dd>{moves}手</dd>
      </div>
      {facts.map((fact) => (
        <div className="kifu-import__fact" key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default ImportedKifuSummary;
