# AI Usage Tracker

ブラウザ上のAIサービス利用履歴（プロンプト送信アクション）を検知し、Google Apps Script (GAS) 経由で BigQuery にログとして蓄積する Chrome 拡張機能です。

## 対応AIサービス

| サービス | URL |
|---|---|
| ChatGPT | `chatgpt.com` / `chat.openai.com` |
| Gemini | `gemini.google.com` |
| Perplexity | `www.perplexity.ai` |
| NotebookLM | `notebooklm.google.com` |
| Devin | `app.devin.ai` |

## アーキテクチャ

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│ Chrome Extension │────▶│ Google Apps Script│────▶│   BigQuery   │
│  (Content Script │     │   (Webhook)      │     │              │
│   + Service Worker)    │                  │     │ usage_events │
└─────────────────┘     └──────────────────┘     └──────────────┘
```

- **Content Script** — 3重検知戦略（Enterキー / 送信ボタンクリック / MutationObserver）でプロンプト送信を検知
- **Service Worker** — `chrome.identity` でユーザーメール取得 → GAS Webhook へ POST
- **GAS** — BigQuery ストリーミングインサート（テーブル未作成時は自動作成）

## セットアップ

### 1. GAS のデプロイ

1. [Google Apps Script](https://script.google.com/) で新しいプロジェクトを作成
2. `gas/Code.gs` の内容を貼り付け、`PROJECT_ID` を自身のGCPプロジェクトIDに変更
3. 「サービス」→「＋」→「BigQuery API」を追加
4. 「デプロイ」→「新しいデプロイ」→ ウェブアプリとしてデプロイ
   - **次のユーザーとして実行**: `自分`
   - **アクセスできるユーザー**: `全員`

> 詳細な手順は拡張機能内の「📖 セットアップガイド」（`manual.html`）を参照してください。

### 2. Chrome 拡張機能のインストール

1. `chrome://extensions` を開く
2. 「デベロッパーモード」を有効化
3. 「パッケージ化されていない拡張機能を読み込む」→ このディレクトリを選択
4. オプション画面でデプロイした GAS Webhook URL を設定
5. 「💾 保存して接続テスト」で接続を確認

## ファイル構成

```
ai-usage-collect-extensions/
├── manifest.json          # Chrome拡張 Manifest V3
├── config.js              # AIサービス定義・設定一元管理
├── content.js             # プロンプト送信検知 (Content Script)
├── background.js          # GAS送信・メッセージ中継 (Service Worker)
├── options.html           # 設定画面 UI
├── options.js             # 設定画面ロジック
├── manual.html            # GASセットアップガイド
├── gas/
│   └── Code.gs            # GAS Webhook → BigQuery
├── icons/                 # 拡張機能アイコン
└── requirements.md        # 要件定義書
```

## BigQuery テーブルスキーマ

テーブル `ai_usage_logs.usage_events` （日付パーティション）:

| カラム | 型 | 説明 |
|---|---|---|
| `user_email` | STRING | ユーザーメールアドレス |
| `service_name` | STRING | AIサービス名 |
| `action` | STRING | アクション種別 |
| `timestamp` | TIMESTAMP | 検知日時 |
| `url` | STRING | 利用URL |
| `inserted_at` | TIMESTAMP | BQ挿入日時 |

## 設定画面の機能

- **GAS Webhook URL の保存** — 保存時に自動で接続テストを実行
- **接続テスト** — GAS エンドポイントへの疎通確認
- **サービスの有効/無効切り替え** — 各AIサービスの検知を個別に ON/OFF 可能

## ライセンス

MIT
