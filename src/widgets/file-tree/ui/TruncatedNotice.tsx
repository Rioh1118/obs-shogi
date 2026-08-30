import NodeBox from "./NodeBox";

/**
 * 走査を打ち切ったフォルダの最後に置く行。
 *
 * 打ち切りを出さないと、上限に当たったフォルダは中身の無いフォルダと同じ形で
 * 描かれる。利用者は Finder で中身を見つけるまで食い違いに気づけず、
 * 読み直しても結果が変わらないので原因にも辿り着けない。
 *
 * 行として出す（フォルダの脇の印にしない）のは、閉じているフォルダには
 * 印を出しても意味が無いため。開いて「ここで途切れている」と分かればよい
 */
function TruncatedNotice({ level }: { level: number }) {
  return (
    <NodeBox level={level} handleClick={() => {}}>
      <span className="file-tree__truncated">表示できる上限を超えました（以降は出ません）</span>
    </NodeBox>
  );
}

export default TruncatedNotice;
