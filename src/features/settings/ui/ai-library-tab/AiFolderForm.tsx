import { Sparkles } from "lucide-react";

import Button from "@/shared/ui/Button/Button";
import type { AiFolderFormState } from "@/features/settings/model/useAiFolderForm";
import { SField, SInput } from "../kit";

type Props = {
  form: AiFolderFormState;
};

export function AiFolderForm({ form }: Props) {
  return (
    <SField label="AI 名" description="例: Suisho / 研究用A">
      <div className="setupGuide__createRow">
        <div className="setupGuide__createInputWrap">
          <SInput
            ref={form.inputRef}
            value={form.draft}
            invalid={!!form.error}
            onChange={(e) => form.changeDraft(e.target.value)}
            placeholder="AI 名を入力"
            onKeyDown={(e) => {
              if (e.key === "Enter") void form.submit();
            }}
          />
        </div>
        <Button
          size="sm"
          onClick={form.submit}
          isLoading={form.isCreating}
          disabled={!form.draft.trim()}
        >
          <Sparkles size={14} style={{ marginRight: 6 }} />
          作成
        </Button>
      </div>
      {/* 中身と同時に DOM へ入れると VoiceOver が live region の変化として読まないので常設する */}
      <p className="setupGuide__createError" role="alert">
        {form.error ?? ""}
      </p>
    </SField>
  );
}
