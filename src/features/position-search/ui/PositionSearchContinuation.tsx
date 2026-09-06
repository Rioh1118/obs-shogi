import { useEffect, useMemo, useRef, useState } from "react";
import "./PositionSearchContinuation.scss";

import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { cursorKey, type CursorPath } from "@/entities/kifu/model/cursor";

import { KifuCache } from "@/features/position-search/lib/kifuCache";
import { readContinuation } from "@/features/position-search/lib/readContinuation";

type Props = {
  activeHit: PositionHit | null;

  /**
   * 次に選ばれそうなヒット（直前の移動方向へ1つ）。**中身は出さない。**
   * その棋譜を先に読んでおくためだけに使う。
   */
  prefetchHit?: PositionHit | null;

  resolveAbsPath: (hit: PositionHit) => string | null;
  ply?: number;
};

/** 1回の読みに要るもの（どのファイルの、どの局面か）と、その同一性の鍵 */
type ReadTarget = { abs: string; cursor: CursorPath; key: string };

/**
 * 選択が止まるまで読みに行かない時間（ms）。
 *
 * 一覧は矢印で降りられる。押しっぱなしは macOS の既定で 25〜30 回/秒 なので、
 * 打鍵ごとに読むと**1本 100KB の棋譜なら 2.5〜3MB/秒を IPC 越しに運び続ける**。
 * 通り過ぎた行の中身は誰も見ないので、止まったときだけ読めばよい。
 *
 * **読み込み済み（または読んでいる最中）なら待たない。** その場合 IPC は増えず、
 * 待つ理由が無い。先読み（下の `PREFETCH_DELAY_MS`）が効くのはここ。
 */
const READ_DEBOUNCE_MS = 150;

/**
 * 次に選ばれそうな1行を先に読むまでの時間（ms）。
 *
 * **選んでいる行より後に置く。** 同時に走らせると、利用者が待っている読みと
 * 誰も待っていない読みが同じ IPC を取り合う。
 *
 * 先読みが当たると、次の矢印は待ち時間ごと消える（読み込み済みなら待たない）。
 * 外れても捨てるのは1本ぶんの読みで、抱えている量の上限は変わらない。
 */
const PREFETCH_DELAY_MS = 300;

export default function PositionSearchContinuation({
  activeHit,
  prefetchHit = null,
  resolveAbsPath,
  ply = 3,
}: Props) {
  const [moves, setMoves] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const kifuCacheRef = useRef(new KifuCache());
  const seqRef = useRef(0);

  const targetRef = useRef<ReadTarget | null>(null);

  /**
   * **鍵が同じなら、前に作った object をそのまま返す。**
   *
   * `resolveAbsPath` は `filePathById` を閉じ込めていて、チャンクが新しい
   * fileId を1つでも運んでくると同一性が壊れる（`entities/search/model/reducer.ts`
   * の `mergeFiles`）。Rust はほぼ全チャンクに `files` を付けて emit するので、
   * 素直に組むと**選択が動いていないのに**下の effect がチャンクごとに走り、
   * 右ペインが「取得中…」へ差し替わって検索が終わるまで点滅し続ける。
   *
   * 鍵は `abs` と `cursorKey` の組なので、**鍵が同じなら中身も同じ**。引けなかった
   * パスが後から索引に入った場合は `abs` が変わるので鍵も変わり、読み直される。
   */
  const target = useMemo<ReadTarget | null>(() => {
    const next = ((): ReadTarget | null => {
      if (!activeHit) return null;
      const abs = resolveAbsPath(activeHit);
      if (!abs) return null;

      const cursor = cursorFromLite(activeHit.cursor);
      return { abs, cursor, key: `${abs}::${cursorKey(cursor)}` };
    })();

    const prev = targetRef.current;
    if (prev && next && prev.key === next.key) return prev;

    targetRef.current = next;
    return next;
  }, [activeHit, resolveAbsPath]);

  useEffect(() => {
    // **世代は行き先の有無より先に進める。** 行き先が消えた側が世代を据え置くと、
    // 飛んでいる読みの `mySeq` が有効なまま残り、解決したときに**もう選ばれて
    // いない行の続きが書き戻される**。検索をやり直して0件になった場面では、
    // 前の検索で選んでいた行の続きが「取得中」ですらない顔で残る
    const mySeq = ++seqRef.current;

    if (!target) {
      setMoves(null);
      setLoading(false);
      return;
    }
    const { abs, cursor } = target;

    setLoading(true);

    const cache = kifuCacheRef.current;

    const run = () => {
      void (async () => {
        try {
          const { jkf } = await cache.load(abs);

          // **捨てると決まった選択は、ここから先へ進めない。** 読みと解析は
          // ファイル単位で共有されるので途中で止めても得は無いが、この先は
          // 選んだ1行のためだけの仕事（`buildPlayer` は 60手 0.13ms /
          // 300手 2.54ms）で、誰も見ない
          if (seqRef.current !== mySeq) return;

          setMoves(readContinuation(jkf, cursor, ply));
          setLoading(false);
        } catch {
          if (seqRef.current !== mySeq) return;
          setMoves(null);
          setLoading(false);
        }
      })();
    };

    // もう読んである（か、読んでいる最中）なら待たない。`read_file` は増えない
    if (cache.has(abs)) {
      run();
      return;
    }

    const timer = window.setTimeout(run, READ_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [target, ply]);

  /**
   * 次に選ばれそうな行の棋譜。**文字列で持つ。** ここが object だと
   * `resolveAbsPath` の作り直しで下の effect が動き、選択が動いていないのに
   * 先読みが走る
   */
  const prefetchAbs = useMemo(() => {
    if (!prefetchHit) return null;
    return resolveAbsPath(prefetchHit);
  }, [prefetchHit, resolveAbsPath]);

  useEffect(() => {
    if (!prefetchAbs || prefetchAbs === target?.abs) return;

    const cache = kifuCacheRef.current;
    if (cache.has(prefetchAbs)) return;

    const timer = window.setTimeout(() => {
      // 誰も待っていない読み。失敗しても画面には出さない——出す先は
      // 「選んでいる行の続き」だけで、そこはこの棋譜ではない
      void cache.load(prefetchAbs).catch(() => {});
    }, PREFETCH_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [prefetchAbs, target?.abs]);

  return (
    <section className="pos-search-cont" aria-label={`続き${ply}手`}>
      <div className="pos-search-cont__head">続き（{ply}手）</div>

      {loading ? (
        <div className="pos-search-cont__body is-muted">取得中…</div>
      ) : !moves || moves.length === 0 ? (
        <div className="pos-search-cont__body is-muted">（続きなし）</div>
      ) : (
        <div className="pos-search-cont__body">
          {moves.map((m, i) => (
            <span key={`${m}-${i}`} className="pos-search-cont__mv">
              {m}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
