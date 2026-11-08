// npm run ds:check [-- --dir <path>]
//
// 既定（このリポジトリ）:
//   1. スキル文書の制約（SKILL.md / CLAUDE.md / ブランド名の置き場所 / evals の索引）
//   2. トークンの構文・固定値（locked.json）・下限・テーマの完全性
//   3. トークン外の値（stylelint）と JSX の禁止パターン ＋ examples/bad が必ず落ちる自己テスト
//   4. 前景色×背景色の全ペアのコントラスト（全テーマ）
//   5. 生成物の更新漏れ（ds:build を実行し、生成物が変わったら失敗）
//   6. axe（WCAG 2.2 AA）を preview/*.html に
//
// --dir <path>（explorations の案、または利用先のディレクトリ）:
//   そのディレクトリの *.tokens.json（あれば）に 2 と 4、*.css に stylelint、*.jsx/*.tsx に禁止パターン、*.html に axe。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import stylelint from 'stylelint';
import { parse as parseYaml } from 'yaml';
import { ROOT, config, TOKENS_DIR, listTokenFiles, loadTokens, validate, resolve, toCssValue, toPx, resolvedType } from './lib/tokens.mjs';
import { contrastResults, loadPairs } from './lib/contrast.mjs';
import { axeFiles } from './lib/a11y.mjs';
import { syncSkillMeta, splitFrontmatter } from './lib/skill-meta.mjs';
import { checkEvals } from './lib/evals.mjs';

const args = process.argv.slice(2);
const dirArg = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : null;
const TARGET = dirArg ? path.resolve(process.cwd(), dirArg) : ROOT;
if (dirArg && !fs.existsSync(TARGET)) {
  console.error(`--dir のパスがない: ${TARGET}`);
  process.exit(2);
}

const rel = (p) => path.relative(TARGET, p) || p;
const summary = [];
let failed = false;
function report(name, errors, note = '') {
  const ok = errors.length === 0;
  if (!ok) failed = true;
  summary.push({ name, ok, count: errors.length, note });
  console.log(`\n${ok ? '✔' : '✘'} ${name}${note ? `（${note}）` : ''}`);
  for (const e of errors.slice(0, 50)) console.log(`   - ${e}`);
  if (errors.length > 50) console.log(`   …ほか ${errors.length - 50} 件`);
}

const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'test-results', 'playwright-report', 'results']);
function walk(dir, pred, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, pred, out);
    else if (pred(p)) out.push(p);
  }
  return out;
}

// ---------- 1. スキル文書の制約
function checkMeta() {
  const errors = [];
  const skill = fs.readFileSync(path.join(ROOT, 'SKILL.md'), 'utf8');
  const { fm } = splitFrontmatter(skill);
  let meta = {};
  try {
    meta = parseYaml(fm.replace(/^---\n|---\n$/g, '')) ?? {};
  } catch (e) {
    errors.push(`SKILL.md の frontmatter が YAML として読めない: ${e.message}`);
  }
  if (!/^[a-z0-9-]{1,64}$/.test(meta.name ?? '')) errors.push('name は小文字・数字・ハイフンで64文字以内');
  if (/claude|anthropic/.test(meta.name ?? '')) errors.push('name に予約語（claude / anthropic）を含めない');
  const desc = String(meta.description ?? '');
  if (!desc || desc.length > 1024) errors.push(`description は1〜1024文字（現在 ${desc.length}）`);
  if (/<[^>]+>/.test(desc)) errors.push('description に XML タグを含めない');
  if (!syncSkillMeta({ write: false })) errors.push('SKILL.md の frontmatter が lumen.config.json と一致しない（npm run ds:build）');
  const lines = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n').length;
  if (lines('SKILL.md') >= 500) errors.push(`SKILL.md は500行未満（現在 ${lines('SKILL.md')}）`);
  if (lines('CLAUDE.md') >= 200) errors.push(`CLAUDE.md は200行未満（現在 ${lines('CLAUDE.md')}）`);

  // ブランド名は lumen.config.json だけに書く（生成物は除く）
  const allowed = new Set(['lumen.config.json']);
  const generated = (p) => /^(dist|preview|node_modules|test-results|playwright-report|\.git)\//.test(p) || p === 'design_system/DESIGN.md' || p.startsWith('evals/results/') || p.startsWith('tests/__screenshots__/') || p === 'package-lock.json';
  const files = walk(ROOT, (p) => /\.(md|json|mjs|js|jsx|css|html|yaml|yml|txt)$/.test(p));
  for (const f of files) {
    const r = path.relative(ROOT, f);
    if (allowed.has(r) || generated(r)) continue;
    let text = fs.readFileSync(f, 'utf8');
    if (r === 'SKILL.md') text = splitFrontmatter(text).body;
    if (text.includes(config.brandName)) errors.push(`${r}: ブランド名 "${config.brandName}" を直書きしている（lumen.config.json だけに書く。文書では「このデザインシステム」と書く）`);
  }
  errors.push(...checkEvals());
  return errors;
}

