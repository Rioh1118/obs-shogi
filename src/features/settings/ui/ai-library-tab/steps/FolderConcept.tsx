type Role = { label: string; role: string; example: string; optional?: boolean };

const ROLES: Role[] = [
  { label: "engines/", role: "エンジン実行ファイル", example: "YaneuraOu-xxx" },
  { label: "＜AI 名＞/eval/", role: "評価関数", example: "nn.bin" },
  { label: "＜AI 名＞/book/", role: "定跡ファイル", example: "standard.db", optional: true },
];

/** 完成形の例。1段階ごとに字下げする */
const EXAMPLE: { indent: number; text: string; note?: string }[] = [
  { indent: 0, text: "my_shogi/", note: "← AI ライブラリ（名前は自由）" },
  { indent: 1, text: "engines/" },
  { indent: 2, text: "YaneuraOu-by-Yaneuura", note: "← エンジン本体" },
  { indent: 2, text: "Suisho5-master" },
  { indent: 1, text: "Suisho5/", note: "← AI 名（複数作成できる）" },
  { indent: 2, text: "eval/" },
  { indent: 3, text: "nn.bin", note: "← 評価関数" },
  { indent: 2, text: "book/" },
  { indent: 3, text: "user_book1.db", note: "← 定跡（.db か .ybb）" },
];

/** 置くフォルダの役割と、完成形の例を見せる。 */
export function FolderConcept() {
  return (
    <div className="folderConcept">
      <table className="folderConcept__roles">
        <tbody>
          {ROLES.map(({ label, role, example, optional }) => (
            <tr key={label}>
              <th scope="row">{label}</th>
              <td>
                {role}
                {optional && <span className="folderConcept__optional">任意</span>}
              </td>
              <td className="folderConcept__sample">{example}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 className="folderConcept__exampleTitle">完成形の例</h4>
      <div className="folderConcept__example">
        {EXAMPLE.map(({ indent, text, note }) => (
          <div
            key={text}
            className="folderConcept__exampleLine"
            style={{ paddingLeft: `${indent * 1.6}rem` }}
          >
            {text}
            {note && <span className="folderConcept__exampleNote">{note}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}
