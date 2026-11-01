import { readFileSync, writeFileSync } from "node:fs";
import { relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO_ROOT, SRC, tsFiles } from "./walk";

/**
 * 部品の形と書き方の決まり（`docs/rules/ts.md` の R-TSC と R-TSW）のうち、字面で判定できるものを見る。
 *
 * 正規表現でなく構文木で読む。JSX は属性の値に括弧と矢印が入るので、文字列では境界を取れない。
 *
 * `nestedComponent` は違反0なので `-D` で張る。残りは入れた時点で既存があるので件数ラチェット。
 * 基準を動かしてよい向きは下げる方だけで、片付けたら `BASELINE` を下げる。
 *
 * 環境変数 `SHAPE_REPORT` にパスを渡すと、該当の全行を JSON で書き出す。
 * `/tidy-code` の棚卸しはこの出力から範囲の行を拾う。
 */

const BASELINE = {
  arrowComponent: 2,
  typeInterface: 146,
  reactNamespace: 58,
  conditionalNull: 11,
  inlineHandlerBlock: 45,
  stateAfterEffect: 3,
  helperAfterComponent: 12,
  forwardRef: 3,
};

/** 走査が壊れて0件になったことを「違反が無い」と読ませないための下限。実測より大きく下に置く */
const MIN_FILES = 300;
const MIN_COMPONENTS = 150;

type Shape = keyof typeof BASELINE | "nestedComponent";

type Found = { shape: Shape; line: number };

function isComponentName(name: string | undefined): boolean {
  return name !== undefined && /^[A-Z]/.test(name);
}

function containsJsx(root: ts.Node): boolean {
  let found = false;
  const visit = (node: ts.Node): void => {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node) || ts.isJsxFragment(node)) {
      found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function isExported(node: ts.Declaration): boolean {
  return (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0;
}

/** `memo(...)` などに包まれた関数まで開く */
function unwrapFunction(node: ts.Expression | undefined): ts.Expression | undefined {
  if (node && ts.isCallExpression(node)) return node.arguments[0];
  return node;
}

function callee(node: ts.CallExpression, source: ts.SourceFile): string {
  return node.expression.getText(source);
}

/** 本体の直下の文に出る hook の呼び出しを順に読む。入れ子の関数の中は別の部品の話なので見ない */
function topLevelHooks(body: ts.Block, source: ts.SourceFile): string[] {
  const hooks: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isFunctionLike(node)) return;
    if (ts.isCallExpression(node)) {
      const name = callee(node, source);
      if (/^use[A-Z]/.test(name)) hooks.push(name);
    }
    ts.forEachChild(node, visit);
  };
  body.statements.forEach(visit);
  return hooks;
}

function hasStateAfterEffect(hooks: string[]): boolean {
  const firstEffect = hooks.findIndex((hook) => hook === "useEffect");
  if (firstEffect < 0) return false;
  return hooks.slice(firstEffect).some((hook) => hook === "useState" || hook === "useReducer");
}

function isInsideFunction(node: ts.Node): boolean {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isFunctionLike(at)) return true;
  }
  return false;
}

function isAmbientBlock(node: ts.Node): boolean {
  for (let at = node.parent; at !== undefined; at = at.parent) {
    if (ts.isModuleDeclaration(at)) return true;
  }
  return false;
}

