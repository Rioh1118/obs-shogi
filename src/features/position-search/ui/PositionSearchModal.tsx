import { useCallback, useMemo, useRef, useState } from "react";
import { useURLParams } from "@/shared/lib/router/useURLParams";

import Modal from "@/shared/ui/Modal";
import InlineNotice from "@/shared/ui/notification/InlineNotice";
import { usePositionHitNavigation } from "../model/usePositionHitNavigation";
import { REFUSALS, type RefusalReason } from "../lib/hitRefusals";

import PositionSearchModalHeader from "./PositionSearchModalHeader";
import PositionSearchHitList from "./PositionSearchHitList";

import "./PositionSearchModal.scss";

import { buildPreviewData } from "@/entities/position/lib/buildPreviewData";
import { buildPreviewDataFromSfen } from "@/entities/position/lib/buildPreviewDataFromSfen";
import PositionPreviewPane from "@/entities/position/ui/PositionPreviewPane";
import PositionSearchStatusBar from "./PositionSearchStatusBar";
import PositionSearchDestinationCard from "./PositionSearchDestinationCard";
import { hitKey } from "../lib/hitKey";
import { useOrderedPositionHits } from "../model/useOrderedPositionHits";
import { useSearchSession } from "../model/useSearchSession";
import { useGame } from "@/entities/game";
import { indexHealth, usePositionSearch, type PositionHit } from "@/entities/search";
import PositionSearchContinuation from "./PositionSearchContinuation";

export default function PositionSearchModal() {
  const { params, closeModal } = useURLParams();
  const isOpen = params.modal === "position-search";

  const { state: gameState, view: gameView } = useGame();
  const currentSfen = gameView.currentSfen;

  const { state, resolveHitAbsPath } = usePositionSearch();

  const { startNavigationToHit } = usePositionHitNavigation();

  /**
   * 利用者が選んだヒットの実体。添字でも鍵でもない。
   *
   * 理由は `docs/state-transitions/position-search-view.md` の
   * 「選択を追うのは参照、断りを覚えるのは鍵」。選択について state に置くのは
   * これ1つだけにする。添字も一緒に持つと、並び替えの突き合わせが済むまでの
   * 1レンダで、利用者が選んでいない行が選択として描かれる。
   */
  const [selectedHit, setSelectedHit] = useState<PositionHit | null>(null);
  // 移動を断ったヒットは鍵（`hitKey`）で覚える。使い分けは
  // `docs/state-transitions/position-search-view.md` の「選択を追うのは参照、
  // 断りを覚えるのは鍵」
  const [refusedHit, setRefusedHit] = useState<{
    key: string;
    reason: RefusalReason;
  } | null>(null);

  const forgetSelection = useCallback(() => {
    setSelectedHit(null);
    setRefusedHit(null);
  }, []);

  // 課題局面の一覧から来たときは渡された局面を、それ以外は盤の現在局面を検索する
  const queryKey = params.sfen ?? currentSfen ?? null;
  const { hits, isSearching, isDone, error, isStale } = useSearchSession({
    queryKey,
    isOpen,
    onReset: forgetSelection,
  });

  // 旗をここで並べ直さない。順を持っているのは `indexHealth` 1つ
  const health = indexHealth(state.index);

  const statusText = useMemo(() => {
    if (isSearching) return "検索中…";
    if (error) return "エラー";
    if (isDone) return "完了";
    return "待機中";
  }, [isSearching, error, isDone]);

  const previewData = useMemo(() => {
    if (!isOpen) return null;

    if (params.sfen) {
      return buildPreviewDataFromSfen(params.sfen);
    }

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

  /**
   * 選んだ行の添字。`selectedHit` から導出し、state には持たない（`selectedHit` の doc）。
   * 新しい検索や実体の入れ替わりで選んだ行を見失ったら、先頭に落ちる。
   */
  const activeIndex = useMemo(() => {
    if (!selectedHit) return 0;
    const i = orderedHits.indexOf(selectedHit);
    return i >= 0 ? i : 0;
  }, [orderedHits, selectedHit]);

  const activeHit = orderedHits[activeIndex];

  /**
   * 直前に選択が動いた向き。既定は下向き。
   *
   * 先読み（`PositionSearchContinuation`）の当てにだけ使う。一覧を降りている人は
   * 次も下へ行く、という以上の意味は無いので、外れても1本ぶんの読みが無駄になるだけ。
   */
  const moveDirRef = useRef<1 | -1>(1);

  const selectIndex = useCallback(
    (next: number) => {
      if (next !== activeIndex) moveDirRef.current = next > activeIndex ? 1 : -1;
      setSelectedHit(orderedHits[next] ?? null);
    },
    [orderedHits, activeIndex],
  );

  // `rowProps`（`PositionSearchHitList`）の値が1つでも変われば、仮想リストは
  // 見えている行を描き直す。描き直すのは可視ぶんと overscan の約31行で、行数には
  // 比例しないので、ここを安定させても減るのはその31行ぶんだけ。
  // `startNavigationToHit` 自身がツリーの選択で変わるので、どのみち完全には安定しない
  const accept = useCallback(
    (hit: PositionHit) => {
      // 断りは押した行に付くので、選択もその行に合わせる
      setSelectedHit(hit);

      const absPath = resolveHitAbsPath(hit);
      if (!absPath) {
        setRefusedHit({ key: hitKey(hit), reason: "no-path" });
        return;
      }
      const outcome = startNavigationToHit(absPath, hit.cursor);
      if (outcome !== "started") {
        // 索引に在る棋譜がツリーに無いのは正常運転で起こる（`usePositionHitNavigation`）。
        // 移動できないまま閉じると、盤は前の棋譜のままなのに「開いた」と読める
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
  // Escape は `Modal` が扱う。ここで拾うとハンドラが2つになる
  const onKeyDown = (e: React.KeyboardEvent) => {
    // 検索中でも開ける。結果はチャンクで届くので `isSearching` は一覧が育っている間
    // ずっと真で、ここで弾くと全件届くまで何も押せなくなる。
    // 届いたヒットは行き先を決めるのに足りる情報を持っている
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
      variant="workspace"
      size="xl"
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
                indexHealth={health}
                sessionStale={isStale}
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
                indexHealth={health}
                sessionStale={isStale}
              />
            </section>

            <aside className="pos-search__right" aria-label="局面プレビュー">
              <div className="pos-search__paneTitle">
                {params.sfen ? "検索対象の局面" : "現在の局面"}
              </div>
              <div className="pos-search__preview">
                <PositionPreviewPane previewData={previewData} />
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