// ---------- 2. トークン
function checkTokens(dir) {
  const files = listTokenFiles(dir);
  if (!files.length) return { errors: [], sets: null, note: 'トークンなし' };
  const themeFiles = files.filter((f) => f.includes(`${path.sep}themes${path.sep}`));
  const baseFiles = files.filter((f) => !themeFiles.includes(f));
  const errors = [];
  const sets = { light: loadTokens(baseFiles) };
  for (const tf of themeFiles) sets[path.basename(tf, '.tokens.json')] = loadTokens([...baseFiles, tf]);
  for (const [name, s] of Object.entries(sets)) {
    errors.push(...s.errors.map((e) => `[${name}] ${e}`));
    errors.push(...validate(s.tokens).map((e) => `[${name}] ${e}`));
  }
  const light = sets.light.tokens;

  // テーマの完全性：semantic の color.* はすべてのテーマが上書きする（Carbon 方式）
  const semanticColors = [...light.values()].filter((t) => t.path.startsWith('color.')).map((t) => t.path);
  for (const tf of themeFiles) {
    const own = loadTokens([tf]).tokens;
    for (const p of semanticColors) if (!own.has(p)) errors.push(`${rel(tf)}: ${p} がない（テーマは semantic の色を全項目持つ）`);
    for (const p of own.keys()) if (!p.startsWith('color.')) errors.push(`${rel(tf)}: ${p} はテーマで上書きできない（color.* だけ）`);
  }

  // 固定値と下限（locked.json が正本）
  const locked = JSON.parse(fs.readFileSync(path.join(TOKENS_DIR, 'locked.json'), 'utf8'));
  for (const [name, s] of Object.entries(sets)) {
    for (const [p, want] of Object.entries(locked.values)) {
      const t = s.tokens.get(p);
      if (!t) {
        errors.push(`[${name}] 固定トークン ${p} がない`);
        continue;
      }
      const raw = t.value;
      const got = typeof raw === 'string' ? raw : toCssValue(raw, resolvedType(s.tokens, p));
      if (got.toLowerCase() !== want.toLowerCase()) errors.push(`[${name}] 固定値 ${p} が ${got}（固定値は ${want}。変えるには ADR とユーザーの承認が要る）`);
    }
  }
  for (const rule of locked.rules) {
    if (rule.ratio) continue;
    const targets = rule.token ? [rule.token] : [...light.keys()].filter((p) => p.startsWith(rule.group + '.'));
    for (const p of targets) {
      if (!light.has(p)) {
        errors.push(`${rule.id}: ${p} がない`);
        continue;
      }
      let v;
      try {
        v = resolve(light, p);
      } catch {
        continue;
      }
      const num = typeof v === 'number' ? v : toPx(v);
      const min = typeof rule.min === 'number' ? rule.min : parseFloat(rule.min);
      if (num < min) errors.push(`${rule.id}: ${p} = ${typeof v === 'number' ? v : toCssValue(v, 'dimension')}（下限 ${rule.min}）`);
    }
  }
  return { errors, sets, note: `${files.length} ファイル、${light.size} トークン、テーマ ${Object.keys(sets).join(' / ')}` };
}

