// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import FormField from "../Form/FormField";

afterEach(cleanup);

describe("FormField", () => {
  it("横並びでないときは余分な class を持たない", () => {
    const { container } = render(<FormField>中身</FormField>);
    expect(container.firstElementChild?.className).toBe("form__group");
  });

  it("横並びのときだけ修飾を足す", () => {
    const { container } = render(<FormField horizontal>中身</FormField>);
    expect(container.firstElementChild?.className).toBe("form__group form__group--horizontal");
  });
});
