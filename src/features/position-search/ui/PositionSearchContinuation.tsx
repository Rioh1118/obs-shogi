import { useEffect, useMemo, useRef, useState } from "react";
import "./PositionSearchContinuation.scss";

import type { PositionHit } from "@/entities/search";
import { applyCursorToPlayer } from "@/entities/kifu/lib/cursorRuntime";

import type { JKFData } from "@/entities/kifu/model/jkf";
import { parseKifuStringToJKF } from "@/entities/kifu/api/parse";
import { JKFPlayer } from "json-kifu-format";
import { readFile } from "@/entities/file-tree/api/fileSystem";
import { cursorFromLite } from "@/entities/search/lib/cursorAdapter";

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
  const raw = await readFile(absPath);
  const text = toText(raw);
  return parseKifuStringToJKF(text).jkf as JKFData;
}

export default function PositionSearchContinuation({
  activeHit,
  resolveAbsPath,
  ply = 3,
}: Props) {
  const [moves, setMoves] = useState<string[] | null>(null);
  const [loading, setLoading] = useState(false);

  const jkfCacheRef = useRef(new Lru<string, JKFData>(16));
  const seqRef = useRef(0);

  const key = useMemo(() => {
    if (!activeHit) return null;
    const abs = resolveAbsPath(activeHit);
    if (!abs) return null;

    const fp = activeHit.cursor.fork_pointers
      .map((p) => `${p.te}-${p.fork_index}`)
      .join(",");
    return `${abs}::${activeHit.cursor.tesuu}::${fp}`;
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

        const jkf = new JKFPlayer(data);

        const cursor = cursorFromLite(activeHit.cursor);
        applyCursorToPlayer(jkf, cursor);

        const planned = new Map<number, number>();
        for (const p of cursor.forkPointers) planned.set(p.te, p.forkIndex);

        const out: string[] = [];
        for (let i = 0; i < ply; i++) {
          const te = jkf.tesuu + 1;
          if (!jkf.currentStream[te]) break;

          const plannedForkIndex = planned.get(te) ?? null;

          let ok = false;
          if (plannedForkIndex != null) {
            ok = jkf.forkAndForward(plannedForkIndex);
            if (!ok) ok = jkf.forward();
          } else {
            ok = jkf.forward();
          }
          if (!ok) break;

          const s = jkf.getReadableKifu?.() ?? "";
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
