// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import IconButton from "../IconButton";

afterEach(cleanup);

describe("IconButton", () => {
  it("押すと onClick へイベントを渡す", () => {
    const onClick = vi.fn();
    render(
      <IconButton onClick={onClick} ariaLabel="開く">
        +
      </IconButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "開く" }));

    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0]).toHaveProperty("type", "click");
  });

  it("disabled なら押しても呼ばない", () => {
    const onClick = vi.fn();
    render(
      <IconButton onClick={onClick} ariaLabel="開く" disabled>
        +
      </IconButton>,
    );

    fireEvent.click(screen.getByRole("button", { name: "開く" }));

    expect(onClick).not.toHaveBeenCalled();
  });
});
