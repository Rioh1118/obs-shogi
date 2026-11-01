import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { loadStudyPositions, saveStudyPositions } from "../api/studyPositions";
import { sfenToPositionKey } from "../lib/sfenToPositionKey";
import { StudyPositionsContext } from "./context";
import type { StudyPositionsContextType } from "./context";
import { createSerialQueue } from "@/shared/lib/serialQueue";
import type {
  CreateStudyPositionInput,
  StudyPosition,
  StudyPositionsState,
  UpdateStudyPositionInput,
} from "./types";

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];

  for (const tag of tags) {
    const v = tag.trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }

  return out;
}

function normalizeStoredPosition(position: StudyPosition): StudyPosition {
  return {
    ...position,
    sfen: position.sfen.trim(),
    label: position.label.trim(),
    description: position.description.trim(),
    tags: normalizeTags(position.tags),
  };
}

function requirePositionKey(sfen: string): string {
  const key = sfenToPositionKey(sfen);
  if (!key) {
    throw new Error("Invalid SFEN");
  }
  return key;
}

function findByPositionKey(positions: StudyPosition[], key: string): StudyPosition | undefined {
  return positions.find((p) => sfenToPositionKey(p.sfen) === key);
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function StudyPositionsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StudyPositionsState>({ positions: [], error: null });
  // 書く操作を1本ずつ通す。重なると、先の保存が失敗したときの巻き戻しが、後から通った局面を
  // 一覧から消し、次の保存がファイルからも消す
  const [enqueue] = useState(createSerialQueue);

  // 書き込みの土台。`state` は描画まで進まないので、`await` の後に読むと古い一覧を書く
  const positionsRef = useRef<StudyPosition[]>([]);

  // 読み込みの完了を待つ promise。失敗したら空に戻し、次に書く操作が読み直す。
  // `save_study_positions` はファイルごと置き換えるので、読めていない一覧の上に書くと
  // 手で直せば読めるはずの局面が全部消える
  const loadingRef = useRef<Promise<void> | null>(null);

  const replacePositions = useCallback(
    (positions: StudyPosition[], error: string | null = null) => {
      positionsRef.current = positions;
      setState({ positions, error });
    },
    [],
  );

  const readPositions = useCallback(async () => {
    try {
      const file = await loadStudyPositions();
      replacePositions(file.positions.map(normalizeStoredPosition));
    } catch (e) {
      const message = messageOf(e);
      replacePositions(positionsRef.current, message);
      throw new Error(`課題局面を読み込めないので、書き込みません（${message}）`);
    }
  }, [replacePositions]);

  const ensureLoaded = useCallback(() => {
    loadingRef.current ??= readPositions().catch((e: unknown) => {
      loadingRef.current = null;
      throw e;
    });
    return loadingRef.current;
  }, [readPositions]);

  /** 一覧を先に差し替えてから書く。書けなければ元へ戻し、失敗を呼び手へ投げ直す */
  const commitPositions = useCallback(
    async (next: StudyPosition[]) => {
      const previous = positionsRef.current;
      replacePositions(next);
      try {
        await saveStudyPositions({ positions: next });
      } catch (e) {
        replacePositions(previous, messageOf(e));
        throw e;
      }
    },
    [replacePositions],
  );

  const findBySfen = useCallback((sfen: string | null | undefined): StudyPosition | null => {
    if (!sfen) return null;

    const key = sfenToPositionKey(sfen);
    if (!key) return null;

    return findByPositionKey(positionsRef.current, key) ?? null;
  }, []);

  const addPosition = useCallback(
    (input: CreateStudyPositionInput): Promise<StudyPosition> =>
      enqueue(async () => {
        await ensureLoaded();

        const key = requirePositionKey(input.sfen);
        if (findByPositionKey(positionsRef.current, key)) {
          // 読み直しで保存済みと分かったときに、新規の形で開いた画面から来る
          throw new Error("この局面はもう保存されています。開き直すと編集できます");
        }

        const now = new Date().toISOString();
        const position = normalizeStoredPosition({
          id: crypto.randomUUID(),
          ...input,
          createdAt: now,
          updatedAt: now,
        });

        await commitPositions([position, ...positionsRef.current]);
        return position;
      }),
    [commitPositions, enqueue, ensureLoaded],
  );

  const updatePosition = useCallback(
    (input: UpdateStudyPositionInput): Promise<StudyPosition> =>
      enqueue(async () => {
        await ensureLoaded();

        const current = positionsRef.current.find((p) => p.id === input.id);
        if (!current) {
          throw new Error("Study position not found");
        }

        const updated = normalizeStoredPosition({
          ...current,
          sfen: input.sfen ?? current.sfen,
          label: input.label ?? current.label,
          description: input.description ?? current.description,
          state: input.state ?? current.state,
          tags: input.tags ?? current.tags,
          updatedAt: new Date().toISOString(),
        });

        const key = requirePositionKey(updated.sfen);
        const others = positionsRef.current.filter((p) => p.id !== updated.id);
        if (findByPositionKey(others, key)) {
          throw new Error("Another study position already exists for this position");
        }

        await commitPositions(positionsRef.current.map((p) => (p.id === updated.id ? updated : p)));
        return updated;
      }),
    [commitPositions, enqueue, ensureLoaded],
  );

  const deletePosition = useCallback(
    (id: string): Promise<void> =>
      enqueue(async () => {
        await ensureLoaded();

        if (!positionsRef.current.some((p) => p.id === id)) return;

        await commitPositions(positionsRef.current.filter((p) => p.id !== id));
      }),
    [commitPositions, enqueue, ensureLoaded],
  );

  useEffect(() => {
    ensureLoaded().catch((e: unknown) => {
      console.error("[StudyPositions] load failed:", e);
    });
  }, [ensureLoaded]);

  const value = useMemo<StudyPositionsContextType>(
    () => ({ state, addPosition, updatePosition, deletePosition, findBySfen }),
    [state, addPosition, updatePosition, deletePosition, findBySfen],
  );

  return <StudyPositionsContext.Provider value={value}>{children}</StudyPositionsContext.Provider>;
}
