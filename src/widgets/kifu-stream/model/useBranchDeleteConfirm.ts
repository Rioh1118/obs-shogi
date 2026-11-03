import { useCallback, useEffect, useRef, useState } from "react";
import type { DeleteQuery } from "@/entities/kifu/model/branch";
import type { AsyncResult } from "@/shared/lib/result";

/**
 * 削除の確認に出すもの。
 *
 * クエリをそのまま持つ。確認のあとで組み直すと、押した行と実際に消える枝が
 * 食い違いうる（間に棋譜が変わる）。
 */
export type PendingDelete = {
  query: DeleteQuery;
  /**
   * 押した時点で盤に載っていた棋譜（`boardSeq`）。ここが今と違うなら、
   * この確認はもう別のファイルの話。
   *
   * **パスでは代用できない。** 改名・移動でもパスは動くが、盤に載っている棋譜は
   * 同じままなので、この確認はまだ有効
   */
  boardSeq: number;
  /** 「本譜」か「変化N」 */
  label: string;
  /** 消える線の1手目。読めなければ空 */
  firstMove: string;
  /** 消える手数。数えられなければ null（数を伏せて確認だけ出す） */
  moveCount: number | null;
  /** 削除に失敗した理由。出るまで確認は閉じない */
  error?: string;
};

/**
 * 枝の削除を、確認を挟んでから書き込む流れを持つ。
 *
 * 確認を出すのは `requestDelete`、消すのは `confirmDelete` で、確認の後にだけ
 * `deleteBranch` を呼ぶ。盤の中身が入れ替わったら（`boardSeq` が動いたら）確認を閉じる。
 * 確認を出したまま棋譜が変わると、押した瞬間に別のファイルの枝が消える。
 */
export function useBranchDeleteConfirm(
  deleteBranch: (query: DeleteQuery) => AsyncResult<void, string>,
  boardSeq: number,
) {
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  /**
   * いま書いている最中の削除。どの削除かまで持つ。
   *
   * `state.isLoading` は使わない。あれは「棋譜への書き込みが1つ以上走っている」で、
   * 誰の書き込みかを区別しない。コメントの自動保存が並行して終わると
   * 「削除中…」が解け、まだ書いている最中に「削除する」を押し直せる。
   * そのとき候補列は既に1つ減っているので、**確認していない枝が消える。**
   *
   * 真偽値1つでも足りない。実行中でも確認は閉じられる（塞ぐと出口ゼロの
   * 行き止まりになる）ので、閉じてから別の枝の確認を開ける。
   * 誰の書き込みかを持たないと、その新しい確認が最初から「削除中…」で出る。
   */
  const [deleting, setDeleting] = useState<DeleteQuery | null>(null);

  // 失敗が返るのを待っている間に棋譜が変わりうるので、突き合わせは**返った時点**の値で行う
  const boardSeqRef = useRef(boardSeq);

  const requestDelete = useCallback(
    (pending: Omit<PendingDelete, "boardSeq" | "error">) => {
      setPendingDelete({ ...pending, boardSeq });
    },
    [boardSeq],
  );

  const cancelDelete = useCallback(() => setPendingDelete(null), []);

  // **閉じるのは書けたときだけ。** 先に閉じると `isLoading` も「削除中…」も
  // 一度も描かれず、失敗しても画面からは枝が消えたように見える（ファイルには残る）。
  // 確認文で「棋譜ファイルもすぐ書き換わります」と断言している以上、破れたら伝える。
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete) return;

    const query = pendingDelete.query;
    setDeleting(query);
    const res = await deleteBranch(query).finally(() =>
      setDeleting((cur) => (cur === query ? null : cur)),
    );
    // 閉じられていても失敗は出す。
    //
    // 待つのが長いと利用者は Escape で確認を閉じる。そこで失敗を捨てると、
    // 見えるのは「削除したはずの変化が勝手に生き返った」だけになる
    // （巻き戻しがメモリを戻すため）。
    //
    // 開き直しても危険ではない。`error` があるとき実行ボタンは押せないので、
    // 「利用者が閉じた確認が復活して、古いクエリのまま再実行される」形にはならない。
    // ただし**棋譜が変わっていたら開き直さない**。別のファイルを見ている画面に、
    // 前のファイルの枝についての確認を出しても読めない。
    if (!res.success) {
      const stillHere = pendingDelete.boardSeq === boardSeqRef.current;
      setPendingDelete((prev) => {
        if (prev?.query === query) return { ...prev, error: res.error };
        // **別の確認が開いていたら、そちらを押し退けない。** 押し退けると、
        // 利用者がいま読んでいる確認が、閉じたはずの別の枝の確認に黙って化ける。
        if (prev) return prev;
        return stillHere ? { ...pendingDelete, error: res.error } : prev;
      });
      return;
    }
    setPendingDelete((prev) => (prev?.query === query ? null : prev));
  }, [deleteBranch, pendingDelete]);

  useEffect(() => {
    boardSeqRef.current = boardSeq;
  });

  useEffect(() => {
    setPendingDelete(null);
  }, [boardSeq]);

  return {
    pendingDelete,
    /** 出ている確認の削除を書いている最中か。別の確認の削除が走っていても偽 */
    isDeleting: pendingDelete !== null && deleting === pendingDelete.query,
    requestDelete,
    confirmDelete,
    cancelDelete,
  };
}
