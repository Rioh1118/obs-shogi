// evals/ のケース（claude plugin eval の形式）の整合性検査と、regex 採点の自己テスト。
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { ROOT, config } from './tokens.mjs';

export const EVALS_DIR = path.join(ROOT, 'evals');
const RESERVED = new Set(['results', 'mocks', 'node_modules', 'files', 'baselines']);
const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env']);
const GRADER_TYPES = new Set(['regex', 'tool_used', 'tool_order', 'file_exists', 'llm', 'baseline']);

export function consumerRules() {
  const md = fs.readFileSync(path.join(ROOT, 'docs/consumer-claude-md.md'), 'utf8');
  const m = md.match(/<!-- consumer-rules:start -->\n([\s\S]*?)<!-- consumer-rules:end -->/);
  if (!m) throw new Error('docs/consumer-claude-md.md に consumer-rules の印がない');
  return m[1];
}

export function caseDirs() {
  return fs
    .readdirSync(EVALS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !RESERVED.has(e.name))
    .map((e) => path.join(EVALS_DIR, e.name));
}

function frontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?/);
  return m ? { data: parseYaml(m[1]) ?? {}, body: text.slice(m[0].length) } : { data: null, body: text };
}

export function loadCase(dir) {
  const name = path.basename(dir);
  const prompt = frontmatter(fs.readFileSync(path.join(dir, 'prompt.md'), 'utf8'));
  const caseYaml = parseYaml(fs.readFileSync(path.join(dir, 'case.yaml'), 'utf8'));
  const graders = fs
    .readdirSync(path.join(dir, 'graders'))
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => ({ name: f.replace(/\.md$/, ''), ...frontmatter(fs.readFileSync(path.join(dir, 'graders', f), 'utf8')) }));
  return { name, dir, prompt, caseYaml, graders };
}

/** @returns {string[]} errors */
export function checkEvals() {
  const errors = [];
  const index = JSON.parse(fs.readFileSync(path.join(EVALS_DIR, 'evals.json'), 'utf8'));
  if (index.skill_name !== config.skillName) errors.push(`evals/evals.json の skill_name が ${config.skillName} でない`);
  const dirs = caseDirs();
  const names = dirs.map((d) => path.basename(d));
  const indexed = index.cases.map((c) => c.name);
  for (const n of names) if (!indexed.includes(n)) errors.push(`evals/evals.json の索引に ${n} がない`);
  for (const n of indexed) if (!names.includes(n)) errors.push(`evals/evals.json の ${n} にフォルダがない`);
  const rules = consumerRules();
  for (const dir of dirs) {
    let c;
    try {
      c = loadCase(dir);
    } catch (e) {
      errors.push(`${path.basename(dir)}: 読めない（${e.message}）`);
      continue;
    }
    if (!/^[a-z][a-z0-9-]*$/.test(c.name)) errors.push(`${c.name}: ケース名は小文字・数字・ハイフン`);
    if (c.caseYaml?.schema_version !== '1.1') errors.push(`${c.name}/case.yaml: schema_version は "1.1"（文字列）`);
    if (c.caseYaml?.name !== c.name) errors.push(`${c.name}/case.yaml: name がフォルダ名と違う`);
    for (const k of Object.keys(c.prompt.data ?? {})) if (!PROMPT_KEYS.has(k)) errors.push(`${c.name}/prompt.md: 未知のキー ${k}`);
    if (!c.prompt.body.trim()) errors.push(`${c.name}/prompt.md: プロンプトが空`);
    if (!c.graders.length) errors.push(`${c.name}: grader がない`);
    const listed = index.cases.find((x) => x.name === c.name)?.graders ?? [];
    if (JSON.stringify(listed) !== JSON.stringify(c.graders.map((g) => g.name))) errors.push(`${c.name}: evals.json の graders 一覧とフォルダが違う`);
    for (const g of c.graders) {
      if (!g.data) errors.push(`${c.name}/${g.name}: frontmatter がない（CLI に無視される）`);
      else if (!GRADER_TYPES.has(g.data.type)) errors.push(`${c.name}/${g.name}: 未知の type ${g.data.type}`);
      if (g.data?.type === 'regex') {
        try {
          new RegExp(g.data.pattern, g.data.flags ?? '');
        } catch (e) {
          errors.push(`${c.name}/${g.name}: 正規表現が不正（${e.message}）`);
        }
      }
      if (g.data?.type === 'llm' && !g.body.trim()) errors.push(`${c.name}/${g.name}: llm の基準（本文）が空`);
      if (g.data?.input_match && /design-system/.test(g.data.input_match) && !g.data.input_match.includes(config.skillName)) errors.push(`${c.name}/${g.name}: スキル名が ${config.skillName} と違う`);
    }
    const claudeMd = path.join(dir, 'files/CLAUDE.md');
    if (!fs.existsSync(claudeMd) || fs.readFileSync(claudeMd, 'utf8') !== rules) errors.push(`${c.name}/files/CLAUDE.md が docs/consumer-claude-md.md のルールと違う（npm run ds:eval -- --dry-run で同期）`);
  }
  return errors;
}

export function syncCaseFiles() {
  const rules = consumerRules();
  for (const dir of caseDirs()) {
    fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'files/CLAUDE.md'), rules);
  }
}

/** regex 採点の自己テスト：examples/good の内容では合格、examples/bad では不合格になる grader を確かめる */
export function selfTestGraders() {
  const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
  const fixtures = {
    goodCss: read('examples/good/button-usage.css'),
    goodJsx: read('examples/good/button-usage.jsx'),
    badCss: read('examples/bad/hardcoded-values.css'),
    badJsx: read('examples/bad/hardcoded-values.jsx'),
  };
  const results = [];
  for (const dir of caseDirs()) {
    const c = loadCase(dir);
    for (const g of c.graders.filter((x) => x.data?.type === 'regex' && x.data?.target?.source === 'file')) {
      const isCss = g.data.target.path.endsWith('.css');
      const re = new RegExp(g.data.pattern, (g.data.flags ?? '') + 'g');
      const passes = (text) => {
        const n = (text.match(re) ?? []).length;
        if (g.data.match === 'not_contains') return n === 0;
        if (g.data.match?.startsWith('count:')) return n === Number(g.data.match.slice(6));
        return n > 0;
      };
      const good = isCss ? fixtures.goodCss : fixtures.goodJsx;
      const bad = isCss ? fixtures.badCss : fixtures.badJsx;
      // not_contains（禁止）の grader だけが「good 合格・bad 不合格」の対で意味を持つ
      if (g.data.match === 'not_contains') results.push({ id: `${c.name}/${g.name}`, good: passes(good), bad: passes(bad), ok: passes(good) && !passes(bad) });
    }
  }
  return results;
}
