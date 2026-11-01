import { useRef, useState } from "react";

import { describeFsError } from "@/entities/file-tree";
import type { CreateAiFolderResult } from "./useAiLibrary";

/**
 * 「AI フォルダを追加」の欄の状態を持つ。
 *
 * 欄の部品でなく手順書が持つ。作成の途中でルートを切り替えると欄が一度消えるので、部品に持たせると
 * 打った名前が失われる。
 */
export function useAiFolderForm(createAiFolder: (name: string) => Promise<CreateAiFolderResult>) {
  const [draft, setDraft] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  // 名前を直せば通る失敗の文言。打った文字列は残す
  const [error, setError] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const focusInput = () => inputRef.current?.focus();

  const changeDraft = (value: string) => {
    setDraft(value);
    setError(null);
  };

  const submit = async () => {
    // state では間に合わない。Enter のキーリピートはレンダより速く、同じ名前で並走すると
    // 作れたのに「すでにあります」が出る
    if (inFlightRef.current) return;

    const name = draft.trim();
    if (!name) {
      focusInput();
      return;
    }

    inFlightRef.current = true;
    setIsCreating(true);
    try {
      const result = await createAiFolder(name);

      // 宛先を失ったとき。打った名前も赤字も動かさない。旧ルートの結果は通知が伝える
      if (result === "stale") return;

      if (result) {
        // 打った名前は消さない。消すと、直すのではなく打ち直しになる
        setError(describeFsError(result.code));
        focusInput();
        return;
      }

      // `await` の前で消すと、宛先を失ったときに赤字だけが消える
      setError(null);
      setDraft("");
    } finally {
      inFlightRef.current = false;
      setIsCreating(false);
    }
  };

  return { draft, isCreating, error, inputRef, focusInput, changeDraft, submit };
}

export type AiFolderFormState = ReturnType<typeof useAiFolderForm>;
