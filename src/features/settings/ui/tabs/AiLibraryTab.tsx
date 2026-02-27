import { useEffect, useMemo, useRef, useState } from "react";
import "./AiLibraryTab.scss";

import { FolderOpen, Copy, Sparkles } from "lucide-react";

import { SButton, SField, SInput, SSection } from "../kit";
import { useAppConfig } from "@/entities/app-config";
import { chooseAiRoot } from "@/entities/app-config/api/directories";

import {
  scanAiRoot,
  ensureEnginesDir,
  type AiRootIndex,
  type FsKind,
  type ProfileCandidate,
} from "@/entities/engine/api/aiLibrary";

import { revealInFileManager } from "@/shared/api/shell/revealInFileManager";
import { copyText } from "@/shared/api/clipboard/copyText";
import SetupGuide from "../ai-library-tab/SetupGuide";

function normalizePath(p: string) {
  return (p ?? "").replace(/\\/g, "/");
}
function isDir(kind: FsKind) {
  return kind === "dir";
}
function profileHealth(p: ProfileCandidate) {
  const okEval = p.has_eval_dir && p.eval_files.length > 0;
  const okBook = p.has_book_dir && p.book_db_files.length > 0;
  return { okEval, okBook };
}

type ScanState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; data: AiRootIndex; at: number }
  | { status: "error"; error: string };

export default function AiLibraryTab() {
  const { config } = useAppConfig();

  const aiRoot = config?.ai_root ?? "";
  const [localAiRoot, setLocalAiRoot] = useState(aiRoot);

  const [scan, setScan] = useState<ScanState>({ status: "idle" });
  const didInitRef = useRef(false);

  useEffect(() => setLocalAiRoot(aiRoot), [aiRoot]);

  const canOperate = localAiRoot.trim().length > 0;

  const scanNow = async (root: string) => {
    const r = root.trim();
    if (!r) return;
    setScan({ status: "loading" });
    try {
      const data = await scanAiRoot(r);
      setScan({ status: "ready", data, at: Date.now() });
    } catch (e) {
      setScan({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const refresh = async () => scanNow(localAiRoot);

  useEffect(() => {
    if (didInitRef.current) return;
    didInitRef.current = true;
    if (localAiRoot.trim()) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const data = scan.status === "ready" ? scan.data : null;

  const warnings = useMemo(() => {
    if (!data) return [] as string[];
    const ws: string[] = [];

    if (!data.engines_dir.exists || !isDir(data.engines_dir.kind)) {
      ws.push("engines/ が見つかりません。『engines/ を作成』で生成できます。");
    }
    if ((data.engines?.length ?? 0) === 0) {
      ws.push(
        "エンジン実行ファイルが未検出です。engines/ 配下に置いてください。",
      );
    }

    for (const p of data.profiles ?? []) {
      const { okEval, okBook } = profileHealth(p);
      if (!okEval)
        ws.push(
          `「${p.name}」: eval が未検出です（<AI名>/eval に nn.bin 等）。`,
        );
      if (!okBook)
        ws.push(`「${p.name}」: book が未検出です（<AI名>/book に .db）。`);
    }
    return ws;
  }, [data]);

  const enginesCount = data?.engines?.length ?? 0;
  const profilesCount = data?.profiles?.length ?? 0;

  const badge = useMemo(() => {
    if (!canOperate) return { tone: "warn" as const, text: "未設定" };
    if (scan.status === "loading")
      return { tone: "muted" as const, text: "診断中…" };
    if (scan.status === "error")
      return { tone: "danger" as const, text: "エラー" };
    if (scan.status === "ready")
      return warnings.length > 0
        ? { tone: "warn" as const, text: "注意あり" }
        : { tone: "ok" as const, text: "OK" };
    return { tone: "muted" as const, text: "—" };
  }, [canOperate, scan.status, warnings.length]);

  const onPick = async () => {
    const picked = await chooseAiRoot({ force: true });
    if (!picked) return;
    setLocalAiRoot(picked);
    await scanNow(picked);
  };

  const onEnsureEngines = async () => {
    const root = localAiRoot.trim();
    if (!root) return;
    setScan({ status: "loading" });
    try {
      await ensureEnginesDir(root);
      await scanNow(root);
    } catch (e) {
      setScan({
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  };

  const enginesDirPath =
    data?.engines_dir?.path ||
    (localAiRoot ? `${normalizePath(localAiRoot)}/engines` : "");

  const enginesDirOk = !!(
    data?.engines_dir?.exists && isDir(data.engines_dir.kind)
  );

  return (
    <div className="aiLibraryTab">
      <div className="aiLibraryTab__grid">
        <div className="aiLibraryTab__mainCol">
          <SSection
            title="AIライブラリ"
            description="エンジン本体・評価関数・定跡DBをまとめて管理する場所です（推奨：専用フォルダを1つ作って固定）。"
            actions={
              <div className="aiLibraryTab__badge" data-tone={badge.tone}>
                {badge.text}
              </div>
            }
          >
            <SField
              label="AIルート（ai_root）"
              description="決めたルールのフォルダ構成でファイルを置くと自動検出します。"
              right={
                <div className="aiLibraryTab__fieldActions">
                  <SButton variant="primary" size="sm" onClick={onPick}>
                    <FolderOpen size={16} style={{ marginRight: 6 }} />
                    選択…
                  </SButton>

                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={() => revealInFileManager(localAiRoot)}
                    disabled={!canOperate}
                    title="Finder/Explorer で開く"
                  >
                    開く
                  </SButton>

                  <SButton
                    variant="ghost"
                    size="sm"
                    onClick={() => copyText(localAiRoot)}
                    disabled={!canOperate}
                    title="パスをコピー"
                  >
                    <Copy size={16} />
                  </SButton>
                </div>
              }
            >
              <SInput
                value={localAiRoot}
                placeholder="未設定（選択… からフォルダを選んでください）"
                readOnly
              />
            </SField>

            <div className="aiLibraryTab__rowActions">
              {!enginesDirOk && (
                <SButton
                  variant="subtle"
                  size="sm"
                  onClick={onEnsureEngines}
                  disabled={!canOperate || scan.status === "loading"}
                >
                  <Sparkles size={16} style={{ marginRight: 6 }} />
                  engines/ を作成
                </SButton>
              )}

              <SButton
                variant="ghost"
                size="sm"
                onClick={() => revealInFileManager(enginesDirPath)}
                disabled={!canOperate}
                title="engines/ を開く"
              >
                engines/ を開く
              </SButton>
            </div>

            {scan.status === "error" && (
              <div className="aiLibraryTab__error" role="alert">
                {scan.error}
              </div>
            )}
          </SSection>
        </div>

        {/* 右：ガイド（分離済み） */}
        <SetupGuide
          canOperate={canOperate}
          enginesDirOk={enginesDirOk}
          enginesCount={enginesCount}
          profilesCount={profilesCount}
          scanReady={scan.status === "ready"}
          warnings={warnings}
        />
      </div>
    </div>
  );
}
