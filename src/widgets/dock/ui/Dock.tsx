import { useMemo } from "react";
import "./Dock.scss";
import { useURLParams, type DockViewType } from "@/shared/lib/router/useURLParams";
import { AppErrorBoundary } from "@/shared/ui/AppErrorBoundary";
import { ErrorFallbackBody } from "@/shared/ui/error-fallback/ErrorFallbackBody";
import { useAppConfig } from "@/entities/app-config";
import { dockViewLabel, resolveDockTabs, resolveDockView } from "@/entities/dock";
import type { DockViewBindings } from "@/widgets/dock/model/bindings";

/**
 * ドック。**タブの器で、中身は知らない。**
 *
 * 面を1枚足すときに触る場所は `docs/spec/screens/app-layout.md` の「ドック」の表が持つ。
 * **`AppLayout.tsx` も、このファイルも動かない。**
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
    // 同じタブを押しただけなら設定へ書きに行かない。書くと `config` が別物になり、
    // `useAppConfig` を購読している側（ツリーの根に居る門を含む）が押すたびに描き直される
    if (key === active) return;

    // タブの移動は履歴に積まない。積むと、戻るボタンが局面やモーダルの移動ではなく
    // タブの往復を巻き戻す
    updateParams({ dock: key }, { replace: true });

    // 控えを書き損ねても、いま見ている面は URL が決める。外れるのは次の起動で
    // 「前回のもの」を開いたときの行き先だけ
    void setDisplayConfig({ dock_last_tab: key }); // async-result-ignored: 出す場所が無く、失敗しても表示は動かない
  };

  return (
    <section className="dock">
      {/* タブ列は器のもの。**ビューの境界の外**に置くので、ビューが落ちても残る */}
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
            {dockViewLabel(key)}
          </button>
        ))}
      </div>

      {/*
        **操作列も境界の中に入れる。** 外に出すと、操作列が描画で落ちた回に
        ここの境界が受けず、1つ外（作業画面）まで畳まれる —— ヘッダもサイドバーも
        盤も棋譜一覧も消える。壊れたビューの操作列だけが残っても押す先が無いので、
        畳む範囲としてもこちらが正しい。
      */}
      <AppErrorBoundary
        label={binding.boundary}
        // タブ列は残るので、落ちた面から別の面へ移れる。移れば鍵が動いて畳みが解ける
        resetKeys={[active]}
        fallback={(view) => <ErrorFallbackBody {...view} hint={binding.fallbackHint} />}
      >
        <div className="dock__view">
          <div className="dock__controls">
            <Controls />
          </div>
          <div
            className="dock__body"
            role="tabpanel"
            id="dock-panel"
            aria-labelledby={`dock-tab-${active}`}
          >
            <Body />
          </div>
        </div>
      </AppErrorBoundary>
    </section>
  );
}

export default Dock;
