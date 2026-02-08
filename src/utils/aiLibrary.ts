import type {
  EngineSetupCheck,
  EngineSetupDraft,
  WorkDirPolicy,
} from "@/commands/ai_library";
import type { EngineIssue, EngineValidation } from "@/types/ai_validation";
import type { EngineConfig } from "@/types/engine";

export function toDraft(desired: EngineConfig): EngineSetupDraft {
  const work_dir_policy: WorkDirPolicy = "profile_dir";

  return {
    ai_root: desired.aiRoot,
    engine_entry: desired.selectedEngineRel,
    profile_name: desired.selectedAiName,

    eval_dir_name: desired.evalDirName,
    book_dir_name: desired.bookDirName,
    nn_file_name: "nn.bin",
    book_file_name: desired.bookFileName,

    work_dir_policy,
    custom_work_dir: null,
  };
}

export function buildIssuesFromCheck(
  check: EngineSetupCheck | null,
): EngineValidation {
  if (!check) {
    return {
      status: "idle",
      issues: [{ code: "NOT_CONFIGURED", message: "未設定です" }],
    };
  }

  if (!check.configured) {
    return {
      status: "idle",
      issues: [
        {
          code: "NOT_CONFIGURED",
          message: "aiRoot / profile / engine の選択が不足しています",
        },
      ],
    };
  }

  if (check.ok) return { status: "ok", issues: [] };

  const missing = (check.checks ?? []).filter((c) => !c.exists);

  // bookFile 必須
  const issues: EngineIssue[] = missing.map((m) => {
    const code: EngineIssue["code"] =
      m.key === "engine_path"
        ? "MISSING_ENGINE"
        : m.key === "eval_dir"
          ? "MISSING_EVAL_DIR"
          : m.key === "nn_path"
            ? "MISSING_NN_BIN"
            : m.key === "book_dir"
              ? "MISSING_BOOK_DIR"
              : m.key === "book_path"
                ? "MISSING_BOOK_DB"
                : m.key === "ai_root"
                  ? "MISSING_PATH" // ← ここを変更
                  : m.key === "profile_dir"
                    ? "MISSING_PROFILE_DIR"
                    : m.key === "engines_dir"
                      ? "MISSING_ENGINES_DIR"
                      : m.key === "work_dir"
                        ? "INVALID_WORK_DIR"
                        : "MISSING_PATH";

    const message =
      code === "MISSING_ENGINE"
        ? "エンジンが見つかりません"
        : code === "MISSING_EVAL_DIR"
          ? "eval ディレクトリが見つかりません"
          : code === "MISSING_NN_BIN"
            ? "nn.bin が見つかりません"
            : code === "MISSING_BOOK_DIR"
              ? "book ディレクトリが見つかりません"
              : code === "MISSING_BOOK_DB"
                ? "定跡DBが見つかりません"
                : "必要なパスが不足しています";

    return { code, message, path: m.path };
  });

  return { status: "ng", issues };
}
