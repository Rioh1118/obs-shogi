/**
 * FolderConcept
 *
 * "何を作るのか" を伝えるビジュアルコンポーネント。
 * - 各フォルダの役割を小カードで一覧
 * - 具体的な完成形の例をツリーで表示
 * テキスト説明ではなく構造と例示で伝える。
 */

type RoleCardProps = {
  label: string;
  role: string;
  example: string;
  optional?: boolean;
};

function RoleCard({ label, role, example, optional }: RoleCardProps) {
  return (
    <div className="folderConcept__roleCard">
      {optional && <span className="folderConcept__rolePill">任意</span>}
      <div className="folderConcept__roleLabel">{label}</div>
      <div className="folderConcept__roleRole">{role}</div>
      <div className="folderConcept__roleExample">{example}</div>
    </div>
  );
}

type ExampleLineProps = {
  text: string;
  note?: string;
  indent?: number;
  dim?: boolean;
};

function ExampleLine({ text, note, indent = 0, dim = false }: ExampleLineProps) {
  return (
    <div className="folderConcept__exLine" data-dim={dim} style={{ paddingLeft: indent * 16 }}>
      <span className="folderConcept__exText">{text}</span>
      {note && <span className="folderConcept__exNote">{note}</span>}
    </div>
  );
}

export function FolderConcept() {
  return (
    <div className="folderConcept">
      {/* 役割カード */}
      <div className="folderConcept__roles">
        <RoleCard label="engines/" role="エンジン実行ファイル" example="YaneuraOu-xxx" />
        <RoleCard label="＜AI名＞/eval/" role="評価関数" example="nn.bin" />
        <RoleCard label="＜AI名＞/book/" role="定跡ファイル" example="standard.db" optional />
      </div>

      {/* 完成形の例 */}
      <div className="folderConcept__exampleWrap">
        <span className="folderConcept__exampleTag">完成形の例</span>
        <div className="folderConcept__example">
          <ExampleLine text="📂 my_shogi/" note="← ai_root（名前は自由）" />
          <ExampleLine text="├─ 📂 engines/" indent={1} />
          <ExampleLine text="│  ├─ 🔧 YaneuraOu-by-Yaneuura" note="← エンジン本体" indent={1} />
          <ExampleLine text="│  └─ 🔧 Suisho5-master" indent={1} dim />
          <ExampleLine text="└─ 📂 Suisho5/" note="← AI名（複数作れる）" indent={1} />
          <ExampleLine text="├─ 📂 eval/" indent={2} />
          <ExampleLine text="│  └─ 📄 nn.bin" note="← 評価関数" indent={2} />
          <ExampleLine text="└─ 📂 book/" indent={2} />
          <ExampleLine text="   └─ 📄 user_book1.db" note="← 定跡（.db）" indent={2} dim />
        </div>
      </div>
    </div>
  );
}
