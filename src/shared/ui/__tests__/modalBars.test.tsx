// @vitest-environment happy-dom
import { afterEach, describe, expect, test } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import ModalFoot from "../ModalFoot";
import ModalHead from "../ModalHead";

afterEach(cleanup);

describe("ModalHead", () => {
  test("題は見出しになり、説明と右に置くものを添える", () => {
    render(
      <ModalHead title="局面検索" description="同じ局面を探す">
        <span>検索中</span>
      </ModalHead>,
    );

    expect(screen.getByRole("heading", { level: 2 }).textContent).toBe("局面検索");
    expect(screen.getByText("同じ局面を探す").tagName).toBe("P");
    expect(screen.getByText("検索中")).toBeTruthy();
  });

  test("説明も右に置くものも無ければ、題だけを描く", () => {
    const { container } = render(<ModalHead title="設定" />);

    expect(container.querySelector("header")?.innerHTML).toBe(
      '<div class="modal-head__titles"><h2 class="modal-head__title">設定</h2></div>',
    );
  });

  test("閉じるボタンがあるときだけ、そのぶんを空ける", () => {
    const { container, rerender } = render(<ModalHead title="設定" />);
    const isClosable = () =>
      container.querySelector("header")?.className.includes("modal-head--closable");
    expect(isClosable()).toBe(false);

    rerender(<ModalHead title="設定" closable />);
    expect(isClosable()).toBe(true);
  });
});

describe("ModalFoot", () => {
  test("左に添え書き、右に押すものを置く", () => {
    const { container } = render(
      <ModalFoot start="保存で確定します">
        <button>保存</button>
      </ModalFoot>,
    );

    expect(container.querySelector(".modal-foot__start")?.textContent).toBe("保存で確定します");
    expect(container.querySelector(".modal-foot__actions")?.textContent).toBe("保存");
  });

  test("置くものが無い側は描かない", () => {
    const { container, rerender } = render(
      <ModalFoot>
        <button>閉じる</button>
      </ModalFoot>,
    );
    expect(container.querySelector(".modal-foot__start")).toBeNull();

    rerender(<ModalFoot start="添え書き" />);
    expect(container.querySelector(".modal-foot__actions")).toBeNull();
  });
});
