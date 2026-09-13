#!/usr/bin/env node
// 配布物に載る第三者のソフトウェアの帰属表示を `THIRD-PARTY-NOTICES.md` に生成する。
//
// 同梱している書体は OFL-1.1 で、改変の有無にかかわらず配布時に著作権表示と
// ライセンス本文の同梱を求める。MIT / BSD / ISC の依存も著作権表示の同梱を条件にしている。
// `.woff2` の実体は `dist/assets/` に入り、`dist` は `tauri.conf.json` の `frontendDist` なので、
// Releases で配る全 OS のバイナリに載る。
//
// **手で `THIRD-PARTY-NOTICES.md` を編集しない。** `--check` が差分で落とす。
//
// 使い方:
//   node scripts/generate-third-party-notices.mjs          書き出す
//   node scripts/generate-third-party-notices.mjs --check   現物と一致するかだけ見る

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const noticesPath = join(repoRoot, "THIRD-PARTY-NOTICES.md");
const licenseTextsDir = join(repoRoot, "scripts", "license-texts");

/** 著作権表示を探しにいくファイル名。先に当たったものを1つだけ読む。 */
const LICENSE_FILE_PATTERN = /^(licen[cs]e|copying|notice)(\..*)?$/i;

// ---------------------------------------------------------------------------
// 収集
// ---------------------------------------------------------------------------

/**
 * `OR` で選べるときに優先する順。
 *
 * 載せる本文を1つに絞るためだけの順で、依存の側に優劣は無い。
 * ここに無い識別子しか無い式は、符号位置の順で最初のものを選ぶ。
 */
const LICENSE_PREFERENCE = [
  "MIT",
  "Apache-2.0",
  "ISC",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "Zlib",
  "0BSD",
  "MIT-0",
  "Unlicense",
  "CC0-1.0",
];

