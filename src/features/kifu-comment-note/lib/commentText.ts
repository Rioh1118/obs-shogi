export function linesToEditorText(lines: string[]): string {
  return lines.join("\n");
}

export function editorTextToLines(text: string): string[] {
  const normalized = String(text ?? "").replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");

  while (lines.length > 0 && lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}
