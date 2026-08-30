import NodeBox from "./NodeBox";

/**
 * 走査を打ち切ったフォルダの最後に置く行。
 *
 * 打ち切りを出さないと、上限に当たったフォルダは中身の無いフォルダと同じ形で
 * 描かれる。利用者は Finder で中身を見つけるまで食い違いに気づけず、
 * 読み直しても結果が変わらないので原因にも辿り着けない。
 *
 * 行として出す（フォルダの脇の印にしない）のは、閉じているフォルダには
 * 印を出しても意味が無いため。開いて「ここで途切れている」と分かればよい。
 *
 * **押せない行にする。** 押せる手掛かり（指のポインタ・ホバーの帯）を残すと、
 * 「開けば続きが出る」と読んで押し、無反応を「固まった」と受け取る。
 * 上限は定数なので利用者には変えられない。それも文に書く
 */
function TruncatedNotice({ level }: { level: number }) {
  return (
    <NodeBox level={level} className="node-box--static">
      <span className="file-tree__truncated">
        項目が多すぎるため、ここから先は読み込めていません（上限は変更できません）
      </span>
    </NodeBox>
  );
}

export default TruncatedNotice;
