import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * ツリーを取り直すきっかけは2つ。監視の合図と、ウィンドウにフォーカスが戻ったとき。
 * フォーカスは監視が止まっているときの保険なので、外れたときに取り直しても意味が無い。
 */

type Handler = (event: { payload: unknown }) => void;
const listened = new Map<string, Handler>();
let onFocus: Handler | null = null;
const unlisten = vi.fn();

vi.mock("@tauri-apps/api/event", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/event")>();
  const mocked = {
    ...actual,
    listen: (async (name: string, handler: Handler) => {
      listened.set(name, handler);
      return unlisten;
    }) as unknown as typeof actual.listen,
  };
  return mocked satisfies typeof import("@tauri-apps/api/event");
});

vi.mock("@tauri-apps/api/window", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tauri-apps/api/window")>();
  const mocked = {
    ...actual,
    getCurrentWindow: (() => ({
      onFocusChanged: async (handler: Handler) => {
        onFocus = handler;
        return unlisten;
      },
    })) as unknown as typeof actual.getCurrentWindow,
  };
  return mocked satisfies typeof import("@tauri-apps/api/window");
});

const { listenWorkspaceChanges } = await import("../events");

beforeEach(() => {
  listened.clear();
  onFocus = null;
  unlisten.mockClear();
});

describe("listenWorkspaceChanges", () => {
  it("監視の合図で取り直す", async () => {
    const onChange = vi.fn();
    await listenWorkspaceChanges(onChange);

    listened.get("workspace-changed")!({ payload: null });

    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("フォーカスが戻ったときだけ取り直し、外れたときは取り直さない", async () => {
    const onChange = vi.fn();
    await listenWorkspaceChanges(onChange);

    onFocus!({ payload: false });
    expect(onChange).not.toHaveBeenCalled();
    onFocus!({ payload: true });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("解除で両方を外す", async () => {
    const stop = await listenWorkspaceChanges(vi.fn());
    stop();
    expect(unlisten).toHaveBeenCalledTimes(2);
  });
});
