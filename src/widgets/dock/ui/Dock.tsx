import { useMemo } from "react";
import "./Dock.scss";
import { useURLParams, type DockViewType } from "@/shared/lib/router/useURLParams";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";
import { ErrorFallbackBody } from "@/shared/ui/error-fallback/ErrorFallbackBody";
import { useAppConfig } from "@/entities/app-config";
import { dockViewMeta, resolveDockTabs, resolveDockView } from "@/entities/dock";
import type { DockViewBindings } from "../model/bindings";

/**
 * ドック。**タブの器で、中身は知らない。**
 *
 * 面を1枚足す作業は「ビューを書いて名簿（`entities/dock`）と割り当て
 * （`model/bindings.ts`）に1行ずつ足す」で閉じる。**ここも `AppLayout` も書き換えない。**
 *
 * - どのタブを出すかは設定（`AppConfig.dock_tabs`）
 * - どのタブを見ているかは URL（`dock=`）。**リロードで戻る**
 * - 選んだタブは設定にも控える（起動時に「前回のもの」を開くため）
 *
 * 決定は ADR-0010、遷移は `docs/state-transitions/dock-tabs.md`。
 */
function Dock({ views }: { views: DockViewBindings }) {
  const { params, updateParams } = useURLParams();
  const { config, setDisplayConfig } = useAppConfig();

  const tabs = useMemo(() => resolveDockTabs(config?.dock_tabs), [config?.dock_tabs]);

  const active = resolveDockView(tabs, {
    fromUrl: params.dock,
    startupTab: config?.dock_startup_tab,
    lastTab: config?.dock_last_tab,
  });

  const binding = views[active];
  const { Body, Controls } = binding;

  const selectTab = (key: DockViewType) => {
    updateParams({ dock: key }, { replace: true });
    // 控えを書き損ねても、いま見ている面は URL が決める。外れるのは次の起動で
    // 「前回のもの」を開いたときの行き先だけ
    void setDisplayConfig({ dock_last_tab: key }); // async-result-ignored: 出す場所が無く、失敗しても表示は動かない
  };

  return (
    <section className="dock">
      <header className="dock__header">
        <div className="dock__tabs" role="tablist" aria-label="ドック">
          {tabs.map((key) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`dock-tab-${key}`}
              aria-selected={key === active}
              aria-controls="dock-panel"
              className={`dock__tab ${key === active ? "dock__tab--active" : ""}`}
              onClick={() => selectTab(key)}
            >
              {dockViewMeta(key)?.label ?? key}
            </button>
          ))}
        </div>

        {/* 操作列は選んでいるビューのもの1つだけ */}
        <div className="dock__controls">
          <Controls />
        </div>
      </header>

      <div
        className="dock__body"
        role="tabpanel"
        id="dock-panel"
        aria-labelledby={`dock-tab-${active}`}
      >
        {/*
          ビュー1枚の事故でタブ列まで畳まない。**タブ列が残るので、落ちた面から
          別の面へ移れる。** 移れば `resetKeys` が畳みを解くので、戻ったときには
          もう一度描き直される
        */}
        <AppErrorBoundary
          label={binding.boundary}
          resetKeys={[active]}
          fallback={(view) => <ErrorFallbackBody {...view} hint={binding.fallbackHint} />}
        >
          <Body />
        </AppErrorBoundary>
      </div>
    </section>
  );
}

export default Dock;
