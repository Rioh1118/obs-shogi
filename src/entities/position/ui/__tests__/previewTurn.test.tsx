// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "../PositionPreviewPane";

/**
 * 手番を出すのはプレビューの部品側（呼び手ではない）。
 *
 * **記号だけ・語だけにしない。** 記号は盤の下の持ち駒の段と対応付けるために要り、
 * 語は記号の読み方を知らない利用者のために要る。片方に寄せると、どちらかが読めなくなる。
 */

afterEach(cleanup);

const HIRATE_BLACK = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const HIRATE_WHITE = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL w - 1";

describe("プレビューの手番", () => {
  test("先手番の局面", () => {
    render(<PreviewPane previewData={buildPreviewDataFromSfen(HIRATE_BLACK)} />);
    expect(screen.getByText("☗ 先手番")).toBeTruthy();
  });

  test("後手番の局面", () => {
    render(<PreviewPane previewData={buildPreviewDataFromSfen(HIRATE_WHITE)} />);
    expect(screen.getByText("☖ 後手番")).toBeTruthy();
  });

  // 局面が無いあいだは盤も出ていない。**手番だけ残さない** ——
  // 前に見ていた局面の手番が、次の局面の読み込み中に居座る
  test("局面が無ければ出さない", () => {
    render(<PreviewPane previewData={null} />);
    expect(document.querySelector(".position-navigation-modal__turn-tab")).toBeNull();
  });
});