// ---------- 3. トークン外の値
const STYLELINT_CONFIG = (await import(new URL('../stylelint.config.mjs', import.meta.url))).default;
const JSX_RULES = [
  { re: /class(Name)?=["'{`][^"'`}]*\b(bg|text|p[xytrbl]?|m[xytrbl]?|w|h|gap|rounded|flex|grid|border|font)-[a-z0-9[]/, msg: 'Tailwind 風のユーティリティクラス' },
  { re: /@tailwind|tailwindcss|@apply\b/, msg: 'Tailwind の使用' },
  { re: /style=\{\{[^}]*(#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(|\d+px)/, msg: 'style 属性への値の直書き' },
  { re: /from ['"](styled-components|@emotion\/[a-z]+)['"]|\.module\.css['"]/, msg: 'CSS-in-JS / CSS Modules の使用' },
];
export function scanJsx(code) {
  return JSX_RULES.filter((r) => r.re.test(code)).map((r) => r.msg);
}

async function lintCss(files, ignoreGenerated) {
  const errors = [];
  // ignoreFiles のグロブはリポジトリ外のファイルに効かないので、生成物はここで除く
  if (ignoreGenerated) files = files.filter((f) => path.basename(f) !== 'tokens.css' && !f.split(path.sep).includes('dist'));
  const cfg = { ...STYLELINT_CONFIG, ignoreFiles: ignoreGenerated ? [] : STYLELINT_CONFIG.ignoreFiles };
  if (!files.length) return errors;
  const r = await stylelint.lint({ files, config: cfg, configBasedir: ROOT });
  for (const res of r.results) for (const w of res.warnings) errors.push(`${rel(res.source)}:${w.line} ${w.text}`);
  return errors;
}

async function checkStyles(dir) {
  const errors = [];
  if (dir === ROOT) {
    const css = [...walk(path.join(ROOT, 'implementations'), (p) => p.endsWith('.css')), ...walk(path.join(ROOT, 'examples/good'), (p) => p.endsWith('.css'))];
    errors.push(...(await lintCss(css, false)));
    const jsx = [...walk(path.join(ROOT, 'implementations'), (p) => /\.(jsx|tsx)$/.test(p)), ...walk(path.join(ROOT, 'examples/good'), (p) => /\.(jsx|tsx)$/.test(p))];
    for (const f of jsx) for (const m of scanJsx(fs.readFileSync(f, 'utf8'))) errors.push(`${rel(f)}: ${m}`);
    // 自己テスト：examples/bad は必ず不合格になる
    for (const f of walk(path.join(ROOT, 'examples/bad'), () => true)) {
      const code = fs.readFileSync(f, 'utf8');
      let hits = 0;
      if (f.endsWith('.css')) hits = (await stylelint.lint({ code, config: { ...STYLELINT_CONFIG, ignoreFiles: [] } })).results[0].warnings.length;
      if (/\.(jsx|tsx)$/.test(f)) hits = scanJsx(code).length;
      if (/\.(css|jsx|tsx)$/.test(f) && hits === 0) errors.push(`自己テスト失敗：${rel(f)} が検出されない（検査の抜け穴）`);
    }
    return { errors, note: `CSS ${css.length}、JSX ${jsx.length}、bad の自己テストを含む` };
  }
  const css = walk(dir, (p) => p.endsWith('.css'));
  errors.push(...(await lintCss(css, true)));
  const jsx = walk(dir, (p) => /\.(jsx|tsx)$/.test(p));
  for (const f of jsx) for (const m of scanJsx(fs.readFileSync(f, 'utf8'))) errors.push(`${rel(f)}: ${m}`);
  return { errors, note: `CSS ${css.length}、JSX ${jsx.length}` };
}

// ---------- 4. コントラスト
function checkContrast(sets, dir) {
  if (!sets) return { errors: [], note: 'トークンがないので省略' };
  const rows = contrastResults(sets, loadPairs(dir === ROOT ? TOKENS_DIR : dir));
  const errors = rows.filter((r) => !r.pass).map((r) => `[${r.theme}] ${r.fg} × ${r.bg}: ${r.missing ?? `${r.ratio.toFixed(3)}:1（基準 ${r.min}:1）`}`);
  const worst = rows.filter((r) => r.pass).sort((a, b) => a.ratio / a.min - b.ratio / b.min)[0];
  return { errors, note: `${rows.length} ペア${worst ? `、最も余裕がないもの ${worst.fg} × ${worst.bg} [${worst.theme}] ${worst.ratio.toFixed(2)}:1` : ''}` };
}

// ---------- 5. 生成物の更新漏れ
function hashTree(paths) {
  const h = crypto.createHash('sha256');
  for (const p of paths.flatMap((x) => (fs.existsSync(x) && fs.statSync(x).isDirectory() ? walk(x, () => true) : [x])).sort()) {
    h.update(p);
    h.update(fs.existsSync(p) ? fs.readFileSync(p) : '');
  }
  return h.digest('hex');
}
function checkGenerated() {
  const gen = ['dist', 'preview', 'design_system/DESIGN.md', 'SKILL.md'].map((p) => path.join(ROOT, p));
  const before = hashTree(gen);
  execFileSync(process.execPath, [path.join(ROOT, 'scripts/build.mjs')], { cwd: ROOT, stdio: 'ignore' });
  const after = hashTree(gen);
  return before === after ? [] : ['生成物が正本と合っていなかった（ds:build で再生成した。差分を確認してコミットする）'];
}

// ---------- 6. axe
async function checkAxe(dir) {
  const html = dir === ROOT ? walk(path.join(ROOT, 'preview'), (p) => p.endsWith('.html')) : walk(dir, (p) => p.endsWith('.html'));
  const results = await axeFiles(html);
  const errors = [];
  for (const r of results) for (const v of r.violations) errors.push(`${rel(r.file)} [${r.scheme}] ${v.id}: ${v.help}（${v.nodes.length} 箇所）`);
  return { errors, note: `${html.length} ページ × prefers-color-scheme 2種` };
}

// ---------- 実行
console.log(`ds:check — 対象 ${dirArg ? rel(TARGET) : 'このリポジトリ'}`);
if (!dirArg) report('スキル文書の制約・ブランド名・evals の索引', checkMeta());
const tk = checkTokens(dirArg ? TARGET : TOKENS_DIR);
report('トークンの構文・固定値・下限・テーマの完全性', tk.errors, tk.note);
const st = await checkStyles(TARGET);
report('トークン外の値（stylelint / JSX）', st.errors, st.note);
const ct = checkContrast(tk.sets, TARGET);
report('コントラスト（WCAG 2.2 AA）', ct.errors, ct.note);
if (!dirArg) report('生成物の更新漏れ', checkGenerated());
const ax = await checkAxe(TARGET);
report('axe（wcag2a/aa, 21a/aa, 22aa）', ax.errors, ax.note);

console.log(`\n${failed ? '✘ 不合格' : '✔ すべて合格'}：${summary.map((s) => `${s.ok ? '✔' : '✘'}${s.name.split('（')[0]}`).join(' / ')}`);
process.exit(failed ? 1 : 0);
