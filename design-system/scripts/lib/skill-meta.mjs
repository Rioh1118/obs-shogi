// SKILL.md の frontmatter（name / description）は lumen.config.json から作る。
// ブランド名を手で書く場所を1か所（lumen.config.json）にするため。
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, config } from './tokens.mjs';

export const SKILL_PATH = path.join(ROOT, 'SKILL.md');

export function expectedFrontmatter() {
  const description = config.skillDescriptionTemplate.replaceAll('{brandName}', config.brandName);
  return `---\nname: ${config.skillName}\ndescription: ${description}\n---\n`;
}

export function splitFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n/);
  return m ? { fm: m[0], body: text.slice(m[0].length) } : { fm: '', body: text };
}

/** write=true なら書き換える。false なら一致しているかを返す */
export function syncSkillMeta({ write }) {
  const text = fs.readFileSync(SKILL_PATH, 'utf8');
  const { fm, body } = splitFrontmatter(text);
  const want = expectedFrontmatter();
  if (fm === want) return true;
  if (write) {
    fs.writeFileSync(SKILL_PATH, want + body.replace(/^\n*/, '\n'));
    return true;
  }
  return false;
}
