import { useState } from "react";
import Button from "@/shared/ui/Button/Button";
import { SField, SInput, SRadioGroup, SSection, SSelect } from "@/features/settings/ui/kit";
import { cx, HASH_CHOICES, parseIntSafe } from "@/features/settings/lib/presetDialog";
import {
  engineDefaultLabel,
  engineDefaultOf,
  savedInt,
} from "@/features/settings/lib/quickOptions";

import { MULTIPV_MIN, QUICK_MULTIPV } from "@/entities/engine-presets/model/multiPv";

import "./ImportantOptionsSection.scss";
import type { EnginePreset } from "@/entities/engine-presets/model/types";

/** 「エンジン既定」から「指定する」に切り替えたときに入れる最初の値（エンジンの既定値ではない） */
const FIRST_HASH = 1024;

/** この節が欄を持つ名前。他の名前の保存済みの値は「その他の値」に並べる */
const QUICK_NAMES = new Set(["MultiPV", "Threads", "USI_Hash"]);

const ENGINE_DEFAULT_DESCRIPTION = "エンジンの初期値のまま使います";

/**
 * よく触る3つ（MultiPV / Threads / USI_Hash）。**値は下書きの `options` だけに持つ**——
 * 値が無いことが「エンジン既定」（送らない。エンジンが自分の既定で動く）。
 *
 * 他のオプションの値は触らない（ここに欄が無くても、保存した値は残る）
 */
