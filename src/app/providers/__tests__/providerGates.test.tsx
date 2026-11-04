// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { createContext, useContext, type ReactNode } from "react";

import type { JKFData } from "@/entities/kifu/model/jkf";
import type { KifuFormat } from "@/entities/kifu/model/kifu";

/**
 * 上から取った値を下の provider へ prop で渡す器が、何をどの形で渡すか。
 *
 * どの器も、渡し損ねても型と描画は通る。根が `null` のまま検索が走らない、
 * 定跡が局面を引かない、保存先が無いまま指せる、といった形で黙って壊れる。
 * provider は差し替え、受け取った prop だけを見る。
 */

/** 差し替えた provider が最後に受け取った prop（`children` を除く） */
const seen: Record<string, Record<string, unknown>> = {};

/** いちばん近くで包んでいる、差し替えた provider の名前 */
const Inside = createContext<string | null>(null);

/** 差し替えた橋を包んでいた provider の名前。橋は `null` を返すので DOM では探せない */
const placedIn: Record<string, string | null> = {};

function recorder(name: string) {
  return ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => {
    seen[name] = props;
    return (
      <div data-testid={name}>
        <Inside.Provider value={name}>{children}</Inside.Provider>
      </div>
    );
  };
}

function placedBridge(name: string) {
  return () => {
    placedIn[name] = useContext(Inside);
    return null;
  };
}

let config: { root_dir: string | null } | null = null;
let tree: { activeKifuPath: string | null; kifuFormat: KifuFormat | null } = {
  activeKifuPath: null,
  kifuFormat: null,
};
let currentSfen = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
let presets: { runtimeConfig: unknown; selectedPreset: unknown } = {
  runtimeConfig: null,
  selectedPreset: null,
};
const saveKifuToFile = vi.fn();
const moveGate = { name: "moveGate" };
const positionSync = { name: "positionSync" };
const ruling = { name: "ruling" };

vi.mock("@/entities/app-config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/app-config")>();
  const mocked = {
    ...actual,
    useAppConfig: (() => ({ config })) as unknown as typeof actual.useAppConfig,
  };
  return mocked satisfies typeof import("@/entities/app-config");
});
vi.mock("@/entities/file-tree", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/file-tree")>();
  const mocked = {
    ...actual,
    FileTreeProvider: recorder("FileTreeProvider") as unknown as typeof actual.FileTreeProvider,
    useFileTree: (() => tree) as unknown as typeof actual.useFileTree,
  };
  return mocked satisfies typeof import("@/entities/file-tree");
});
vi.mock("@/entities/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/search")>();
  const mocked = {
    ...actual,
    PositionSearchProvider: recorder(
      "PositionSearchProvider",
    ) as unknown as typeof actual.PositionSearchProvider,
  };
  return mocked satisfies typeof import("@/entities/search");
});
vi.mock("@/entities/book", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/book")>();
  const mocked = {
    ...actual,
    BookProvider: recorder("BookProvider") as unknown as typeof actual.BookProvider,
  };
  return mocked satisfies typeof import("@/entities/book");
});
vi.mock("@/entities/game", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game")>();
  const mocked = {
    ...actual,
    GameProvider: recorder("GameProvider") as unknown as typeof actual.GameProvider,
    useGame: (() => ({ view: { currentSfen } })) as unknown as typeof actual.useGame,
  };
  return mocked satisfies typeof import("@/entities/game");
});
vi.mock("@/entities/kifu/api/write", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/kifu/api/write")>();
  const mocked = {
    ...actual,
    saveKifuToFile: saveKifuToFile as unknown as typeof actual.saveKifuToFile,
  };
  return mocked satisfies typeof import("@/entities/kifu/api/write");
});
vi.mock(
  "@/app/providers/bridges/GameFileTreeBridge",
  () =>
    ({
      GameFileTreeBridge: placedBridge("GameFileTreeBridge"),
    }) satisfies typeof import("@/app/providers/bridges/GameFileTreeBridge"),
);
vi.mock("@/features/game-move", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/game-move")>();
  const mocked = {
    ...actual,
    useGameMoveGate: (() => moveGate) as unknown as typeof actual.useGameMoveGate,
    GameMoveBridge: placedBridge("GameMoveBridge"),
  };
  return mocked satisfies typeof import("@/features/game-move");
});
vi.mock("@/entities/engine-presets/model/useEnginePresets", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/entities/engine-presets/model/useEnginePresets")>();
  const mocked = {
    ...actual,
    useEnginePresets: (() => presets) as unknown as typeof actual.useEnginePresets,
  };
  return mocked satisfies typeof import("@/entities/engine-presets/model/useEnginePresets");
});
vi.mock("@/entities/engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/engine")>();
  const mocked = {
    ...actual,
    EngineProvider: recorder("EngineProvider") as unknown as typeof actual.EngineProvider,
  };
  return mocked satisfies typeof import("@/entities/engine");
});
vi.mock("@/entities/analysis", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/analysis")>();
  const mocked = {
    ...actual,
    AnalysisProvider: recorder("AnalysisProvider") as unknown as typeof actual.AnalysisProvider,
  };
  return mocked satisfies typeof import("@/entities/analysis");
});
vi.mock("@/features/engine-position-sync", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/engine-position-sync")>();
  const mocked = {
    ...actual,
    useEnginePositionSync: (() => positionSync) as unknown as typeof actual.useEnginePositionSync,
  };
  return mocked satisfies typeof import("@/features/engine-position-sync");
});
vi.mock("@/entities/game-session", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/entities/game-session")>();
  const mocked = {
    ...actual,
    GameSessionProvider: recorder(
      "GameSessionProvider",
    ) as unknown as typeof actual.GameSessionProvider,
  };
  return mocked satisfies typeof import("@/entities/game-session");
});
vi.mock("@/features/game-ruling", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/game-ruling")>();
  const mocked = {
    ...actual,
    useGameRuling: (() => ruling) as unknown as typeof actual.useGameRuling,
  };
  return mocked satisfies typeof import("@/features/game-ruling");
});

