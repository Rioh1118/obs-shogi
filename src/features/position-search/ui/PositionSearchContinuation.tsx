import { useEffect, useMemo, useRef, useState } from "react";
import "./PositionSearchContinuation.scss";

import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { buildPlayer } from "@/entities/kifu/lib/buildPlayer";
import { advanceCurrentLine } from "@/entities/kifu/lib/advanceWithPlan";

import type { JKFData } from "@/entities/kifu/model/jkf";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { describeFsError, readText } from "@/entities/file-tree";
import { cursorKey, type CursorPath } from "@/entities/kifu/model/cursor";

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
 * 待つ理由が無い。先読み（下の `PREFETCH_STEP`）が効くのはここ。
 */
const READ_DEBOUNCE_MS = 150;

/**
 * 抱えておく棋譜の量の上限（原文の文字数）。
 *
 * **件数で決めない。** 局面検索のヒットは1ファイル1件になりやすい——同じ棋譜に
 * 同じ局面が2度出るのは千日手か合流のときだけ——ので、件数で切ると
 * 一覧を矢印で降りたときに**ほぼ全打鍵が外れる**。
 *
 * 数えるのは読んだ原文の長さで、抱えている JKF の実寸ではない。実寸を測ると
 * 測る側が持ち物に比例した仕事をすることになる。**多めに見積もる向きの
 * 誤差ではない**（JKF は原文より大きい）ので、上限は控えめに置く。
 */
const MAX_CACHED_CHARS = 2_000_000;

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

type LoadedKifu = { jkf: JKFData; sourceChars: number };

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  return String(content ?? "");
}

async function loadKifu(absPath: string): Promise<LoadedKifu> {
  const res = await readText(absPath);
  // 投げる API を `catch {}` で握り潰すと、権限も見つからないも解析失敗も
  // 同じ「続きが無い」に見える。理由を持ったまま上へ返す
  if (!res.success) throw new Error(describeFsError(res.error.code));

  const text = toText(res.data);
  return { jkf: parseKifuStringToJKF(text).jkf as JKFData, sourceChars: text.length };
}

/**
 * 読んだ棋譜を抱えておく置き場。
 *
 * **抱えるのは `Promise`。** 読み終わってから入れると、同じファイルへ戻る操作が
 * 先の読みの解決前に来たときに `read_file` が重なる。読み始めた時点で入れておけば
 * 1本に畳まれる。
 */
class KifuCache {
  /** 挿入順が「古い順」。取り出したものは末尾へ入れ直す */
  private entries = new Map<string, { value: Promise<LoadedKifu>; chars: number }>();
  private chars = 0;
  private readonly maxChars: number;

  constructor(maxChars: number) {
    this.maxChars = maxChars;
  }

  /** 待たずに済むか。読んでいる最中も真（`read_file` はもう飛んでいる） */
  has(absPath: string): boolean {
    return this.entries.has(absPath);
  }

  load(absPath: string): Promise<LoadedKifu> {
    const hit = this.entries.get(absPath);
    if (hit) {
      this.entries.delete(absPath);
      this.entries.set(absPath, hit);
      return hit.value;
    }

    const entry = { value: loadKifu(absPath), chars: 0 };
    this.entries.set(absPath, entry);

    entry.value.then(
      (loaded) => {
        // 解決を待つあいだに追い出されていたら、量に数え直さない
        if (this.entries.get(absPath) !== entry) return;
        entry.chars = loaded.sourceChars;
        this.chars += loaded.sourceChars;
        this.evict();
      },
      () => {
        // **失敗は抱えない。** 抱えると、権限が戻ってもファイルが直っても
        // 同じ断りを返し続ける
        if (this.entries.get(absPath) === entry) this.entries.delete(absPath);
      },
    );

    return entry.value;
  }

  /** 上限を超えたぶんを古い順に落とす。**最後の1つは残す**（1本で超える棋譜がある） */
  private evict() {
    while (this.chars > this.maxChars && this.entries.size > 1) {
      const oldest = this.entries.keys().next();
      if (oldest.done) return;

      const entry = this.entries.get(oldest.value);
      this.entries.delete(oldest.value);
      if (entry) this.chars -= entry.chars;
    }
  }
}

/** ヒット局面から、その線の続きを `ply` 手ぶん読む */
function readContinuation(jkf: JKFData, cursor: CursorPath, ply: number): string[] {
  const player = buildPlayer(jkf, cursor);
  const out: string[] = [];

  for (let i = 0; i < ply; i++) {
    // ヒット局面が乗っている線の続きを辿る（変化の中のヒットなら変化の続き）。
    // 索引のカーソルは「辿った経路」で `te > tesuu` を持たないので、
    // 渡せる計画がそもそも無い（`planByTe(cursor.forkPointers)` を渡しても
    // 引く te が `tesuu + 1` 以降なので1度も当たらない）。
    if (!advanceCurrentLine(player).moved) break;

    const s = player.getReadableKifu?.() ?? "";
    if (s) out.push(s);
  }

  return out;
}

export default function PositionSearchContinuation({
  activeHit,
  prefetchHit = null,
  resolveAbsPath,
  ply = 3,
}: Props) {
  const [moves, setMoves] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const kifuCacheRef = useRef(new KifuCache(MAX_CACHED_CHARS));
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
    if (!target) {
      setMoves(null);
      setLoading(false);
      return;
    }
    const { abs, cursor } = target;

    const mySeq = ++seqRef.current;
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
