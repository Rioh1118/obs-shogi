import { useMemo } from "react";
import { HANDICAP_PRESETS } from "@/entities/kifu/model/handicap";
import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";
import { playerNames } from "@/entities/kifu/lib/playerNames";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import { stateFromPreset, stateToSfen } from "@/entities/position/lib/positionDraft";
import BoardPreview from "@/entities/position/ui/BoardPreview";
import "./ImportedKifuSummary.scss";

interface ImportedKifuSummaryProps {
  format: KifuFormat;
  moves: number;
  jkf: JKFData;
}

/** 欄が無いことを画面で表す。**空文字で埋めない** —— 打ち忘れと区別が付かなくなる */
const ABSENT = "—";

/**
 * 盤の一辺
 *
 * **器から測らない。** この面の盤は「貼った棋譜がこれか」を確かめるためのもので、
 * 器が高いほど大きくする理由が無い。測る形にすると、貼る前と後で欄の位置も動く。
 */
const BOARD_SIZE = 260;

/**
 * 読み取った棋譜の素性
 *
 * **「読めました」の1行より確かめられるものを出す。** 貼った人が知りたいのは
 * 「読めたか」ではなく**「貼ろうとした棋譜がこれか」**で、それに答えるのは
 * 対局者と初期局面。取り違えて貼っても、いまは作ってから開くまで気づけない。
 *
 * 初期局面を出すのは、**手合割と途中局面がここでしか分からない**ため。
 * 駒落ちや詰将棋の棋譜は、盤を見れば一目で違いが出る。
 */
function ImportedKifuSummary({ format, moves, jkf }: ImportedKifuSummaryProps) {
  const names = playerNames(jkf);

  /**
   * 初期局面
   *
   * **`initial` が無い棋譜は平手**（JKF の既定）。`preset` が一覧に無い綴り
   * （`OTHER` と、手合割として選ばせていない `HIKY`）のときは `data` が持っている。
   * どちらも取れなければ盤を出さない —— 出せない局面に平手を描くと、
   * **貼った棋譜と違う盤を見せる**ことになる。
   */
  const previewData = useMemo(() => {
    const initial = jkf.initial;
    const state =
      initial?.data ??
      (initial === undefined
        ? stateFromPreset("HIRATE")
        : HANDICAP_PRESETS.some((p) => p.value === initial.preset)
          ? stateFromPreset(initial.preset as (typeof HANDICAP_PRESETS)[number]["value"])
          : null);
    return state ? buildPreviewDataFromSfen(stateToSfen(state)) : null;
  }, [jkf]);

  const handicapLabel = useMemo(() => {
    const preset = jkf.initial?.preset;
    if (preset === undefined) return "平手";
    return HANDICAP_PRESETS.find((p) => p.value === preset)?.label ?? "この棋譜の局面";
  }, [jkf]);

  return (
    <div className="kifu-import__summary" role="status">
      {/* 盤が出せないときは欄ごと畳む。枠だけ残すと「読めていない」に見える。
          **駒台は出さない** —— 初期局面の持ち駒は駒落ちでも空で、
          「なし」の行が2本増えるだけになる */}
      {previewData && (
        <div className="kifu-import__summaryBoard">
          <BoardPreview pieces={previewData.board} size={BOARD_SIZE} showHands={false} />
        </div>
      )}

      <dl className="kifu-import__facts">
        <div className="kifu-import__fact">
          <dt>読み取った形式</dt>
          <dd>{format}</dd>
        </div>
        <div className="kifu-import__fact">
          <dt>手数</dt>
          <dd>{moves}手</dd>
        </div>
        <div className="kifu-import__fact">
          <dt>先手</dt>
          <dd>{names.sente ?? ABSENT}</dd>
        </div>
        <div className="kifu-import__fact">
          <dt>後手</dt>
          <dd>{names.gote ?? ABSENT}</dd>
        </div>
        <div className="kifu-import__fact">
          <dt>初期局面</dt>
          <dd>{handicapLabel}</dd>
        </div>
      </dl>
    </div>
  );
}

export default ImportedKifuSummary;
