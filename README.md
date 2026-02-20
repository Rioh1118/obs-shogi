# ObsShogi

[![License: Shogi App License (Commercial Use Allowed, No Modification)](https://img.shields.io/badge/license-Shogi%20App%20License-blue)](./LICENSE.md)
![Policy: Commercial Use Allowed](https://img.shields.io/badge/commercial-use%20allowed-brightgreen)
![Policy: No Modification](https://img.shields.io/badge/modification-not%20allowed-orange)

![overview](./docs/images/sample_overall.png)

**将棋の研究・棋譜管理に特化したGUIアプリ（Tauri）**  
対局機能は付けず、棋譜の整理／横断／検索／局面検索と、USI対応エンジンによる検討にフォーカスします。

- 対応OS: Windows / macOS / Linux
- 配布: Releases
- ライセンス: **Shogi App License（商用利用可・改変不可）**  
  → 再配布は **無改変のみ** 許可（詳細は [`LICENSE.md`](./LICENSE.md)）

---

## 目次

- [About](#about)
- [Features](#features)
- [Concept](#concept)
- [Usage](#usage)
- [Engine (USI)](#engine-usi)
- [Development](#development)
- [Directory Structure](#directory-structure)
- [Contributing](#contributing)
- [License](#license)

---

## About

既存の将棋GUI（例: ShogiGUI / ShogiHome など）は、対局・検討まで含めた完成度の高いソフトが揃っています。  
一方で「研究のワークフロー（棋譜の切り替え、整理、関連付け、検索、局面検索）」に最適化された体験は、私の知る限り多くありません。

ObsShogi は **“研究の導線”** を中心に設計し、ルートディレクトリ配下の棋譜を前提としたナビゲーションと、横断検索・局面検索で研究を加速します。

---

## Features

- 棋譜の読み込み（KIF / CSA / SFEN / JKF）
- 指し手の適用・分岐の作成／削除・局面再生
- 検討（USIエンジン連携）
- 局面検索
- ファイルツリービュー（ルートディレクトリ配下の棋譜を管理）

---

## Concept

ObsShogi は “ノートアプリ的な感覚” で棋譜を扱うことを目指しています。

- **ルートディレクトリ**を 1 つ決め、配下の棋譜をまとめて扱う
- ツリーで素早く移動し、研究対象を頻繁に切り替える
- 検索／局面検索で「似た局面」「関連する棋譜」を横断する

---

## Usage

1. ルートディレクトリを設定
2. 棋譜を追加（フォルダに配置／アプリから作成）
3. ツリーから棋譜を開いて再生
4. 必要に応じて分岐を作成し、検討へ

---

## Engine (USI)

ObsShogi は **USI（Universal Shogi Interface）** に対応した思考エンジンを利用できます。  
USI は将棋GUIとエンジンが通信するためのプロトコルです。  
参考: [USIプロトコルとは（将棋所）](https://shogidokoro2.stars.ne.jp/usi.html)

### セットアップ（例）

1. USI対応エンジン（実行ファイル）を用意
2. アプリの設定画面でエンジンのパスを登録
3. 検討を開始（局面送信 → 解析結果表示）

> エンジンの種類によっては追加オプション（Hash / Threads 等）の設定が必要です。

---

## Development

### Prerequisites

- Rust (stable)
- Node.js (LTS 推奨)
- npm（このリポジトリは `package-lock.json` を採用）

### Setup

```bash
npm install
npm run tauri dev
```
