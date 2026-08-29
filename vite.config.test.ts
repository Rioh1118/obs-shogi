import { describe, expect, test } from "vitest";
import config from "./vite.config";

/**
 * レイヤ規則が生きていることを設定側から検査する
 *
 * `no-restricted-imports` は override が後勝ちで**丸ごと**差し替わる。スライス単位の
 * override を後ろに足すとき、上位レイヤの group を並べ直さないとレイヤ規則が黙って消える。
 * 違反が0件のうちは lint が通るので、消えたことに気づけない。
 */

type Pattern = { group?: string[]; message?: string };
type Override = { files?: string[]; rules?: Record<string, unknown> };

const overrides = (config.lint?.overrides ?? []) as Override[];

function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*" && glob[i + 2] === "/") {
      re += "(?:.*/)?";
      i += 2;
    } else if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
    } else if (c === "*") {
      re += "[^/]*";
    } else if (c === "{") {
      const end = glob.indexOf("}", i);
      re +=
        "(?:" +
        glob
          .slice(i + 1, end)
          .split(",")
          .join("|") +
        ")";
      i = end;
    } else if (".+^$()|[]\\?".includes(c)) {
      re += "\\" + c;
    } else {
      re += c;
    }
  }
  return new RegExp("^" + re + "$");
}

function restrictedImports(o: Override) {
  const rule = o.rules?.["no-restricted-imports"];
  if (!Array.isArray(rule)) return undefined;
  return rule[1] as { patterns?: Pattern[]; paths?: { name?: string }[] } | undefined;
}

/** そのファイルに最後に効く設定。後勝ちなので末尾から探す。 */
function effectiveFor(file: string) {
  const matching = overrides.filter(
    (o) => (o.files ?? []).some((g) => globToRegExp(g).test(file)) && restrictedImports(o),
  );
  return matching.length ? restrictedImports(matching[matching.length - 1]) : undefined;
}

function groupsFor(file: string): string[] {
  return (effectiveFor(file)?.patterns ?? []).flatMap((p) => p.group ?? []);
}

const CASES = [
  { file: "src/entities/kifu/lib/readableMove.ts", forbids: "@/features/**" },
  { file: "src/entities/position/ui/HandRow.tsx", forbids: "@/widgets/**" },
  { file: "src/features/settings/ui/SettingsPanel.tsx", forbids: "@/widgets/**" },
  { file: "src/features/position-navigation/ui/BranchCard.tsx", forbids: "@/app/**" },
  { file: "src/widgets/kifu-stream/lib/buildStreamRows.ts", forbids: "@/pages/**" },
  { file: "src/shared/lib/turn.ts", forbids: "@/entities/**" },
];

describe("レイヤ規則", () => {
  test.each(CASES)("$file は $forbids を禁じている", ({ file, forbids }) => {
    expect(effectiveFor(file), `${file} に no-restricted-imports が効いていない`).toBeTruthy();
    expect(groupsFor(file)).toContain(forbids);
  });

  test("スライス配下でも2階層以上遡る相対 import を禁じている", () => {
    expect(groupsFor("src/entities/kifu/lib/readableMove.ts")).toContain("../../**");
  });

  test("スライス配下では自スライスの barrel も禁じている", () => {
    const paths = effectiveFor("src/entities/kifu/lib/readableMove.ts")?.paths ?? [];
    expect(paths.map((p) => p.name)).toEqual(["@/entities/kifu"]);
  });
});
