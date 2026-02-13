import "./ProfileTab.scss";
import { useMemo } from "react";
import type { ProfileCandidate } from "@/commands/ai_library";
import {
  SButton,
  SField,
  SInput,
  SSection,
} from "@/components/SettingsModal/ui";

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

  const hasProfiles = profiles.length > 0;

  return (
    <div className="st-profile">
      <SSection
        title="AIプロファイル"
        description={
          <>
            ai_root 直下の <code>li</code> / <code>hao</code> のような
            ディレクトリを選びます。
          </>
        }
        actions={
          <div className="st-profile__topActions">
            <span className="st-profile__selected">
              選択中: <code>{selected ?? "(未選択)"}</code>
            </span>
            <SButton
              variant="ghost"
              onClick={() => onSelect(null)}
              disabled={!selected}
            >
              解除
            </SButton>
          </div>
        }
      >
        {selectedProfile && (
          <div className="st-profile__card">
            <div className="st-profile__cardRow">
              <div className="st-profile__metaLabel">パス</div>
              <code className="st-profile__code">{selectedProfile.path}</code>
            </div>

            <div className="st-profile__checks">
              <span data-ok={selectedProfile.has_eval_dir ? "1" : "0"}>
                eval/ {selectedProfile.has_eval_dir ? "✓" : "×"}
              </span>
              <span data-ok={selectedProfile.has_nn_bin ? "1" : "0"}>
                nn.bin {selectedProfile.has_nn_bin ? "✓" : "×"}
              </span>
              <span data-ok={selectedProfile.has_book_dir ? "1" : "0"}>
                book/ {selectedProfile.has_book_dir ? "✓" : "×"}
              </span>
            </div>

            {selectedProfile.book_db_files?.length > 0 && (
              <div className="st-profile__chips">
                <div className="st-profile__metaLabel">book/ 内の .db 候補</div>
                <div className="st-profile__chipRow">
                  {selectedProfile.book_db_files.map((f) => (
                    <SButton
                      key={f}
                      size="sm"
                      variant="ghost"
                      onClick={() => onSetBookFile(f)}
                    >
                      {f}
                    </SButton>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {!hasProfiles ? (
          <div className="st-profile__empty">
            候補が見つかりません（ai_root 直下に profile
            ディレクトリがありません）。
          </div>
        ) : (
          <div className="st-profile__list" role="list">
            {profiles.map((p) => {
              const isSelected = p.name === selected;
              return (
                <button
                  key={p.name}
                  type="button"
                  className="st-profile__item"
                  role="listitem"
                  data-selected={isSelected ? "true" : "false"}
                  onClick={() => onSelect(p.name)}
                >
                  <div className="st-profile__itemTop">
                    <strong className="st-profile__itemName">{p.name}</strong>
                    <span className="st-profile__itemBadge">
                      {p.has_nn_bin ? "nn.bin ✓" : "nn.bin ×"}
                    </span>
                  </div>
                  <div className="st-profile__itemPath">
                    <code>{p.path}</code>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </SSection>

      <SSection
        title="定跡パス（必須運用）"
        description={
          <>
            既定は <code>book/user_book1.db</code>。必要なら変更できます。
          </>
        }
      >
        <div className="st-profile__bookGrid">
          <SField label="book ディレクトリ名" hint="既定: book">
            <SInput
              defaultValue="book"
              placeholder="book"
              onBlur={(e) => onSetBookDir(e.target.value.trim() || "book")}
            />
          </SField>

          <SField label="book ファイル名" hint="既定: user_book1.db">
            <SInput
              defaultValue="user_book1.db"
              placeholder="user_book1.db"
              onBlur={(e) =>
                onSetBookFile(e.target.value.trim() || "user_book1.db")
              }
            />
          </SField>
        </div>
      </SSection>
    </div>
  );
}
