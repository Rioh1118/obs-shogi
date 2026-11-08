---
version: alpha
name: Lumen
description: Lumen design system — 構造のみ。値はすべて仮（brief 未記入）。
colors:
  text-default: "#212121"
  text-subtle: "#616161"
  text-inverse: "#ffffff"
  background-default: "#ffffff"
  background-subtle: "#f5f5f5"
  background-emphasis: "#212121"
  border-default: "#757575"
  primary: "{colors.background-emphasis}"
  dark-text-default: "#f5f5f5"
  dark-text-subtle: "#bdbdbd"
  dark-text-inverse: "#212121"
  dark-background-default: "#212121"
  dark-background-subtle: "#424242"
  dark-background-emphasis: "#f5f5f5"
  dark-border-default: "#9e9e9e"
  focus-ring-inner: "#ffffff"
  focus-ring-outer: "#000000"
typography:
  body:
    fontFamily: system-ui, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  caption:
    fontFamily: system-ui, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  heading-lg:
    fontFamily: system-ui, sans-serif
    fontSize: 20px
    fontWeight: 700
    lineHeight: 1.3
  heading-xl:
    fontFamily: system-ui, sans-serif
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
rounded:
  none: 0px
  sm: 4px
  full: 9999px
spacing:
  "0": 0px
  "100": 8px
  "150": 12px
  "200": 16px
  "300": 24px
  "400": 32px
  "050": 4px
components:
  button-primary:
    backgroundColor: "{colors.background-emphasis}"
    textColor: "{colors.text-inverse}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    typography: "{typography.body}"
  button-secondary:
    backgroundColor: "{colors.background-default}"
    textColor: "{colors.text-default}"
    rounded: "{rounded.sm}"
    padding: 8px 16px
    typography: "{typography.body}"
---

<!-- 生成物。手で編集しない。正本は design_system/tokens/*.tokens.json と principles.md。npm run ds:build で再生成する。 -->

# Lumen Design System

## Overview

状態：v0.0.0。器だけを作った段階で、色・書体・密度などの値はすべて仮（グレーの階調と OS 標準書体）。性格と雰囲気は brief.md を書いたあと、SKILL.md のモード B で決める。

原則は未定（design_system/principles.md）。

## Colors

色は「何に使うか」の名前（意味付けトークン）だけを使う。`primary` は仮に `background-emphasis`（主要な操作の背景）を指している。主色は未定。dark テーマの値は `dark-` で始まる名前で示す。テーマは HTML の `data-theme` 属性で切り替える。

| 名前 | 役割 |
| --- | --- |
| `text-default` | 仮：本文の文字 |
| `text-subtle` | 仮：補足の文字 |
| `text-inverse` | 仮：emphasis 背景の上の文字 |
| `background-default` | 仮：ページの背景 |
| `background-subtle` | 仮：区切った面の背景 |
| `background-emphasis` | 仮：主要な操作の背景 |
| `border-default` | 仮：入力欄や操作部品の境界線（3:1 の対象） |

フォーカスリング（`focus-ring-inner` / `focus-ring-outer`）は固定の値で、ブランド色とは独立している。変えない。

## Typography

本文は 16px 以上、行間は 1.5 以上（固定の規則）。補助の文字（caption）も 14px を下回らない。書体は未定で、OS の標準書体で代用している。

## Layout

余白は 4px を基数にした段階（spacing）だけを使う。段階にない値が必要になったら、作らずに質問する。

## Elevation & Depth

未定（影を使うか、境界線で面を分けるかはモード B で決める）。

## Shapes

角丸は rounded の段階（none / sm / full）だけを使う。

## Components

見本は Button（primary / secondary）だけ。部品を選ぶときは components/_index.md の選定索引を引く。

## Do's and Don'ts

- 未定。brief.md を書いたあと、モード B で決める。
