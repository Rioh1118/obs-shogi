import { openSinglePath } from "./openSinglePath";

export async function pickDirectory(title: string): Promise<string | null> {
  return openSinglePath({ directory: true, title });
}
