import { useMemo } from "react";
import type { ProfileCandidate } from "@/commands/ai_library";

type Props = {
  profiles: ProfileCandidate[];
  selected: string | null | undefined;
  onSelect: (name: string | null) => void;

  onSetBookDir: (dir: string) => void;
  onSetBookFile: (file: string) => void;
};

export default function ProfileTab({
  profiles,
  selected,
  onSelect,
  onSetBookDir,
  onSetBookFile,
}: Props) {
  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.name === selected) ?? null;
  }, [profiles, selected]);

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div>
        <h3 style={{ margin: 0 }}>AIプロファイル</h3>
        <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
          ai_root 直下の <code>li</code> / <code>hao</code>{" "}
          のようなディレクトリを選びます。
        </p>
      </div>

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ opacity: 0.8 }}>選択中:</span>
        <code>{selected ?? "(未選択)"}</code>
        <button onClick={() => onSelect(null)} disabled={!selected}>
          解除
        </button>
      </div>

      {selectedProfile && (
        <div style={{ border: "1px solid #333", borderRadius: 8, padding: 12 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div>
              <div style={{ opacity: 0.7, fontSize: 12 }}>パス</div>
              <code>{selectedProfile.path}</code>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={{ opacity: selectedProfile.has_eval_dir ? 1 : 0.4 }}>
                eval/ {selectedProfile.has_eval_dir ? "✓" : "×"}
              </span>
              <span style={{ opacity: selectedProfile.has_nn_bin ? 1 : 0.4 }}>
                nn.bin {selectedProfile.has_nn_bin ? "✓" : "×"}
              </span>
              <span style={{ opacity: selectedProfile.has_book_dir ? 1 : 0.4 }}>
                book/ {selectedProfile.has_book_dir ? "✓" : "×"}
              </span>
            </div>

            {selectedProfile.book_db_files?.length > 0 && (
              <div style={{ marginTop: 6 }}>
                <div style={{ opacity: 0.7, fontSize: 12 }}>
                  book/ 内の .db 候補（参考）
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 8,
                    flexWrap: "wrap",
                    marginTop: 6,
                  }}
                >
                  {selectedProfile.book_db_files.map((f) => (
                    <button
                      key={f}
                      onClick={() => onSetBookFile(f)}
                      style={{ padding: "4px 8px", fontSize: 12 }}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {profiles.length === 0 ? (
        <div style={{ opacity: 0.8 }}>
          候補が見つかりません（ai_root 直下に profile
          ディレクトリがありません）。
        </div>
      ) : (
        <div style={{ border: "1px solid #333", borderRadius: 8 }}>
          {profiles.map((p) => {
            const isSelected = p.name === selected;
            return (
              <button
                key={p.name}
                onClick={() => onSelect(p.name)}
                style={{
                  width: "100%",
                  textAlign: "left",
                  padding: "10px 12px",
                  border: "none",
                  background: isSelected ? "rgba(255,255,255,0.08)" : "none",
                  cursor: "pointer",
                  display: "grid",
                  gap: 4,
                }}
              >
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <strong>{p.name}</strong>
                  <span style={{ opacity: 0.7, fontSize: 12 }}>
                    {p.has_nn_bin ? "nn.bin ✓" : "nn.bin ×"}
                  </span>
                </div>
                <div style={{ opacity: 0.65, fontSize: 12 }}>
                  <code>{p.path}</code>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ borderTop: "1px solid #333", paddingTop: 12 }}>
        <h4 style={{ margin: 0 }}>定跡パス（必須運用）</h4>
        <p style={{ margin: "6px 0 0", opacity: 0.8 }}>
          既定は <code>book/user_book1.db</code>。必要なら変更できます。
        </p>

        <div style={{ display: "grid", gap: 8, marginTop: 10, maxWidth: 420 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ opacity: 0.8 }}>book ディレクトリ名</span>
            <input
              defaultValue={"book"}
              onBlur={(e) => onSetBookDir(e.target.value.trim() || "book")}
              placeholder="book"
              style={{ padding: 8 }}
            />
          </label>

          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ opacity: 0.8 }}>book ファイル名</span>
            <input
              defaultValue={"user_book1.db"}
              onBlur={(e) =>
                onSetBookFile(e.target.value.trim() || "user_book1.db")
              }
              placeholder="user_book1.db"
              style={{ padding: 8 }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