/** 1つのファイルから、見ている形の出現を全部拾う */
function shapesIn(file: string, body: string): { found: Found[]; components: number } {
  const kind = file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const source = ts.createSourceFile(file, body, ts.ScriptTarget.Latest, true, kind);
  const found: Found[] = [];
  let components = 0;
  const add = (shape: Shape, node: ts.Node): void => {
    found.push({ shape, line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1 });
  };

  const visitComponent = (node: ts.Node, fn: ts.FunctionLikeDeclaration): void => {
    components += 1;
    if (isInsideFunction(node)) add("nestedComponent", node);
    if (fn.body && ts.isBlock(fn.body) && hasStateAfterEffect(topLevelHooks(fn.body, source))) {
      add("stateAfterEffect", node);
    }
  };

  const visit = (node: ts.Node): void => {
    if (ts.isFunctionDeclaration(node) && isComponentName(node.name?.text) && containsJsx(node)) {
      visitComponent(node, node);
    }
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      isComponentName(node.name.text)
    ) {
      const fn = unwrapFunction(node.initializer);
      if (fn && (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) && containsJsx(fn)) {
        visitComponent(node, fn);
        if (ts.isArrowFunction(fn)) add("arrowComponent", node);
      }
    }
    if (ts.isInterfaceDeclaration(node) && !isAmbientBlock(node)) add("typeInterface", node);
    if (
      ts.isTypeReferenceNode(node) &&
      ts.isQualifiedName(node.typeName) &&
      node.typeName.left.getText(source) === "React"
    ) {
      add("reactNamespace", node);
    }
    if (
      ts.isImportDeclaration(node) &&
      node.importClause?.name &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === "react"
    ) {
      add("reactNamespace", node);
    }
    if (ts.isJsxExpression(node) && node.expression && ts.isConditionalExpression(node.expression)) {
      const { whenTrue, whenFalse } = node.expression;
      if (
        whenTrue.kind === ts.SyntaxKind.NullKeyword ||
        whenFalse.kind === ts.SyntaxKind.NullKeyword
      ) {
        add("conditionalNull", node);
      }
    }
    if (ts.isJsxAttribute(node) && /^on[A-Z]/.test(node.name.getText(source))) {
      const value = node.initializer;
      const handler = value && ts.isJsxExpression(value) ? value.expression : undefined;
      if (
        handler &&
        ts.isArrowFunction(handler) &&
        ts.isBlock(handler.body) &&
        handler.body.statements.length >= 2
      ) {
        add("inlineHandlerBlock", node);
      }
    }
    if (ts.isCallExpression(node) && /(^|\.)forwardRef$/.test(callee(node, source))) {
      add("forwardRef", node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  const firstComponent = source.statements.findIndex(
    (statement) =>
      ts.isFunctionDeclaration(statement) &&
      isExported(statement) &&
      isComponentName(statement.name?.text),
  );
  if (firstComponent >= 0) {
    for (const statement of source.statements.slice(firstComponent + 1)) {
      if (ts.isFunctionDeclaration(statement) && !isExported(statement)) {
        add("helperAfterComponent", statement);
      }
    }
  }
  return { found, components };
}

function scan() {
  const byShape = new Map<Shape, string[]>();
  let files = 0;
  let components = 0;
  for (const file of tsFiles(SRC, { includeTests: false })) {
    if (file.endsWith(".d.ts") || file.includes(".test.")) continue;
    files += 1;
    const name = relative(REPO_ROOT, file);
    const result = shapesIn(name, readFileSync(file, "utf8"));
    components += result.components;
    for (const { shape, line } of result.found) {
      byShape.set(shape, [...(byShape.get(shape) ?? []), `${name}:${line}`]);
    }
  }
  return { byShape, files, components };
}

const shapesOf = (source: string): Shape[] =>
  shapesIn("sample.tsx", source).found.map(({ shape }) => shape);

describe("走査の部品", () => {
  it("部品の中で定義した部品を拾う", () => {
    const source = `function A() { function B() { return <i />; } return <B />; }`;
    expect(shapesOf(source)).toEqual(["nestedComponent"]);
  });

  it("部品の中の大文字の値を部品と読まない", () => {
    expect(shapesOf(`function A() { const Icon = pick(); return <Icon />; }`)).toEqual([]);
  });

  it("矢印の部品を拾い、memo の中の function は拾わない", () => {
    expect(shapesOf(`const A = () => <i />;`)).toEqual(["arrowComponent"]);
    expect(shapesOf(`const A = memo(() => <i />);`)).toEqual(["arrowComponent"]);
    expect(shapesOf(`const A = memo(function A() { return <i />; });`)).toEqual([]);
  });

  it("interface を拾い、declare の中は拾わない", () => {
    expect(shapesOf(`interface A { a: 1 }`)).toEqual(["typeInterface"]);
    expect(shapesOf(`declare global { interface Window { a: 1 } }`)).toEqual([]);
  });

  it("React の名前空間の型と既定の import を拾う", () => {
    expect(shapesOf(`type A = React.ReactNode;`)).toEqual(["reactNamespace"]);
    expect(shapesOf(`import React from "react";`)).toEqual(["reactNamespace"]);
    expect(shapesOf(`import { useState } from "react";`)).toEqual([]);
  });

  it("片方が null の三項を拾い、両方が要素の三項は拾わない", () => {
    expect(shapesOf(`const a = <p>{x ? <i /> : null}</p>;`)).toEqual(["conditionalNull"]);
    expect(shapesOf(`const a = <p>{x ? null : <i />}</p>;`)).toEqual(["conditionalNull"]);
    expect(shapesOf(`const a = <p>{x ? <i /> : <b />}</p>;`)).toEqual([]);
  });

  it("2文以上のその場のハンドラを拾い、1文は拾わない", () => {
    expect(shapesOf(`const a = <p onClick={() => { f(); g(); }} />;`)).toEqual([
      "inlineHandlerBlock",
    ]);
    expect(shapesOf(`const a = <p onClick={() => { f(); }} />;`)).toEqual([]);
    expect(shapesOf(`const a = <p onClick={() => f()} />;`)).toEqual([]);
  });

  it("effect より後の state を拾い、effect の中の関数は見ない", () => {
    const after = `function A() { useEffect(f); const [a] = useState(0); return <i />; }`;
    expect(shapesOf(after)).toEqual(["stateAfterEffect"]);
    const before = `function A() { const [a] = useState(0); useEffect(f); return <i />; }`;
    expect(shapesOf(before)).toEqual([]);
  });

  it("export した部品より後の非公開の関数を拾う", () => {
    const source = `export function A() { return <i />; }\nfunction helper() {}`;
    expect(shapesOf(source)).toEqual(["helperAfterComponent"]);
    expect(shapesOf(`function helper() {}\nexport function A() { return <i />; }`)).toEqual([]);
  });

  it("forwardRef を綴りを問わず拾う", () => {
    expect(shapesOf(`const a = forwardRef(f);`)).toEqual(["forwardRef"]);
    expect(shapesOf(`const a = React.forwardRef(f);`)).toEqual(["forwardRef"]);
  });
});

describe("部品の形と書き方", () => {
  const { byShape, files, components } = scan();

  it("求められたら該当の全行を書き出す", () => {
    const destination = process.env.SHAPE_REPORT;
    if (destination) writeFileSync(destination, JSON.stringify(Object.fromEntries(byShape), null, 2));
    expect(byShape.size).toBeGreaterThan(0);
  });

  it("走査が空振りしていない", () => {
    expect(files).toBeGreaterThan(MIN_FILES);
    expect(components).toBeGreaterThan(MIN_COMPONENTS);
  });

  it("部品の中で部品を定義しない", () => {
    expect(
      byShape.get("nestedComponent") ?? [],
      "親が描くたびに別の部品になり、下の state が捨てられる。ファイルの直下へ出す",
    ).toEqual([]);
  });

  it.each([
    ["arrowComponent", "部品は function で宣言する（R-TSW-1）"],
    ["typeInterface", "オブジェクトの形は type で書く（R-TSW-2）"],
    ["reactNamespace", 'React の型は import type { ReactNode } from "react" で読む（R-TSW-3）'],
    ["conditionalNull", "片方が null なら && で書く（R-TSW-6）"],
    ["inlineHandlerBlock", "2文以上のハンドラは名前を付けて JSX の外に置く（R-TSW-5）"],
    ["stateAfterEffect", "state は effect より前に置く（R-TSW-4）"],
    ["helperAfterComponent", "補助の関数は部品より前に置く（R-TSW-7）"],
    ["forwardRef", "ref は props で受ける（R-TSW-8）"],
  ] as const)("%s が基準を超えない", (shape, advice) => {
    const lines = byShape.get(shape) ?? [];
    expect(lines.length, `${advice}\n${lines.join("\n")}`).toBeLessThanOrEqual(BASELINE[shape]);
  });
});