const { FileTreeRootGate } = await import("../gates/FileTreeRootGate");
const { SearchRootGate } = await import("../gates/SearchRootGate");
const { BookPositionGate } = await import("../gates/BookPositionGate");
const { GamePersistenceGate } = await import("../gates/GamePersistenceGate");
const { GameMoveGate } = await import("../gates/GameMoveGate");
const { EngineRuntimeGate } = await import("../gates/EngineRuntimeGate");
const { AnalysisPositionSyncGate } = await import("../gates/AnalysisPositionSyncGate");
const { GameSessionRulingGate } = await import("../gates/GameSessionRulingGate");

const child = <span data-testid="child" />;

beforeEach(() => {
  for (const key of Object.keys(seen)) delete seen[key];
  for (const key of Object.keys(placedIn)) delete placedIn[key];
  config = null;
  tree = { activeKifuPath: null, kifuFormat: null };
  presets = { runtimeConfig: null, selectedPreset: null };
  saveKifuToFile.mockReset();
});
afterEach(cleanup);

describe("ワークスペースの根を渡す器", () => {
  test.each([
    ["FileTreeRootGate", FileTreeRootGate, "FileTreeProvider"],
    ["SearchRootGate", SearchRootGate, "PositionSearchProvider"],
  ] as const)("%s は設定の根を渡し、子を描く", (_, Gate, provider) => {
    config = { root_dir: "/ws" };
    render(<Gate>{child}</Gate>);

    expect(seen[provider]).toEqual({ rootDir: "/ws" });
    expect(screen.getByTestId(provider).contains(screen.getByTestId("child"))).toBe(true);
  });

  test.each([
    ["FileTreeRootGate", FileTreeRootGate, "FileTreeProvider"],
    ["SearchRootGate", SearchRootGate, "PositionSearchProvider"],
  ] as const)("%s は設定が読めていなければ null を渡す", (_, Gate, provider) => {
    render(<Gate>{child}</Gate>);

    expect(seen[provider]).toEqual({ rootDir: null });
  });

  test("根の欄が空なら null を渡す", () => {
    config = { root_dir: null };
    render(<FileTreeRootGate>{child}</FileTreeRootGate>);

    expect(seen.FileTreeProvider).toEqual({ rootDir: null });
  });
});

describe("盤の局面を定跡へ渡す器", () => {
  test("いまの局面を渡し、子を描く", () => {
    currentSfen = "9/9/9/9/9/9/9/9/9 b - 1";
    render(<BookPositionGate>{child}</BookPositionGate>);

    expect(seen.BookProvider).toEqual({ currentSfen: "9/9/9/9/9/9/9/9/9 b - 1" });
    expect(screen.getByTestId("BookProvider").contains(screen.getByTestId("child"))).toBe(true);
  });
});

