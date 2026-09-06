import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

import Modal from "@/shared/ui/Modal";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import type { VisibleTier } from "@/shared/lib/notification/types";
import {
  usePositionHitNavigation,
  type NavigationOutcome,
} from "@/features/position-search/lib/usePositionHitNavigation";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";

import "./PositionSearchModal.scss";

import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PreviewPane from "@/entities/position/ui/PositionPreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";
import { hitKey } from "@/features/position-search/lib/hitKey";
import { useOrderedPositionHits } from "@/features/position-search/lib/useOrderedPositionHits";
import { useGame } from "@/entities/game";
import { isIndexBusy, usePositionSearch, type PositionHit } from "@/entities/search";
import PositionSearchContinuation from "./PositionSearchContinuation";

/**
 * ヒットを開けなかった理由。**どちらもこの画面からは直せない**（ADR-0004 決定1 の
 * `danger`＝別の操作が要る）。索引の欠けもツリーとのずれも、次に索引が更新される
 * までは同じ結果が返る——Rust は1回の検索のあいだ同じスナップショットを使い、
 * `mergeFiles` は同じ値なら書き換えない。**「検索し直せば直る」は成り立たない。**
 *
 * **`describeFsError` / `fsErrorTier` を通さない。** あちらは fs を叩いた結果の
 * `FsError` を訳す口だが、この断りは fs を1回も叩いていない——見ているのは
 * 索引とツリーの食い違いだけで、`not_found` の `warning`（ツリーから開いたときは
 * 読み直せば直る）とは復帰の仕方が違う。段はこの画面から直せるかで決める。
 */
type RefusalReason = "no-path" | Exclude<NavigationOutcome, "started">;

