// @vitest-environment happy-dom
import { createRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { SCheckbox, SField, SInput, SPath, SSection, SSelect, SStats } from "..";
import SRadioGroup from "../SRadioGroup";
import SettingsBadge from "../SettingsBadge";

/** 設定の画面が共通で使う部品。呼び手が頼っている形を見る */

afterEach(cleanup);

describe("SSection", () => {
  test("題が節の名前になる", () => {
    render(
      <SSection title="状態">
        <p>中身</p>
      </SSection>,
    );

    expect(screen.getByRole("region", { name: "状態" }).textContent).toContain("中身");
  });

  test("題も操作も無ければ頭を出さない", () => {
    const { container } = render(<SSection>中身</SSection>);

    expect(container.querySelector(".sui-section__head")).toBeNull();
    expect(container.querySelector(".sui-section")?.hasAttribute("aria-labelledby")).toBe(false);
  });

  test("説明と操作を頭に出す", () => {
    const { container } = render(
      <SSection title="状態" description="説明" actions={<button>押す</button>}>
        中身
      </SSection>,
    );

    expect(container.querySelector(".sui-section__desc")?.textContent).toBe("説明");
    expect(container.querySelector(".sui-section__actions")?.textContent).toBe("押す");
  });

  test("題が無くても操作があれば頭を出す", () => {
    const { container } = render(<SSection actions={<button>押す</button>}>中身</SSection>);

    expect(container.querySelector(".sui-section__actions")?.textContent).toBe("押す");
    expect(container.querySelector(".sui-section__title")).toBeNull();
  });

  test("件数は題に添え、節の名前には入れない", () => {
    const { container } = render(
      <SSection title="状態" count={0}>
        中身
      </SSection>,
    );

    expect(container.querySelector(".sui-section__count")?.textContent).toBe("0");
    expect(screen.getByRole("region", { name: "状態" })).toBeTruthy();
  });

  test("操作が偽なら置き場を出さない", () => {
    const { container } = render(
      <SSection title="状態" actions={false}>
        中身
      </SSection>,
    );

    expect(container.querySelector(".sui-section__actions")).toBeNull();
  });
});

describe("SField", () => {
  test("題と説明と中身を出す", () => {
    const { container } = render(
      <SField label="題" description="説明" right={<button>右</button>}>
        <input />
      </SField>,
    );

    expect(container.querySelector(".sui-field__label")?.textContent).toBe("題");
    expect(container.querySelector(".sui-field__desc")?.textContent).toBe("説明");
    expect(container.querySelector(".sui-field__right")?.textContent).toBe("右");
    expect(container.querySelector(".sui-field__control input")).not.toBeNull();
  });

  test("題が無くても右があれば頭を出す", () => {
    const { container } = render(<SField right={<button>右</button>}>中身</SField>);

    expect(container.querySelector(".sui-field__right")?.textContent).toBe("右");
    expect(container.querySelector(".sui-field__label")).toBeNull();
  });

  test("題も右も無ければ頭を出さない", () => {
    const { container } = render(<SField>中身</SField>);

    expect(container.querySelector(".sui-field__head")).toBeNull();
  });

  test("失敗があれば補足の代わりに出す", () => {
    const { container, rerender } = render(<SField hint="補足">中身</SField>);
    expect(container.querySelector(".sui-field__hint")?.textContent).toBe("補足");

    rerender(
      <SField hint="補足" error="失敗">
        中身
      </SField>,
    );

    expect(screen.getByRole("alert").textContent).toBe("失敗");
    expect(container.querySelector(".sui-field__hint")).toBeNull();
  });
});

describe("SField の並べ方", () => {
  test.each([
    [true, "sui-field sui-field--inline"],
    [false, "sui-field"],
  ])("名前を欄の左に置くか（%s）", (inline, className) => {
    const { container } = render(
      <SField label="題" inline={inline}>
        中身
      </SField>,
    );

    expect(container.querySelector(".sui-field")?.className).toBe(className);
  });
});

describe("SInput", () => {
  test("入力の属性と ref を素通しする", () => {
    const ref = createRef<HTMLInputElement>();
    render(<SInput ref={ref} defaultValue="値" aria-label="欄" className="extra" />);

    const input = screen.getByRole<HTMLInputElement>("textbox", { name: "欄" });
    expect(ref.current).toBe(input);
    expect(input.value).toBe("値");
    expect(input.className).toBe("sui-input extra");
  });

  test("不正の属性を付ける", () => {
    const { rerender } = render(<SInput aria-label="欄" invalid />);
    const input = () => screen.getByRole("textbox", { name: "欄" });

    expect(input().getAttribute("data-invalid")).toBe("true");
    expect(input().getAttribute("aria-invalid")).toBe("true");

    rerender(<SInput aria-label="欄" invalid={false} />);

    expect(input().getAttribute("data-invalid")).toBe("false");
    expect(input().hasAttribute("aria-invalid")).toBe(false);
  });
});

describe("SSelect", () => {
  const options = [
    { value: "a", label: "甲" },
    { value: "b", label: "乙", disabled: true },
  ];

  test("選択肢を並べ、無効の属性を写す", () => {
    render(<SSelect aria-label="欄" value="a" onChange={() => {}} options={options} />);

    const items = screen.getAllByRole<HTMLOptionElement>("option");
    expect(items.map((o) => [o.value, o.textContent, o.disabled])).toEqual([
      ["a", "甲", false],
      ["b", "乙", true],
    ]);
  });

  test("空の値のときの案内は選べない行で出す", () => {
    render(
      <SSelect
        aria-label="欄"
        value=""
        onChange={() => {}}
        options={options}
        placeholder="選択してください"
      />,
    );

    const first = screen.getAllByRole<HTMLOptionElement>("option")[0];
    expect([first.value, first.textContent, first.disabled]).toEqual([
      "",
      "選択してください",
      true,
    ]);
  });

  test("案内が無ければ足さない", () => {
    render(<SSelect aria-label="欄" value="a" onChange={() => {}} options={options} />);

    expect(screen.getAllByRole("option")).toHaveLength(2);
  });

  test("値が無ければ空として渡す", () => {
    render(<SSelect aria-label="欄" onChange={() => {}} options={options} placeholder="案内" />);

    expect(screen.getByRole<HTMLSelectElement>("combobox", { name: "欄" }).value).toBe("");
  });

  test("不正の属性を付け、選ぶと呼ぶ", () => {
    const onChange = vi.fn();
    const { container } = render(
      <SSelect aria-label="欄" value="a" onChange={onChange} options={options} invalid />,
    );

    const select = screen.getByRole("combobox", { name: "欄" });
    expect(container.querySelector(".sui-select")?.getAttribute("data-invalid")).toBe("true");
    expect(select.getAttribute("aria-invalid")).toBe("true");

    fireEvent.change(select, { target: { value: "a" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  test("ref を select へ渡す", () => {
    const ref = createRef<HTMLSelectElement>();
    render(<SSelect ref={ref} aria-label="欄" value="a" onChange={() => {}} options={options} />);

    expect(ref.current).toBe(screen.getByRole("combobox", { name: "欄" }));
  });
});

describe("SRadioGroup", () => {
  const options = [
    { value: "a", label: "甲", description: "説明" },
    { value: "b", label: "乙" },
  ];

  test("選んでいる値に印を付け、選ぶと値を返す", () => {
    const onChange = vi.fn();
    render(<SRadioGroup name="n" value="a" onChange={onChange} options={options} />);

    const radios = screen.getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => r.checked)).toEqual([true, false]);

    fireEvent.click(radios[1]);
    expect(onChange).toHaveBeenCalledWith("b");
  });

  test("説明は持つ選択肢にだけ出す", () => {
    const { container } = render(
      <SRadioGroup name="n" value="a" onChange={() => {}} options={options} />,
    );

    expect(container.querySelectorAll(".sui-radio__desc")).toHaveLength(1);
  });

  test("並べ方の既定は縦で、列の数を持たない", () => {
    const { container } = render(
      <SRadioGroup name="n" value="a" onChange={() => {}} options={options} />,
    );

    const group = container.querySelector<HTMLElement>(".sui-radio")!;
    expect(group.getAttribute("data-layout")).toBe("list");
    expect(group.style.getPropertyValue("--cols")).toBe("");
  });

  test("区切りボタンでも、選んでいる値に印を付け、列の数を持たない", () => {
    const { container } = render(
      <SRadioGroup
        name="n"
        value="b"
        onChange={() => {}}
        options={options}
        layout="segment"
        columns={3}
      />,
    );

    const group = container.querySelector<HTMLElement>(".sui-radio")!;
    expect(group.getAttribute("data-layout")).toBe("segment");
    expect(group.style.getPropertyValue("--cols")).toBe("");
    expect(
      [...container.querySelectorAll<HTMLElement>(".sui-radio__item")].map(
        (item) => item.dataset.checked,
      ),
    ).toEqual(["false", "true"]);
  });

  test("格子では列の数を渡す", () => {
    const { container } = render(
      <SRadioGroup
        name="n"
        value="a"
        onChange={() => {}}
        options={options}
        layout="grid"
        columns={3}
      />,
    );

    const group = container.querySelector<HTMLElement>(".sui-radio")!;
    expect(group.getAttribute("data-layout")).toBe("grid");
    expect(group.style.getPropertyValue("--cols")).toBe("3");
  });
});

describe("SStats", () => {
  test("名前と値を並べ、次の一手は持つものにだけ添える", () => {
    const { container } = render(
      <SStats
        items={[
          { label: "エンジン", value: "0 件", hint: "engines/ に置いてください" },
          { label: "警告", value: 0 },
        ]}
      />,
    );

    expect(
      [...container.querySelectorAll(".sui-stats__item")].map((item) =>
        [...item.children].map((cell) => cell.textContent),
      ),
    ).toEqual([
      ["エンジン", "0 件", "engines/ に置いてください"],
      ["警告", "0"],
    ]);
  });
});

describe("SPath", () => {
  test("長いパスも全部を出し、題にも持つ", () => {
    const path = "/Users/me/Documents/とても長い_フォルダの-名前/KIFU_ROOT";
    const { container } = render(<SPath path={path} />);

    const box = container.querySelector<HTMLElement>(".sui-path")!;
    expect(box.textContent).toBe(path);
    expect(box.title).toBe(path);
    expect(box.className).toBe("sui-path");
  });

  test("まだ決まっていなければ、その文を出す", () => {
    const { container } = render(<SPath path="" placeholder="未設定" />);

    const box = container.querySelector<HTMLElement>(".sui-path")!;
    expect(box.textContent).toBe("未設定");
    expect(box.className).toBe("sui-path sui-path--none");
    expect(box.hasAttribute("title")).toBe(false);
  });
});

describe("SCheckbox", () => {
  test("名前を押しても切り替わり、添え書きを出す", () => {
    const onChange = vi.fn();
    render(
      <SCheckbox checked={false} onChange={onChange} note="外せません">
        検討
      </SCheckbox>,
    );

    fireEvent.click(screen.getByText("検討"));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(screen.getByRole<HTMLInputElement>("checkbox").checked).toBe(false);
    expect(screen.getByText("外せません").className).toBe("sui-check__note");
  });

  test("押せないときは切り替わらない", () => {
    const onChange = vi.fn();
    render(
      <SCheckbox checked disabled onChange={onChange}>
        検討
      </SCheckbox>,
    );

    fireEvent.click(screen.getByText("検討"));

    expect(onChange).not.toHaveBeenCalled();
    expect(document.querySelector(".sui-check__note")).toBeNull();
  });
});

describe("SettingsBadge", () => {
  test("既定は控えめな札で、記号を付けない", () => {
    render(<SettingsBadge>札</SettingsBadge>);

    expect(screen.getByText("札").className).toBe("sbadge sbadge--muted");
    expect(screen.getByText("札").querySelector("svg")).toBeNull();
  });

  test.each(["warn", "danger"] as const)("直す必要があるもの（%s）には、記号を添える", (tone) => {
    render(<SettingsBadge tone={tone}>札</SettingsBadge>);

    expect(screen.getByText("札").className).toBe(`sbadge sbadge--${tone}`);
    expect(screen.getByText("札").querySelector("svg")).not.toBeNull();
  });
});
