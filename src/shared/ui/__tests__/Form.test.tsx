// @vitest-environment happy-dom
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import Button from "../Button/Button";
import Form from "../Form/Form";

afterEach(cleanup);

describe("Form", () => {
  test("欄と、押すものの行を分ける。押すものはフォームの中にあり、送信できる", () => {
    const onSubmit = vi.fn(async (e: { preventDefault: () => void }) => e.preventDefault());
    const { container } = render(
      <Form onSubmit={onSubmit} foot={<Button type="submit">作成</Button>}>
        <input aria-label="名前" />
      </Form>,
    );

    const fields = container.querySelector(".form__fields");
    expect(fields?.contains(screen.getByLabelText("名前"))).toBe(true);
    const button = screen.getByRole<HTMLButtonElement>("button", { name: "作成" });
    expect(fields?.contains(button)).toBe(false);
    expect(button.closest(".modal-foot")).not.toBeNull();
    expect(button.form).toBe(container.querySelector("form"));

    fireEvent.submit(container.querySelector("form")!);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