const REFUSALS: Record<RefusalReason, { tier: VisibleTier; title: string; body: string }> = {
  "no-path": {
    tier: "danger",
    title: "この棋譜の場所が分かりません",
    body: "検索の索引が、この結果の置き場を返していません。索引が更新されるまで、この結果からは開けません。",
  },
  "tree-unavailable": {
    tier: "warning",
    title: "ワークスペースの一覧をまだ読み込めていません",
    body: "一覧を読み込めたあと、もう一度お試しください。",
  },
  "not-in-tree": {
    tier: "danger",
    title: "この棋譜を開けません",
    body: "ワークスペースの一覧にこの棋譜がありません。移動・削除されたか、索引がまだ古い可能性があります。一覧から別のヒットを選んでください。",
  },
};

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { state: gameState, view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;

  const {
    state,
    searchPosition,
    cancelSearch,
    getSessionByRequestId,
    getHitsByRequestId,
    isSearchingRequest,
    resolveHitAbsPath,
    clearSearch,
  } = usePositionSearch();

  const { startNavigationToHit } = usePositionHitNavigation();

  /**
   * 利用者が選んだヒットの**実体**。添字でも鍵でもない。
   *
   * 理由は `docs/state-transitions/position-search-view.md` の
   * 「選択を追うのは参照、断りを覚えるのは鍵」。**選択について state に置くのは
   * これ1つだけ**——添字も一緒に持つと、並び替えの突き合わせが済むまでの
   * 1レンダで利用者が選んでいない行が選択として描かれる。
   */
  const [selectedHit, setSelectedHit] = useState<PositionHit | null>(null);
  const [requestId, setRequestId] = useState<number | null>(null);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);
  // 移動を断ったヒット。**鍵で覚える**（`hitKey`）。使い分けは
  // `docs/state-transitions/position-search-view.md` の「選択を追うのは参照、
  // 断りを覚えるのは鍵」
  const [refusedHit, setRefusedHit] = useState<{
    key: string;
    reason: RefusalReason;
  } | null>(null);

  const session = getSessionByRequestId(requestId);
  const hits = getHitsByRequestId(requestId);

  const isSearching = isLaunching || isSearchingRequest(requestId);
  const isDone = !!session?.isDone && !isSearching;
  const error = launchError ?? session?.error ?? null;

  const indexStale = isIndexBusy(state.index.state);

  const resultStale = indexStale || !!session?.stale;

  const statusText = useMemo(() => {
    if (isSearching) return "検索中…";
    if (error) return "エラー";
    if (isDone) return "完了";
    return "待機中";
  }, [isSearching, error, isDone]);

  const previewData = useMemo(() => {
    if (!isOpen) return null;

    // params.sfen がある場合は SFEN から直接構築
    if (params.sfen) {
      return buildPreviewDataFromSfen(params.sfen);
    }

    // 通常: 現在の棋譜の局面から構築
    const player = gameView.player;
    if (!player) return null;
    const nodeId = player.getTesuuPointer(player.tesuu);
    return buildPreviewData(player, nodeId);
  }, [isOpen, params.sfen, gameView.player]);

  const orderedHits = useOrderedPositionHits(
    hits,
    resolveHitAbsPath,
    gameState.loadedAbsPath ?? null,
  );

  // -------------------------
  // 検索トリガ：queryKey（検索対象SFEN）が変わったら再検索
  // params.sfen があればそのSFENで検索、なければ現在局面で検索
  // -------------------------
  const queryKey = params.sfen ?? currentSfen ?? null;
  const lastQueryKeyRef = useRef<string | null>(null);

  // 進行中の rid を ref で追跡し、 queryKey が変わったタイミングや unmount で
  // cancelSearch を投げる。 setRequestId とは別経路にして、 invoke の
  // 解決前に乱発される再検索でも確実に直前の rid をキャンセルできるようにする。
  const inFlightRidRef = useRef<number | null>(null);

  /**
   * 起動の世代。**`search_position` の invoke が解決するまで rid は分からない**ので、
   * 「もう要らない」を rid でなくこれで表す。解決した側が自分の番かを確かめる。
   */
  const launchSeqRef = useRef(0);

  /**
   * 進行中なら取り下げ、結果も捨てる。
   *
   * **取り下げるだけでは足りない。** 届いたヒットの実体はセッションに残り、
   * 開き直すたびに1検索ぶん積み上がる（10万件なら 17.6MB）。捨てる口を呼ぶのは
   * ここだけなので、呼ばないと**誰も呼ばない**。
   *
   * **rid が分かる前に呼ばれる**（開いた直後に Esc）。そのときは世代を進めるだけで、
   * 実際の取り下げは invoke が解決した側が引き受ける
   */
  const discardSearch = useCallback(() => {
    launchSeqRef.current += 1;

    const rid = inFlightRidRef.current;
    if (rid == null) return;

    inFlightRidRef.current = null;
    void cancelSearch(rid);
    clearSearch(rid);
  }, [cancelSearch, clearSearch]);

  useEffect(() => {
    if (!isOpen) {
      discardSearch();
      lastQueryKeyRef.current = null;
      setRequestId(null);
      setLaunchError(null);
      setIsLaunching(false);
      setSelectedHit(null);
      setRefusedHit(null);
      return;
    }

    if (!queryKey) return;
    if (lastQueryKeyRef.current === queryKey) return;

    // queryKey が変わった: 前の rid があれば取り下げて捨てる
    discardSearch();

    lastQueryKeyRef.current = queryKey;
    setRequestId(null);
    setLaunchError(null);
    setIsLaunching(true);
    setSelectedHit(null);
    setRefusedHit(null);

    const myLaunch = launchSeqRef.current;

    searchPosition({ sfen: queryKey, consistency: "BestEffort", chunkSize: 300 })
      .then((out) => {
        // **自分の番でなければ、ここで取り下げる。** 待っているあいだに閉じた・
        // 撃ち直された場合、`discardSearch` は rid を知らないので何もできていない。
        // 素通りさせると Rust の検索は最後まで走り、閉じた画面が到着のたびに
        // 一覧を組み直し続ける
        if (launchSeqRef.current !== myLaunch) {
          void cancelSearch(out.requestId);
          clearSearch(out.requestId);
          return;
        }

        inFlightRidRef.current = out.requestId;
        setRequestId(out.requestId);
      })
      .catch((e) => {
        // eslint-disable-next-line no-console
        console.error("[PositionSearchModal] search failed:", e);
        setLaunchError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        setIsLaunching(false);
      });
  }, [isOpen, queryKey, searchPosition, cancelSearch, clearSearch, discardSearch]);

  // unmount 時にも進行中検索を取り下げる
  useEffect(() => {
    return () => discardSearch();
  }, [discardSearch]);

  /**
   * 選んだ行の添字。**導出する**（上の doc）。見失ったとき——新しい検索、
   * 届いた実体が入れ替わった——は先頭に落ちる。
   */
  const activeIndex = useMemo(() => {
    if (!selectedHit) return 0;
    const i = orderedHits.indexOf(selectedHit);
    return i >= 0 ? i : 0;
  }, [orderedHits, selectedHit]);

  const activeHit = orderedHits[activeIndex];

  /**
   * 直前に選択が動いた向き。**先読みの当てにだけ使う**（`PositionSearchContinuation`）。
   * 一覧を降りている人は次も下へ行く、という以上の意味は無いので、外れても
   * 1本ぶんの読みが無駄になるだけ。既定は下向き
   */
  const moveDirRef = useRef<1 | -1>(1);

  const selectIndex = useCallback(
    (next: number) => {
      if (next !== activeIndex) moveDirRef.current = next > activeIndex ? 1 : -1;
      setSelectedHit(orderedHits[next] ?? null);
    },
    [orderedHits, activeIndex],
  );

  // 行に渡すものは `rowProps` の `useMemo` に載り、そこから `PositionHitItem` の
  // `memo` に届く。毎レンダ新しい関数を渡すとどちらも外れる。
  // **`startNavigationToHit` 自身がツリーの選択で変わる**ので、これだけでは
  // 完全には安定しない
  const accept = useCallback(
    (hit: PositionHit) => {
      // 索引に在る棋譜がツリーに無いのは正常運転で起こる（`usePositionHitNavigation`）。
      // 移動できないまま閉じると、盤は前の棋譜のままなのに「開いた」と読める。
      //
      // **2つの断りを1つの文言に畳まない。** 行き先のパスを引けないのは索引の側の
      // 欠けで、ツリーを見てもいない。同じ文で「ワークスペースを探した」と言うと、
      // 動かしていない棋譜を探しに行かせる

      // 押した行は利用者が選んだ行。断りがこの行に付く以上、選択も合わせる
      setSelectedHit(hit);

      const absPath = resolveHitAbsPath(hit);
      if (!absPath) {
        setRefusedHit({ key: hitKey(hit), reason: "no-path" });
        return;
      }
      const outcome = startNavigationToHit(absPath, hit.cursor);
      if (outcome !== "started") {
        setRefusedHit({ key: hitKey(hit), reason: outcome });
        return;
      }
      // 確定操作なので returnTo は適用しない（キャンセル時のみマネージャーに戻る）
      closeModal({ skipReturn: true });
    },
    [closeModal, resolveHitAbsPath, startNavigationToHit],
  );

  // 焦点は選択している行が持つ（`PositionHitItem`）ので、キーはそこから
  // ここまで上がってくる。この節自体は焦点を取らない。
  // Escape は `Modal` が扱う。ここで拾うと受け口が2つになる
  const onKeyDown = (e: React.KeyboardEvent) => {
    // 検索中でも開ける。結果はチャンクで届くので `isSearching` は一覧が育っている間
    // ずっと真であり、ここで弾くと事実上「全件届くまで何も押せない」になる。
    // 届いたヒットは行き先を決めるのに足りる情報を持っている。
    if (e.key === "Enter") {
      e.preventDefault();
      if (activeHit) accept(activeHit);
      return;
    }

    if (e.key === "ArrowDown" || e.key === "j") {
      e.preventDefault();
      selectIndex(Math.min(activeIndex + 1, Math.max(0, orderedHits.length - 1)));
      return;
    }

    if (e.key === "ArrowUp" || e.key === "k") {
      e.preventDefault();
      selectIndex(Math.max(activeIndex - 1, 0));
      return;
    }
  };

  if (!isOpen) return null;

  const destAbsPath = activeHit ? resolveHitAbsPath(activeHit) : null;

  // 次に選ばれそうな行の棋譜。当たれば矢印1回ぶんの待ちが消える（先読み）。
  // 外れても捨てるのは1本ぶんの読み
  const prefetchHit = orderedHits[activeIndex + moveDirRef.current];
  const prefetchAbsPath = prefetchHit ? resolveHitAbsPath(prefetchHit) : null;
  // 断りが指しているのは選んでいる行なので、選び直したら引っ込める。
  // 残したままだと、いま選んでいる棋譜が開けないという意味に読める
  const refusal =
    activeHit && refusedHit?.key === hitKey(activeHit) ? REFUSALS[refusedHit.reason] : null;

  return (
    <Modal
      onClose={closeModal}
      label="局面検索"
      theme="dark"
      variant="workspace"
      size="xl"
      chrome="card"
      scroll="none"
      closeOnEsc
      closeOnOverlay
      showCloseButton={false}
    >
      <section className="pos-search" onKeyDown={onKeyDown} aria-label="局面検索">
        <PositionSearchModalHeader isSearching={isSearching} title="局面検索" />

        <main className="pos-search__main" aria-label="検索とプレビュー">
          <div className="pos-search__grid">
            <section className="pos-search__left" aria-label="検索状態">
              <PositionSearchStatusBar
                hitsCount={hits.length}
                statusText={statusText}
                stale={resultStale}
                error={error}
              />

              {refusal && (
                <InlineNotice tier={refusal.tier} title={refusal.title} body={refusal.body} />
              )}

              <PositionSearchHitList
                hits={orderedHits}
                activeIndex={activeIndex}
                onActiveIndexChange={selectIndex}
                onAccept={accept}
                isSearching={isSearching}
                error={error}
                resolveAbsPath={resolveHitAbsPath}
                hasQuery={queryKey != null}
                stale={resultStale}
              />
            </section>

            <aside className="pos-search__right" aria-label="局面プレビュー">
              <div className="pos-search__paneTitle">
                {params.sfen ? "検索対象の局面" : "現在の局面"}
              </div>
              <div className="pos-search__preview">
                <PreviewPane previewData={previewData} />
              </div>

              <div className="pos-search__aux">
                <PositionSearchContinuation
                  activeHit={activeHit ?? null}
                  prefetchAbsPath={prefetchAbsPath}
                  resolveAbsPath={resolveHitAbsPath}
                  ply={5}
                />

                <PositionSearchDestinationCard
                  currentAbsPath={gameState.loadedAbsPath ?? null}
                  destAbsPath={destAbsPath}
                />
              </div>
            </aside>
          </div>
        </main>
      </section>
    </Modal>
  );
}
