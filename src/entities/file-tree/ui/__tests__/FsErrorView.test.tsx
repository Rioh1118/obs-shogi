// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";

import FsErrorView from "../FsErrorView";

afterEach(cleanup);

/**
 * 失敗したパスは省かずに出す。狭い所（サイドバーのツリー）でも区切りの後で折る。
 * どこでも折ると、`KIFU_ROO` と `T` のように最後の字だけが次の行に落ちる
 */
describe("FsErrorView のパス", () => {
  test("区切りの後でだけ折れる", () => {
    const { container } = render(
      <FsErrorView
        error={{ code: "permission_denied", message: "denied", path: "/Users/me/KIFU_ROOT" }}
      />,
    );
    const path = container.querySelector(".fsError__path");

    expect(path?.textContent).toBe("/Users/me/KIFU_ROOT");
    expect(path?.querySelectorAll("wbr").length).toBeGreaterThan(0);
  });
});
