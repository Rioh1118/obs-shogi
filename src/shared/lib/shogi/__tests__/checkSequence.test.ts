import { describe, expect, test } from "vitest";
import { everyAttackGivesCheck } from "../checkSequence";

/** 後手玉 1一、先手の金 2三・歩 1三、持駒に金 */
const ONE_MOVE = "8k/9/7GP/9/9/9/9/9/K8 b G 1";

describe("everyAttackGivesCheck", () => {
  test("攻め方の手が全部王手なら真", () => {
    expect(everyAttackGivesCheck(ONE_MOVE, ["1c1b+"])).toBe(true);
    expect(everyAttackGivesCheck(ONE_MOVE, ["G*1b"])).toBe(true);
  });

  test("王手でない攻め方の手があれば偽", () => {
    expect(everyAttackGivesCheck(ONE_MOVE, ["9i8i"])).toBe(false);
  });

  test("3手の手順。受け方の手は王手でなくてよく、3手目が王手でなければ偽", () => {
    const three = "7k1/9/7P1/9/9/9/9/9/K8 b RG 1";
    expect(everyAttackGivesCheck(three, ["R*2b", "2a1a", "2b1b+"])).toBe(true);
    expect(everyAttackGivesCheck(three, ["R*2b", "2a1a", "9i8i"])).toBe(false);
  });

  test("後手番の手順でも、手番の側の王手を見る", () => {
    const gote = "k8/9/9/9/9/9/8p/9/8K w g 1";
    expect(everyAttackGivesCheck(gote, ["G*1h"])).toBe(true);
    expect(everyAttackGivesCheck(gote, ["9a8a"])).toBe(false);
  });

  test("指せない手、空の手順、読めない局面は偽", () => {
    expect(everyAttackGivesCheck(ONE_MOVE, ["5i5h"])).toBe(false);
    expect(everyAttackGivesCheck(ONE_MOVE, [])).toBe(false);
    expect(everyAttackGivesCheck("broken", ["1c1b+"])).toBe(false);
  });
});