describe("盤の保存先を渡す器", () => {
  test("開いている棋譜が無ければ保存先を渡さない", () => {
    tree = { activeKifuPath: null, kifuFormat: "kif" };
    render(<GamePersistenceGate>{child}</GamePersistenceGate>);

    expect(seen.GameProvider.persistence).toBeUndefined();
  });

  test("形式が分からなければ保存先を渡さない", () => {
    tree = { activeKifuPath: "/ws/a.kif", kifuFormat: null };
    render(<GamePersistenceGate>{child}</GamePersistenceGate>);

    expect(seen.GameProvider.persistence).toBeUndefined();
  });

  test("開いている棋譜のパスと形式で書く", () => {
    tree = { activeKifuPath: "/ws/a.kif", kifuFormat: "kif" };
    render(<GamePersistenceGate>{child}</GamePersistenceGate>);

    const persistence = seen.GameProvider.persistence as {
      absPath: string;
      save: (jkf: JKFData) => unknown;
    };
    expect(persistence.absPath).toBe("/ws/a.kif");

    const jkf = { header: {}, moves: [{}] } as JKFData;
    persistence.save(jkf);
    expect(saveKifuToFile).toHaveBeenCalledWith(jkf, "/ws/a.kif", "kif");
  });

  test("パスと形式が変わらなければ、同じ保存先を渡し続ける", () => {
    tree = { activeKifuPath: "/ws/a.kif", kifuFormat: "kif" };
    const view = render(<GamePersistenceGate>{child}</GamePersistenceGate>);
    const first = seen.GameProvider.persistence;

    view.rerender(<GamePersistenceGate>{child}</GamePersistenceGate>);

    expect(seen.GameProvider.persistence).toBe(first);
  });

  test("着手の門は受け取ったものをそのまま渡す", () => {
    render(<GamePersistenceGate moveGate={moveGate as never}>{child}</GamePersistenceGate>);

    expect(seen.GameProvider.moveGate).toBe(moveGate);
  });

  test("盤とツリーを繋ぐ橋を、盤の内側に載せる", () => {
    render(<GamePersistenceGate>{child}</GamePersistenceGate>);

    expect(placedIn.GameFileTreeBridge).toBe("GameProvider");
    expect(screen.getByTestId("GameProvider").contains(screen.getByTestId("child"))).toBe(true);
  });
});

describe("対局の着手を盤へ渡す器", () => {
  test("対局から組んだ門を盤へ渡し、エンジンの手を積む橋を盤の内側に載せる", () => {
    render(<GameMoveGate>{child}</GameMoveGate>);

    expect(seen.GameProvider.moveGate).toBe(moveGate);
    expect(placedIn.GameMoveBridge).toBe("GameProvider");
    expect(screen.getByTestId("GameProvider").contains(screen.getByTestId("child"))).toBe(true);
  });
});

describe("プリセットをエンジンへ渡す器", () => {
  test("何も選んでいなければ、起動するものも未設定も無い", () => {
    render(<EngineRuntimeGate>{child}</EngineRuntimeGate>);

    expect(seen.EngineProvider).toEqual({ desiredRuntime: null, presetIncomplete: false });
  });

  test("選んだプリセットが起動の形に組めていれば、それを渡す", () => {
    const runtimeConfig = { enginePath: "/e" };
    presets = { runtimeConfig, selectedPreset: { id: "p" } };
    render(<EngineRuntimeGate>{child}</EngineRuntimeGate>);

    expect(seen.EngineProvider).toEqual({ desiredRuntime: runtimeConfig, presetIncomplete: false });
  });

  test("選んだプリセットが組めていなければ、未設定と伝える", () => {
    presets = { runtimeConfig: null, selectedPreset: { id: "p" } };
    render(<EngineRuntimeGate>{child}</EngineRuntimeGate>);

    expect(seen.EngineProvider).toEqual({ desiredRuntime: null, presetIncomplete: true });
  });

  test("起動の形が undefined でも null に揃えて渡す", () => {
    presets = { runtimeConfig: undefined, selectedPreset: null };
    render(<EngineRuntimeGate>{child}</EngineRuntimeGate>);

    expect(seen.EngineProvider).toEqual({ desiredRuntime: null, presetIncomplete: false });
    expect(screen.getByTestId("EngineProvider").contains(screen.getByTestId("child"))).toBe(true);
  });
});

describe("下の provider へ部品を注入する器", () => {
  test("局面の同期を検討へ渡す", () => {
    render(<AnalysisPositionSyncGate>{child}</AnalysisPositionSyncGate>);

    expect(seen.AnalysisProvider).toEqual({ positionSync });
    expect(screen.getByTestId("AnalysisProvider").contains(screen.getByTestId("child"))).toBe(true);
  });

  test("終局の裁定を対局へ渡す", () => {
    render(<GameSessionRulingGate>{child}</GameSessionRulingGate>);

    expect(seen.GameSessionProvider).toEqual({ ruling });
    expect(screen.getByTestId("GameSessionProvider").contains(screen.getByTestId("child"))).toBe(
      true,
    );
  });
});
