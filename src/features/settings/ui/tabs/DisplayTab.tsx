import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import "./DisplayTab.scss";

import IconButton from "@/shared/ui/IconButton";
import DisplayModePreview from "./DisplayModePreview";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import SSection from "../kit/SSection";
import SField from "../kit/SField";
import SRadioGroup from "../kit/SRadioGroup";
import SSelect from "../kit/SSelect";
import { useAppConfig, type DisplayConfigPatch } from "@/entities/app-config";
import {
  DOCK_VIEWS,
  dockViewLabel,
  moveDockTab,
  knownDockViews,
  resolveDockTabs,
  resolveStartupTab,
  toggleDockTab,
  type DockViewMeta,
} from "@/entities/dock";
import type { DockViewType } from "@/shared/lib/router/useURLParams";
import { ANALYSIS_DISPLAY_MODES, resolveAnalysisDisplayMode } from "@/entities/analysis";

/** 「起動時に開くタブ」の「前回のもの」の値。ビューの綴りとは別の語彙 */
const STARTUP_LAST = "last";

/**
 * 設定「表示」タブ。ドックのタブの構成と、検討ビューの見せ方を決める。
 *
 * その場で変わるものはその場に、恒久的な構成は設定に置く（ADR-0010 決定4）。
 */
export default function DisplayTab() {
  const { config, setDisplayConfig } = useAppConfig();
  const [error, setError] = useState<string | null>(null);

  const tabs = useMemo(
    () => resolveDockTabs(config?.dock_tabs, config?.dock_tabs_known),
    [config?.dock_tabs, config?.dock_tabs_known],
  );
  const hidden = useMemo<DockViewMeta[]>(
    () => DOCK_VIEWS.filter((view) => !tabs.includes(view.key)),
    [tabs],
  );

  // 起動時に読む側と同じ関数を通す。通さないと、一覧に無い綴りが設定に残っているときに、
  // 選択肢に無い値を表示したまま起動時の行き先だけが別になる
  const startupTab = resolveStartupTab(tabs, config?.dock_startup_tab);
  const showEvaluationBar = config?.show_evaluation_bar === true;
  const displayMode = resolveAnalysisDisplayMode(config?.analysis_display_mode);

  const save = async (patch: DisplayConfigPatch) => {
    const result = await setDisplayConfig(patch);
    setError(result.success ? null : result.error);
  };

  /**
   * 一覧を書き換える。外れたタブが起動時に開くタブに残らないよう、同じ書き込みで直す。
   *
   * 別々に書くと、後の書き込みだけが落ちたときに「決めておく」の指す先が一覧の外に残る。
   */
  const saveTabs = (nextTabs: DockViewType[]) =>
    save({
      dock_tabs: nextTabs,
      // 選ぶ機会があった顔ぶれを残す。残さないと、後から名簿に足したビューとここで外した
      // ビューを見分けられない
      dock_tabs_known: knownDockViews(),
      dock_startup_tab: resolveStartupTab(nextTabs, config?.dock_startup_tab),
    });

  return (
    <div className="displayTab">
      {/* タブの構成は設定から導くので、保存が落ちると押したチェックが戻るだけになる。
          見せ方は通知基盤を通らない経路の共通部品に寄せる（ADR-0004 決定4） */}
      {error && (
        <InlineNotice
          tier="warning"
          title="表示の設定を保存できませんでした"
          body={`${error} もう一度押してください。`}
        />
      )}

      <SSection title="ドックのタブ" description="盤の下のドックに出す面と、その並び順">
        <ul className="displayTab__tabs">
          {tabs.map((key, at) => {
            const removable = DOCK_VIEWS.find((view) => view.key === key)?.removable !== false;
            return (
              <li key={key} className="displayTab__row">
                <label className="displayTab__check">
                  <input
                    type="checkbox"
                    checked
                    // 全部外せると、空のドックに出す案内が要る（ADR-0010 決定1）
                    disabled={!removable}
                    onChange={() => saveTabs(toggleDockTab(tabs, key))}
                  />
                  <span>{dockViewLabel(key)}</span>
                  {!removable && <span className="displayTab__note">外せません</span>}
                </label>

                <span className="displayTab__order">
                  <IconButton
                    size="small"
                    variant="obs-ghost"
                    title="上へ"
                    ariaLabel={`${dockViewLabel(key)}を上へ`}
                    disabled={at === 0}
                    onClick={() => saveTabs(moveDockTab(tabs, key, -1))}
                  >
                    <ChevronUp size={16} />
                  </IconButton>
                  <IconButton
                    size="small"
                    variant="obs-ghost"
                    title="下へ"
                    ariaLabel={`${dockViewLabel(key)}を下へ`}
                    disabled={at === tabs.length - 1}
                    onClick={() => saveTabs(moveDockTab(tabs, key, 1))}
                  >
                    <ChevronDown size={16} />
                  </IconButton>
                </span>
              </li>
            );
          })}

          {/* 並べ替えは出してから。一覧に無いものの順番は、決めた結果を確かめる場所が無い */}
          {hidden.map((meta) => (
            <li key={meta.key} className="displayTab__row displayTab__row--hidden">
              <label className="displayTab__check">
                <input
                  type="checkbox"
                  checked={false}
                  onChange={() => saveTabs(toggleDockTab(tabs, meta.key))}
                />
                <span>{meta.label}</span>
              </label>
            </li>
          ))}
        </ul>
      </SSection>

      <SSection title="起動時に開くタブ">
        <SRadioGroup
          name="dock-startup"
          value={startupTab === null ? STARTUP_LAST : "fixed"}
          onChange={(value) => save({ dock_startup_tab: value === STARTUP_LAST ? null : tabs[0] })}
          options={[
            { value: STARTUP_LAST, label: "前回のもの", description: "最後に見ていたタブを開く" },
            { value: "fixed", label: "決めておく", description: "いつも同じタブを開く" },
          ]}
        />

        {startupTab !== null && (
          <SField label="開くタブ">
            <SSelect
              value={startupTab}
              onChange={(e) => save({ dock_startup_tab: e.target.value })}
              options={tabs.map((key) => ({ value: key, label: dockViewLabel(key) }))}
            />
          </SField>
        )}
      </SSection>

      <SSection title="検討ビュー" description="ドックの検討タブに出るもの">
        <SField label="候補手の見せ方" hint="どちらの見せ方でも最善手は1行目に出ます。">
          <SRadioGroup
            name="analysis-display-mode"
            layout="grid"
            columns={2}
            value={displayMode}
            onChange={(value) => save({ analysis_display_mode: value })}
            options={ANALYSIS_DISPLAY_MODES.map((m) => ({
              value: m.key,
              label: m.label,
              description: (
                <>
                  <DisplayModePreview mode={m.key} />
                  <span className="displayTab__modeHint">{m.hint}</span>
                </>
              ),
            }))}
          />
        </SField>

        <SField hint="目盛が ±3000 の線形で勝率と対応しないため、初期値では出しません。">
          <label className="displayTab__check">
            <input
              type="checkbox"
              checked={showEvaluationBar}
              onChange={(e) => save({ show_evaluation_bar: e.target.checked })}
            />
            <span>評価値バーを出す</span>
          </label>
        </SField>
      </SSection>
    </div>
  );
}
