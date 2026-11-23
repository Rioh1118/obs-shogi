// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render } from "@testing-library/react";

import SoftBreakText from "../SoftBreakText";

/** パスとファイル名の折りどころ。文字は1字も変えない */

afterEach(cleanup);

const parts = (text: string) => {
  const { container } = render(<SoftBreakText text={text} />);
  const shown: string[] = [""];
  for (const node of container.childNodes) {
    if (node.nodeName === "WBR") shown.push("");
    else shown[shown.length - 1] += node.textContent;
  }
  return { shown, all: container.textContent };
};

describe("SoftBreakText", () => {
  test.each([
    ["/Users/me/ShogiAI", ["/", "Users/", "me/", "ShogiAI"]],
    ["YaneuraOu_SFNN-V990", ["YaneuraOu_", "SFNN-", "V990"]],
    ["C:\\ai\\nn.bin", ["C:\\", "ai\\", "nn.", "bin"]],
    ["研究用", ["研究用"]],
    ["", [""]],
  ])("%s は、区切りの後で折れる", (text, shown) => {
    expect(parts(text)).toEqual({ shown, all: text });
  });
});
