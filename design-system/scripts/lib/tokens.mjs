// DTCG 2025.10 のトークンを読み、平坦化・型の継承・参照解決・構文検査をする。
// Style Dictionary は綴り違い（$valeu など）を黙って無視するため、構文検査はここで行う。
import fs from 'node:fs';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
export const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'lumen.config.json'), 'utf8'));
export const TOKENS_DIR = path.join(ROOT, 'design_system/tokens');

const KNOWN_TYPES = new Set([
  'color', 'dimension', 'fontFamily', 'fontWeight', 'duration', 'cubicBezier', 'number',
  'strokeStyle', 'border', 'transition', 'shadow', 'gradient', 'typography',
]);
const GROUP_KEYS = new Set(['$type', '$description', '$extensions', '$deprecated', '$extends', '$schema']);
const TOKEN_KEYS = new Set(['$value', '$type', '$description', '$extensions', '$deprecated']);
const ALIAS = /^\{([^{}]+)\}$/;

export function listTokenFiles(dir) {
  const out = [];
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.tokens.json')) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

/** files → Map(path → {path, value, type, description, extensions, file}) と errors */
export function loadTokens(files) {
  const tokens = new Map();
  const errors = [];
  for (const file of files) {
    let json;
    try {
      json = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (e) {
      errors.push(`${rel(file)}: JSON として読めない (${e.message})`);
      continue;
    }
    walkGroup(json, [], undefined, file, tokens, errors);
  }
  return { tokens, errors };
}

function walkGroup(node, trail, inheritedType, file, tokens, errors) {
  const type = node.$type ?? inheritedType;
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$')) {
      if (!GROUP_KEYS.has(key)) errors.push(`${rel(file)}: ${[...trail, key].join('.')} は未知の予約キー`);
      continue;
    }
    if (/[{}.]/.test(key)) errors.push(`${rel(file)}: 名前 "${key}" に { } . は使えない`);
    if (child === null || typeof child !== 'object' || Array.isArray(child)) {
      errors.push(`${rel(file)}: ${[...trail, key].join('.')} はトークンでもグループでもない`);
      continue;
    }
    const p = [...trail, key];
    if ('$value' in child) {
      for (const k of Object.keys(child)) {
        if (k.startsWith('$') && !TOKEN_KEYS.has(k)) errors.push(`${rel(file)}: ${p.join('.')} の未知のキー ${k}`);
        if (!k.startsWith('$')) errors.push(`${rel(file)}: ${p.join('.')} はトークンなのに子 "${k}" を持つ`);
      }
      const t = child.$type ?? type;
      tokens.set(p.join('.'), {
        path: p.join('.'),
        value: child.$value,
        type: t,
        description: child.$description,
        extensions: child.$extensions,
        file,
      });
    } else {
      for (const k of Object.keys(child)) {
        if (k === '$valeu' || k === 'value' || k === 'type') errors.push(`${rel(file)}: ${p.join('.')} に "${k}"（$value / $type の書き誤り？）`);
      }
      walkGroup(child, p, type, file, tokens, errors);
    }
  }
}

export function isAlias(v) {
  return typeof v === 'string' && ALIAS.test(v);
}

/** 参照を解決した値を返す。循環・参照切れは throw */
export function resolve(tokens, p, seen = []) {
  const t = tokens.get(p);
  if (!t) throw new Error(`参照切れ: {${p}}${seen.length ? `（${seen.join(' → ')} から）` : ''}`);
  if (seen.includes(p)) throw new Error(`循環参照: ${[...seen, p].join(' → ')}`);
  if (isAlias(t.value)) return resolve(tokens, t.value.match(ALIAS)[1], [...seen, p]);
  return t.value;
}

export function resolvedType(tokens, p, seen = []) {
  const t = tokens.get(p);
  if (t?.type) return t.type;
  if (t && isAlias(t.value) && !seen.includes(p)) return resolvedType(tokens, t.value.match(ALIAS)[1], [...seen, p]);
  return undefined;
}

/** 型ごとの値の形を検査する */
export function validate(tokens) {
  const errors = [];
  for (const t of tokens.values()) {
    const where = `${rel(t.file)}: ${t.path}`;
    let v;
    try {
      v = resolve(tokens, t.path);
    } catch (e) {
      errors.push(`${where}: ${e.message}`);
      continue;
    }
    const type = t.type ?? resolvedType(tokens, t.path);
    if (!type) {
      errors.push(`${where}: $type がない（トークンにもグループにも）`);
      continue;
    }
    if (!KNOWN_TYPES.has(type)) errors.push(`${where}: 未知の $type "${type}"`);
    if (!t.description) errors.push(`${where}: $description がない（仮の値は「仮」と書く）`);
    if (type === 'color' && !isColor(v)) errors.push(`${where}: color は {colorSpace, components[, hex]} の形にする`);
    if (type === 'dimension' && !isDimension(v)) errors.push(`${where}: dimension は {value:number, unit:"px"|"rem"} の形にする`);
    if (type === 'fontWeight' && !(typeof v === 'number' && v >= 1 && v <= 1000)) errors.push(`${where}: fontWeight は 1〜1000 の数`);
    if (type === 'number' && typeof v !== 'number') errors.push(`${where}: number は数値`);
    if (type === 'fontFamily' && !(typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string')))) errors.push(`${where}: fontFamily は文字列か文字列の配列`);
  }
  return errors;
}

function isColor(v) {
  return v && typeof v === 'object' && typeof v.colorSpace === 'string' && Array.isArray(v.components) && v.components.length === 3;
}
function isDimension(v) {
  return v && typeof v === 'object' && typeof v.value === 'number' && (v.unit === 'px' || v.unit === 'rem');
}

export function toCssValue(v, type) {
  if (type === 'color') return (v.hex ?? srgbToHex(v.components)).toLowerCase();
  if (type === 'dimension') return `${v.value}${v.unit}`;
  if (type === 'fontFamily') return Array.isArray(v) ? v.join(', ') : v;
  return String(v);
}

export function toPx(v) {
  return v.unit === 'rem' ? v.value * 16 : v.value;
}

function srgbToHex(c) {
  return '#' + c.map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function rel(p) {
  return path.relative(process.cwd(), p) || p;
}

/** テーマごとのトークン集合（dark は semantic の color.* を上書き） */
export function themeSets(dir = TOKENS_DIR) {
  const all = listTokenFiles(dir);
  const themeFiles = all.filter((f) => f.includes(`${path.sep}themes${path.sep}`));
  const baseFiles = all.filter((f) => !themeFiles.includes(f));
  const sets = { light: loadTokens(baseFiles) };
  for (const tf of themeFiles) {
    const name = path.basename(tf, '.tokens.json');
    sets[name] = loadTokens([...baseFiles, tf]);
  }
  return { sets, baseFiles, themeFiles };
}