export default function ImportantOptionsSection(props: {
  draft: EnginePreset;
  /** `null` で値を消す（エンジン既定に戻す） */
  setOpt: (name: string, value: string | null) => void;
  cores: number;
  recommendedThreads: number;
  threadChoices: number[];
  /** MultiPV の上限（`multiPvMax`） */
  multiPvMax: number;
}) {
  const { draft, setOpt, cores, recommendedThreads, threadChoices, multiPvMax } = props;

  const multiPv = savedInt(draft.options, "MultiPV");
  const threads = savedInt(draft.options, "Threads");
  const hash = savedInt(draft.options, "USI_Hash");
  const multiPvDefault = engineDefaultOf(draft, "MultiPV");
  const others = Object.entries(draft.options).filter(([name]) => !QUICK_NAMES.has(name));

  const quickMultiPv = QUICK_MULTIPV.filter((n) => n <= multiPvMax);
  // 利用者が開いたか、値がどのボタンにも無いときに開く。**値から導く**——取得で丸められて
  // ボタンに無い値になったとき、閉じたままだと値が画面のどこにも出ない
  const [customOpened, setCustomOpened] = useState(false);
  const offQuick = multiPv != null && !(quickMultiPv as number[]).includes(multiPv);
  const showMultiPvCustom = customOpened || offQuick;
  const setMultiPv = (n: number) =>
    setOpt("MultiPV", String(Math.max(MULTIPV_MIN, Math.min(n, multiPvMax))));

  return (
    <SSection
      title="重要オプション"
      description="何も選ばない項目は送らず、エンジンが自分の既定で動きます（エンジン既定）。"
    >
      <div className="presetDialog__stack">
        {/* MultiPV */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">MultiPV（候補手数）</div>
            <div className="presetDialog__blockSub">
              候補を増やすと、1手あたりの読みは浅くなります。
            </div>
          </div>

          <div className="presetDialog__segRow">
            <div className="presetDialog__seg" role="tablist" aria-label="MultiPV presets">
              <button
                type="button"
                className={cx("presetDialog__segBtn", multiPv == null && "is-active")}
                onClick={() => setOpt("MultiPV", null)}
              >
                {engineDefaultLabel(multiPvDefault)}
              </button>
              {quickMultiPv.map((n) => (
                <button
                  key={n}
                  type="button"
                  className={cx("presetDialog__segBtn", multiPv === n && "is-active")}
                  onClick={() => setMultiPv(n)}
                >
                  {n}
                </button>
              ))}
            </div>

            <Button
              size="sm"
              onClick={() => setCustomOpened(!showMultiPvCustom)}
              className="presetDialog__segRight"
            >
              カスタム…
            </Button>
          </div>

          {showMultiPvCustom && (
            <div className="presetDialog__stepper">
              {/* 数を合わせるまで連続で押す場所。押すたびに浮き沈みすると目が疲れる */}
              <Button
                size="sm"
                motion={false}
                onClick={() => setMultiPv((multiPv ?? MULTIPV_MIN) - 1)}
                disabled={(multiPv ?? MULTIPV_MIN) <= MULTIPV_MIN}
              >
                −
              </Button>

              <SInput
                className="presetDialog__stepperInput"
                inputMode="numeric"
                type="number"
                min={MULTIPV_MIN}
                max={multiPvMax}
                value={multiPv ?? ""}
                placeholder="既定"
                // 空にしたらエンジン既定（1 を入れない）
                onChange={(e) =>
                  e.target.value.trim() === ""
                    ? setOpt("MultiPV", null)
                    : setMultiPv(parseIntSafe(e.target.value, MULTIPV_MIN))
                }
              />

              <Button
                size="sm"
                motion={false}
                onClick={() => setMultiPv((multiPv ?? 0) + 1)}
                disabled={(multiPv ?? 0) >= multiPvMax}
              >
                ＋
              </Button>

              <div className="presetDialog__stepperHint">
                範囲: {MULTIPV_MIN}〜{multiPvMax}
              </div>
            </div>
          )}

          {multiPv == null && multiPvDefault === "1" && (
            <div className="presetDialog__hintMuted">
              このエンジンの既定は 1 です。解析の候補は1本だけになります。
            </div>
          )}

          {multiPv != null && multiPv >= 2 && (
            <div className="presetDialog__hintWarn">
              注意: MultiPV を 2以上にすると棋力が低下し得ます（研究用途では “幅 vs 深さ”
              の調整として有用）。
            </div>
          )}
        </div>

        {/* Threads */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">Threads（並列数）</div>
            <div className="presetDialog__blockSub">
              上げすぎると熱/騒音や効率低下の可能性があります。
            </div>
          </div>

          <SRadioGroup
            name="threadsMode"
            options={[
              {
                value: "engine",
                label: engineDefaultLabel(engineDefaultOf(draft, "Threads")),
                description: ENGINE_DEFAULT_DESCRIPTION,
              },
              {
                value: "set",
                label: "指定する",
                description: `この端末の論理コア数は ${cores}（推奨 ${recommendedThreads}）`,
              },
            ]}
            value={threads == null ? "engine" : "set"}
            onChange={(v) => setOpt("Threads", v === "engine" ? null : String(recommendedThreads))}
            layout="list"
          />

          {threads != null && (
            <div className="presetDialog__inline">
              <SField label="Threads" description={`最大: 論理コア数 ${cores}`}>
                <SSelect
                  value={String(threads)}
                  onChange={(e) => setOpt("Threads", e.target.value)}
                  options={[
                    // 他の端末で保存した値（この端末のコア数を超える）も選択として残す
                    ...(threadChoices.includes(threads) ? [] : [threads]),
                    ...threadChoices,
                  ].map((n) => ({
                    value: String(n),
                    label: n === recommendedThreads ? `${n}（推奨）` : String(n),
                  }))}
                />
              </SField>
            </div>
          )}
        </div>

        {/* Hash */}
        <div className="presetDialog__block">
          <div className="presetDialog__blockHead">
            <div className="presetDialog__blockTitle">解析メモリ（USI_Hash）</div>
            <div className="presetDialog__blockSub">
              置換表サイズ（MB）。長時間思考で効くことがあります。
            </div>
          </div>

          <SRadioGroup
            name="hashMode"
            options={[
              {
                value: "engine",
                label: engineDefaultLabel(engineDefaultOf(draft, "USI_Hash"), "MB"),
                description: ENGINE_DEFAULT_DESCRIPTION,
              },
              { value: "set", label: "指定する" },
            ]}
            value={hash == null ? "engine" : "set"}
            onChange={(v) => setOpt("USI_Hash", v === "engine" ? null : String(FIRST_HASH))}
            layout="list"
          />

          {hash != null && (
            <div className="presetDialog__inline">
              <SField
                label="Hash"
                description={
                  <span>
                    推定使用RAM: <b>{hash}MB</b>（＋α）
                  </span>
                }
              >
                <SSelect
                  value={String(hash)}
                  onChange={(e) => setOpt("USI_Hash", e.target.value)}
                  options={[
                    ...((HASH_CHOICES as readonly number[]).includes(hash) ? [] : [hash]),
                    ...HASH_CHOICES,
                  ].map((n) => ({ value: String(n), label: `${n} MB` }))}
                />
              </SField>
            </div>
          )}
        </div>

        {/* 欄の無い保存済みの値。見えないまま送り続けないように、ここで消せる */}
        {others.length > 0 && (
          <div className="presetDialog__block">
            <div className="presetDialog__blockHead">
              <div className="presetDialog__blockTitle">その他の保存済みの値</div>
              <div className="presetDialog__blockSub">
                エンジンが申告していれば起動のたびに送ります。要らない値は外してください。
              </div>
            </div>
            <ul className="presetDialog__stack" style={{ margin: 0, paddingLeft: 0 }}>
              {others.map(([name, value]) => (
                <li key={name} style={{ listStyle: "none" }}>
                  <code>
                    {name} = {value}
                  </code>{" "}
                  <Button
                    size="sm"
                    onClick={() => setOpt(name, null)}
                    aria-label={`${name} を外す`}
                  >
                    外す
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </SSection>
  );
}
