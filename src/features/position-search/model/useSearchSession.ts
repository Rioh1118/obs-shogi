import { useCallback, useEffect, useRef, useState } from "react";

import { usePositionSearch, type PositionHit } from "@/entities/search";

type SearchSessionOptions = {
  /** 検索する局面の SFEN。`null` なら検索を立てない */
  queryKey: string | null;
  /** 偽になったら検索を取り下げて結果を捨て、真に戻ったら検索し直す */
  isOpen: boolean;
  /**
   * 検索を捨てて初めからやり直すときに呼ぶ。閉じたときと局面が変わったときの2つ。
   * 起動の effect の依存に入るので、同一性を保つこと
   */
  onReset: () => void;
};

/**
 * 画面が開いている間、その局面の検索を1本だけ走らせ、届いた結果と状態を返す。
 *
 * 局面が変わるか閉じると、前の検索を取り下げて結果も捨てる。unmount されたときも同じ。
 */
export function useSearchSession({ queryKey, isOpen, onReset }: SearchSessionOptions) {
  const {
    searchPosition,
    cancelSearch,
    getSessionByRequestId,
    getHitsByRequestId,
    isSearchingRequest,
    clearSearch,
  } = usePositionSearch();

  const [requestId, setRequestId] = useState<number | null>(null);
  /**
   * 撃ち直しの合図。受け付けられなかった検索の後に、同じ問い合わせでもう一度立てる。
   * `queryKey` が変わっていないので、これが無いと起動の effect が再走しない。
   */
  const [relaunchNonce, setRelaunchNonce] = useState(0);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [isLaunching, setIsLaunching] = useState(false);

  const lastQueryKeyRef = useRef<string | null>(null);

  // 取り下げる rid は state でなく ref で持つ。`setRequestId` の反映を待つと、
  // invoke の解決の直後に続けて撃ち直したとき、直前の rid を取り下げ損なう
  const inFlightRidRef = useRef<number | null>(null);

  /**
   * 起動の世代。`search_position` の invoke が解決するまで rid は分からないので、
   * もう要らないことを rid でなくこれで表す。解決した側が自分の番かを確かめる。
   */
  const launchSeqRef = useRef(0);

  /**
   * 今の起動を要らないものにし、rid が分かっていれば検索を取り下げて結果も捨てる。
   *
   * 取り下げるだけでは足りない。届いたヒットの実体はセッションに残り、
   * 開き直すたびに1検索ぶん積み上がる（2026-09-07 の実測で、10万件なら 17.6MB）。
   * 結果を捨てる `clearSearch` を呼ぶのはこの hook だけで、ここと、要らなくなった
   * 起動の invoke が解決した側の2か所が呼ぶ。
   *
   * 開いた直後に Esc を押すと、rid が分かる前に呼ばれる。そのときは世代を進めるだけで、
   * 実際の取り下げは invoke が解決した側が引き受ける。
   */
  const discardSearch = useCallback(() => {
    launchSeqRef.current += 1;

    // 捨てたら、次に描かれたときに撃ち直す。ここを呼ぶのは、閉じる分岐、撃ち直しの分岐、
    // unmount の後始末の3か所。unmount の後始末は世代を進めるだけなので、覚えている問い合わせを
    // 残すと、張り直された effect が早期 return して飛行中の起動を降ろす者が居なくなり、
    // 画面は結果の来ない「検索中…」で固まる
    lastQueryKeyRef.current = null;

    const rid = inFlightRidRef.current;
    if (rid == null) return;

    inFlightRidRef.current = null;
    void cancelSearch(rid);
    clearSearch(rid);
  }, [cancelSearch, clearSearch]);

  useEffect(() => {
    if (!isOpen) {
      discardSearch();
      setRequestId(null);
      setLaunchError(null);
      setIsLaunching(false);
      onReset();
      return;
    }

    if (!queryKey) return;
    if (lastQueryKeyRef.current === queryKey) return;

    discardSearch();

    lastQueryKeyRef.current = queryKey;
    setRequestId(null);
    setLaunchError(null);
    setIsLaunching(true);
    onReset();

    const myLaunch = launchSeqRef.current;

    void (async () => {
      try {
        // 区切りの大きさは測って決めた値ではない。大きくすると1本あたりの IPC が重くなり、
        // 小さくすると溜め場に積む回数が増える、という向きが分かっているだけ。
        // レンダの回数は `CHUNK_FLUSH_MS`（20回/秒）が抑えるので、この値に左右されない
        const launch = await searchPosition({
          sfen: queryKey,
          consistency: "BestEffort",
          chunkSize: 300,
        });

        // 自分の番でなければ、ここで取り下げる。待っているあいだに閉じたか
        // 撃ち直されたなら、`discardSearch` は rid を知らないので何もできていない。
        // 素通りさせると Rust の検索は最後まで走り、閉じた画面が到着のたびに
        // 一覧を組み直し続ける
        if (launchSeqRef.current !== myLaunch) {
          if (launch.status === "started") {
            void cancelSearch(launch.requestId);
            clearSearch(launch.requestId);
          }
          return;
        }

        // 索引が開き直されて受け付けられなかったときは、rid を採用せずに撃ち直す。
        // 採用するとセッションの無い rid を握って「待機中 / 一致する棋譜が
        // ありません」になり、0件が完了として出る。`isLaunching` も降ろさない。
        // 降ろすと、撃ち直しが立つまでの1レンダで同じ画面が出る
        if (launch.status === "superseded") {
          lastQueryKeyRef.current = null;
          setRelaunchNonce((n) => n + 1);
          return;
        }

        inFlightRidRef.current = launch.requestId;
        setRequestId(launch.requestId);
        setIsLaunching(false);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("[PositionSearchModal] search failed:", e);

        // 失敗も自分の番のときだけ出す。捨てた起動の失敗をここで載せると、
        // 後から解決した検索の正しい結果の上に「検索に失敗しました」が残り、
        // 同じ画面では撃ち直せない
        if (launchSeqRef.current !== myLaunch) return;
        setLaunchError(e instanceof Error ? e.message : String(e));
        setIsLaunching(false);
      }
    })();
  }, [
    isOpen,
    queryKey,
    relaunchNonce,
    searchPosition,
    cancelSearch,
    clearSearch,
    discardSearch,
    onReset,
  ]);

  useEffect(() => {
    return () => discardSearch();
  }, [discardSearch]);

  const session = getSessionByRequestId(requestId);
  const hits: PositionHit[] = getHitsByRequestId(requestId);

  const isSearching = isLaunching || isSearchingRequest(requestId);

  return {
    hits,
    isSearching,
    isDone: !!session?.isDone && !isSearching,
    error: launchError ?? session?.error ?? null,
    /** この検索が走っている間に索引が動いた */
    isStale: !!session?.stale,
  };
}