/** SPDX 式を語に割る。`MIT/Apache-2.0` のような旧い綴りも `OR` として割れる。 */
function licenseAtomsOf(expression) {
  return expression
    .split(/[()\s/]+|\bOR\b|\bAND\b|\bWITH\b/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

/**
 * SPDX 式から、本文を載せる識別子を決める。
 *
 * `AND` も括弧も無い式は `OR` の並びなので、配布する側が1つ選べる —— `LICENSE_PREFERENCE`
 * で選ぶ。`r-efi` の `MIT OR Apache-2.0 OR LGPL-2.1-or-later` はこれで MIT になる。
 * 選ばずに全部載せると、選ばなかった LGPL の本文まで配布物に載り、
 * 「LGPL のコードを配っている」と読める通知になる。
 *
 * `AND` や括弧がある式は、どれが必須かの判定に式の構造の解釈が要る。
 * **そこは解釈せず、出てきた識別子を全部載せる** —— 足りている側に倒す。
 */
function licenseIdsOf(expression) {
  if (!expression) return [];
  const atoms = licenseAtomsOf(expression);
  if (/\bAND\b|[()]/.test(expression)) return atoms;

  for (const preferred of LICENSE_PREFERENCE) {
    if (atoms.includes(preferred)) return [preferred];
  }
  return atoms.length > 0 ? [[...atoms].sort()[0]] : [];
}

/**
 * ライセンス本文から著作権表示だけを取り出す。
 *
 * **行で切るだけでは足りない。** `@fontsource/lato` の `LICENSE` は同じ通知を
 * 書体ファイルの数だけ1行に並べており、行で引くと1セルが1000字を超える。
 * `Copyright` の手前でも切り、`Copyright` より前を捨ててから重複を畳むと、
 * 同じ権利者の繰り返しが1件になる。
 *
 * 末尾が `:` で終わる語は次の通知に付く見出し（`Lato-Bold.ttf:`）なので落とす。
 * これが残ると、同じ通知が見出しの違いだけで別物として並ぶ。
 *
 * **文の切れ目では切らない。** `Copyright (c) Meta Platforms, Inc. and affiliates.` は
 * `Inc.` の後ろで切れ、権利者が `Meta Platforms, Inc.` に縮む ——
 * 縮めてよいかを決められるのは権利者だけで、この走査ではない。
 */
function copyrightNoticesOf(text) {
  const notices = [];
  for (const chunk of text.split(/\r?\n|(?=\bCopyright\b)/i)) {
    const at = chunk.search(/\bcopyright\b/i);
    if (at < 0) continue;
    const notice = chunk
      .slice(at)
      .trim()
      .replace(/\s*\S+:\s*$/, "");
    // ライセンス本文そのものが説明として書く "copyright" は著作権表示ではない。
    // 年か "(c)" を伴うものだけを引く。
    if (!/\(c\)|©|\b(19|20)\d{2}\b/i.test(notice)) continue;
    if (!notices.includes(notice)) notices.push(notice);
    if (notices.length >= 3) break;
  }
  return notices;
}

/**
 * パッケージのディレクトリから著作権表示を拾う。
 *
 * 綴りは配布元ごとに違うので、`LICENSE` 系のファイルを名前の順に見て、
 * 最初に著作権表示が取れたものを採る。見つからなければ空を返し、
 * 呼び手が `package.json` の作者名などへ落とす。
 */
function copyrightLinesFrom(packageDir) {
  // 同じ crate を配布ターゲットの数だけ引くので、読んだものは覚えておく。
  const cached = copyrightCache.get(packageDir);
  if (cached) return cached;
  const notices = readCopyrightLinesFrom(packageDir);
  copyrightCache.set(packageDir, notices);
  return notices;
}

const copyrightCache = new Map();

function readCopyrightLinesFrom(packageDir) {
  if (!existsSync(packageDir)) return [];
  let entries;
  try {
    entries = readdirSync(packageDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isFile() && LICENSE_FILE_PATTERN.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  for (const name of candidates) {
    let text;
    try {
      text = readFileSync(join(packageDir, name), "utf8");
    } catch {
      continue;
    }
    const notices = copyrightNoticesOf(text);
    if (notices.length > 0) return notices;
  }
  return [];
}

/**
 * 入るかが走らせた機械で変わる npm パッケージ。`名前@版` で持つ。
 *
 * ネイティブの prebuilt は OS と CPU ごとに別のパッケージに分かれており
 * （`@parcel/watcher-darwin-arm64` と `@parcel/watcher-linux-x64-glibc` など）、
 * `npm ci` はその機械に合う1つだけを入れる。**入っているものを数えると、
 * 表の中身が生成した機械に依存する** —— macOS で生成した表は ubuntu のランナーで
 * 必ず落ちる。`SHIPPED_TARGETS` を綴りで固定しているのと同じ理由で、ここも
 * ホストに解かせない。
 *
 * 出典は `package-lock.json`。入れなかった分も含めて全ターゲットのパッケージを持ち、
 * `os` / `cpu` / `libc` でどの機械に入るかを書いている。
 *
 * **落としても通知は足りている。** 配布物に載る npm のコードは `dist` に取り込まれた
 * JS / CSS / 書体だけで（`dist` は `tauri.conf.json` の `frontendDist`）、
 * ここで落とす prebuilt はビルドする機械で走るだけ。
 */
function hostDependentPackages() {
  const lock = JSON.parse(readFileSync(join(repoRoot, "package-lock.json"), "utf8"));
  const keys = new Set();
  for (const [location, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry.os && !entry.cpu && !entry.libc) continue;
    const name = location.slice(location.lastIndexOf("node_modules/") + "node_modules/".length);
    keys.add(`${name}@${entry.version}`);
  }
  return keys;
}

/** 配布物に載る npm パッケージ。`npm ci` が入れた木をそのまま数える。 */
function collectNpmPackages() {
  const raw = execFileSync("npm", ["query", ".prod", "--json"], {
    cwd: repoRoot,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const nodes = JSON.parse(raw);
  const hostDependent = hostDependentPackages();

  const packages = [];
  for (const node of nodes) {
    // 木の根は ObsShogi 自身。自分の MIT は `LICENSE.md` が持つ。
    if (!node.location) continue;
    if (hostDependent.has(`${node.name}@${node.version}`)) continue;
    packages.push({
      name: node.name,
      version: node.version,
      license: normalizeLicenseField(node.license),
      copyright: copyrightLinesFrom(node.path),
      author: authorNameOf(node.author),
    });
  }
  return sortByNameVersion(packages);
}

/** `license` は文字列のこともオブジェクト（旧形式）のこともある。 */
function normalizeLicenseField(license) {
  if (typeof license === "string") return license;
  if (license && typeof license.type === "string") return license.type;
  return "";
}

function authorNameOf(author) {
  if (typeof author === "string") return author;
  if (author && typeof author.name === "string") return author.name;
  return "";
}

/**
 * バイナリを配っているターゲット。`.github/workflows/release.yml` の matrix と対で、
 * 空の `rust_target` はランナーのホストになる。
 *
 * **ホストのターゲットで解かない。** 解が生成した OS に依存すると、
 * 生成物も OS ごとに変わり、ラチェットが別の OS で必ず落ちる。
 * 綴りで固定すれば、どこで生成しても同じ解になる。
 */
const SHIPPED_TARGETS = [
  "aarch64-apple-darwin",
  "x86_64-apple-darwin",
  "x86_64-pc-windows-msvc",
  "x86_64-unknown-linux-gnu",
];

/** 配布物に載る crate。ターゲットごとに解いて和を取る。 */
function collectCargoPackages() {
  const found = new Map();
  for (const target of SHIPPED_TARGETS) {
    for (const pkg of cargoPackagesFor(target)) {
      // 同じ crate の同じ版は、どのターゲットで拾っても同じ表示になる。
      found.set(`${pkg.name}@${pkg.version}`, pkg);
    }
  }
  return sortByNameVersion([...found.values()]);
}

function cargoPackagesFor(target) {
  const raw = execFileSync(
    "cargo",
    ["metadata", "--format-version", "1", "--locked", "--filter-platform", target],
    {
      cwd: join(repoRoot, "src-tauri"),
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    },
  );
  const metadata = JSON.parse(raw);

  const byId = new Map(metadata.packages.map((pkg) => [pkg.id, pkg]));
  const nodesById = new Map(metadata.resolve.nodes.map((node) => [node.id, node]));
  const workspace = new Set(metadata.workspace_members);

  // dev-dependencies はバイナリに入らないので辿らない。build-dependencies は
  // 生成物を焼き込むことがあるので、足りている側に倒して辿る。
  const reachable = new Set();
  const queue = [...workspace];
  while (queue.length > 0) {
    const id = queue.pop();
    const node = nodesById.get(id);
    if (!node) continue;
    for (const dep of node.deps) {
      const kinds = dep.dep_kinds ?? [];
      const shipped = kinds.length === 0 || kinds.some((k) => k.kind !== "dev");
      if (!shipped || reachable.has(dep.pkg)) continue;
      reachable.add(dep.pkg);
      queue.push(dep.pkg);
    }
  }

  const packages = [];
  for (const id of reachable) {
    // ワークスペースの crate は ObsShogi 自身。
    if (workspace.has(id)) continue;
    const pkg = byId.get(id);
    if (!pkg) continue;
    packages.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license ?? "",
      copyright: copyrightLinesFrom(dirname(pkg.manifest_path)),
      author: (pkg.authors ?? []).join(", "),
    });
  }
  return packages;
}

/** 生成物の並びが環境の既定ロケールで変わらないよう、符号位置で比べる。 */
function sortByNameVersion(packages) {
  return packages.sort((a, b) => {
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    if (a.version !== b.version) return a.version < b.version ? -1 : 1;
    return 0;
  });
}

// ---------------------------------------------------------------------------
// 整形
// ---------------------------------------------------------------------------

function escapeCell(text) {
  return text.replaceAll("\\", "\\\\").replaceAll("|", "\\|");
}

function attributionOf(pkg) {
  if (pkg.copyright.length > 0) return pkg.copyright.map(escapeCell).join("<br>");
  if (pkg.author) return escapeCell(pkg.author);
  return "—";
}

function renderTable(packages) {
  const rows = packages.map(
    (pkg) =>
      `| ${escapeCell(pkg.name)} | ${escapeCell(pkg.version)} | ${
        escapeCell(pkg.license) || "—"
      } | ${attributionOf(pkg)} |`,
  );
  return [
    "| パッケージ | 版 | ライセンス | 著作権表示 |",
    "| --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function renderFonts(npmPackages) {
  const fonts = npmPackages.filter((pkg) => pkg.name.startsWith("@fontsource/"));
  const lines = [];
  for (const font of fonts) {
    const attribution =
      font.copyright.length > 0 ? font.copyright : ["（著作権表示が見つからない）"];
    lines.push(`- **${font.name}** ${font.version} — ${font.license || "—"}`);
    for (const line of attribution) lines.push(`  - ${line}`);
  }
  return lines.join("\n");
}

/**
 * 出てきた識別子の本文を1つずつ載せる。
 *
 * **本文が無い識別子が出たら落とす。** 黙って飛ばすと、新しいライセンスの依存が
 * 入った回に限って本文が欠けた通知を配ることになる ——
 * 通知が足りていない状態こそ、この生成器が止めたいもの。
 */
function renderLicenseTexts(ids) {
  const sections = [];
  const missing = [];
  for (const id of ids) {
    const path = join(licenseTextsDir, `${id}.txt`);
    if (!existsSync(path)) {
      missing.push(id);
      continue;
    }
    sections.push(`### ${id}\n\n\`\`\`\n${readFileSync(path, "utf8").trimEnd()}\n\`\`\``);
  }
  if (missing.length > 0) {
    throw new Error(
      `ライセンス本文が無い識別子がある: ${missing.join(", ")}\n` +
        `本文を scripts/license-texts/<識別子>.txt に置くこと。`,
    );
  }

  // どの依存も使っていない本文が残っていると、置いた当時の依存を指したまま古びる。
  const stale = readdirSync(licenseTextsDir)
    .filter((name) => name.endsWith(".txt"))
    .map((name) => name.slice(0, -".txt".length))
    .filter((id) => !ids.includes(id));
  if (stale.length > 0) {
    throw new Error(
      `どの依存も使っていないライセンス本文がある: ${stale.join(", ")}\n` +
        `scripts/license-texts/ から消すこと。`,
    );
  }
  return sections.join("\n\n");
}

function render(npmPackages, cargoPackages) {
  const ids = new Set();
  for (const pkg of [...npmPackages, ...cargoPackages]) {
    for (const id of licenseIdsOf(pkg.license)) ids.add(id);
  }
  const sortedIds = [...ids].sort();

  return `${[
    "# サードパーティのライセンス表示",
    "",
    "**このファイルは生成物。手で編集しない。**",
    "`node scripts/generate-third-party-notices.mjs` が作り、`npm run ratchet:notices` が差分で落とす。",
    "",
    "ObsShogi 自身のライセンスは [LICENSE.md](LICENSE.md)（MIT）。",
    "配布しているバイナリには、以下のソフトウェアが含まれる。",
    "",
    "## 同梱している書体",
    "",
    "次の書体は `.woff2` の実体が配布物に載る。",
    "",
    renderFonts(npmPackages),
    "",
    `## npm の依存（${npmPackages.length} 件）`,
    "",
    "`npm query .prod` が返す、配布物に載る依存。開発だけで使うものは含まない。",
    "`os` / `cpu` / `libc` で入るかが変わるパッケージ（ネイティブの prebuilt）も含まない ——",
    "入る1つが生成した機械で変わるうえ、配布物に載る npm のコードは `dist` に取り込まれた",
    "JS / CSS / 書体だけで、prebuilt はビルドする機械で走るだけだから。",
    "",
    renderTable(npmPackages),
    "",
    `## Rust の依存（${cargoPackages.length} 件）`,
    "",
    "`cargo metadata` の解決結果のうち、dev-dependencies を除いたもの。",
    `配っている ${SHIPPED_TARGETS.length} ターゲット分の和なので、1つの OS のバイナリには載らないものも含む。`,
    "",
    renderTable(cargoPackages),
    "",
    "## ライセンス本文",
    "",
    "`OR` で複数から選べる依存は、次の優先順で1つを選び、選んだものの本文だけを載せている:",
    `${LICENSE_PREFERENCE.join(" > ")}。`,
    "`AND` や括弧を含む式は解釈せず、出てくる識別子の本文を全部載せている。",
    "本文が言う「上記の著作権表示」は、上の表の「著作権表示」欄を指す。",
    "",
    renderLicenseTexts(sortedIds),
  ].join("\n")}\n`;
}

// ---------------------------------------------------------------------------

const check = process.argv.includes("--check");
const generated = render(collectNpmPackages(), collectCargoPackages());

if (!check) {
  writeFileSync(noticesPath, generated);
  process.stdout.write(`THIRD-PARTY-NOTICES.md を書き出した\n`);
} else if (!existsSync(noticesPath) || readFileSync(noticesPath, "utf8") !== generated) {
  process.stderr.write(
    "THIRD-PARTY-NOTICES.md が依存と一致しない。\n" +
      "`node scripts/generate-third-party-notices.mjs` を走らせて差分をコミットすること。\n",
  );
  process.exit(1);
} else {
  process.stdout.write("THIRD-PARTY-NOTICES.md は依存と一致している\n");
}
