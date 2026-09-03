import { useEffect, useMemo, useRef, useState } from "react";
import "./PositionSearchContinuation.scss";

import { cursorFromLite } from "@/entities/search";
import type { PositionHit } from "@/entities/search";
import { buildPlayer } from "@/entities/kifu/lib/buildPlayer";
import { advanceCurrentLine } from "@/entities/kifu/lib/advanceWithPlan";

import type { JKFData } from "@/entities/kifu/model/jkf";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { describeFsError, readText } from "@/entities/file-tree";
import { cursorKey } from "@/entities/kifu/model/cursor";

type Props = {
  activeHit: PositionHit | null;
  resolveAbsPath: (hit: PositionHit) => string | null;
  ply?: number;
};

class Lru<K, V> {
  private map: Map<K, V>;
  private max: number;

  constructor(max = 16) {
    this.map = new Map<K, V>();
    this.max = max;
  }

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  set(k: K, v: V) {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);

    if (this.map.size > this.max) {
      const it = this.map.keys().next();
      if (!it.done) this.map.delete(it.value);
    }
  }
}

function toText(content: unknown): string {
  if (typeof content === "string") return content;
  if (content instanceof Uint8Array) return new TextDecoder().decode(content);
  return String(content ?? "");
}

async function loadJkfData(absPath: string): Promise<JKFData> {
  const res = await readText(absPath);
  // 投げる API を `catch {}` で握り潰すと、権限も見つからないも解析失敗も
  // 同じ「続きが無い」に見える。理由を持ったまま上へ返す
  if (!res.success) throw new Error(describeFsError(res.error.code));
  return parseKifuStringToJKF(toText(res.data)).jkf as JKFData;
}

export default function PositionSearchContinuation({ activeHit, resolveAbsPath, ply = 3 }: Props) {
  const [moves, setMoves] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const jkfCacheRef = useRef(new Lru<string, JKFData>(16));
  const seqRef = useRef(0);

  const key = useMemo(() => {
    if (!activeHit) return null;
    const abs = resolveAbsPath(activeHit);
    if (!abs) return null;

    return `${abs}::${cursorKey(cursorFromLite(activeHit.cursor))}`;
  }, [activeHit, resolveAbsPath]);

  useEffect(() => {
    if (!activeHit || !key) {
      setMoves(null);
      setLoading(false);
      return;
    }
    const abs = resolveAbsPath(activeHit);
    if (!abs) {
      setMoves(null);
      setLoading(false);
      return;
    }

    const mySeq = ++seqRef.current;
    setLoading(true);

    (async () => {
      try {
        let data = jkfCacheRef.current.get(abs);
        if (!data) {
          data = await loadJkfData(abs);
          jkfCacheRef.current.set(abs, data);
        }

        const player = buildPlayer(data, cursorFromLite(activeHit.cursor));

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

        if (seqRef.current !== mySeq) return;
        setMoves(out);
        setLoading(false);
      } catch {
        if (seqRef.current !== mySeq) return;
        setMoves(null);
        setLoading(false);
      }
    })();
  }, [activeHit, key, resolveAbsPath, ply]);

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
