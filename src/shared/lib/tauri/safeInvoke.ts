import { invoke } from "@tauri-apps/api/core";
import type { ZodSchema } from "zod";
import { type AppError, fromUnknown, makeAppError } from "@/shared/lib/errors/AppError";

export type Result<T, E = AppError> = { ok: true; value: T } | { ok: false; error: E };

export interface SafeInvokeOptions<T> {
  schema?: ZodSchema<T>;
  userMessage?: string;
}

export async function safeInvoke<T>(
  command: string,
  args?: Record<string, unknown>,
  options?: SafeInvokeOptions<T>,
): Promise<Result<T>> {
  try {
    const raw = await invoke<unknown>(command, args);
    if (options?.schema) {
      const parsed = options.schema.safeParse(raw);
      if (!parsed.success) {
        return {
          ok: false,
          error: makeAppError(
            "schema_mismatch",
            `schema mismatch for ${command}: ${parsed.error.message}`,
            options.userMessage ?? "サーバーからの応答が不正です",
            parsed.error,
          ),
        };
      }
      return { ok: true, value: parsed.data };
    }
    return { ok: true, value: raw as T };
  } catch (e) {
    return { ok: false, error: fromUnknown(e, options?.userMessage) };
  }
}

export function unwrapOr<T>(result: Result<T>, fallback: T): T {
  return result.ok ? result.value : fallback;
}
