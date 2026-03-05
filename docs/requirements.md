# AI利用アクセス数トラッキング拡張機能 実装仕様書

## 1. プロジェクト概要

ブラウザ上での各種AIサービス（ChatGPT、Perplexity、NotebookLM、Devinなど）の利用履歴（プロンプト送信アクション）を検知し、データウェアハウス（BigQuery）へログとして蓄積する。
本システムは、クライアント側の「Google Chrome拡張機能（Manifest V3）」と、中継APIとして機能する「Google Apps Script (GAS)」の2つのコンポーネントで構成される。
※ プライバシーと機密情報保護の観点から、入力されたプロンプトのテキスト内容は取得せず、利用メタデータのみを収集する。

## 2. システムアーキテクチャ

1. **データソース（Chrome拡張機能）**: 
   - `content.js`が対象AIサービスのDOMを監視し、Enterキーなどの送信アクションをフックして検知する。
   - `background.js`が`chrome.identity`を用いてGoogle Workspaceのログインユーザーのメールアドレスを取得し、GASへ送信する。
2. **バックエンド / 中継（Google Apps Script）**:
   - 拡張機能からBigQueryへの直接書き込みによるセキュリティリスクを回避するため、GASをWebhookとしてWebアプリデプロイし、POSTリクエストを受信する。
3. **データウェアハウス（BigQuery）**:
   - GASから`BigQuery.Tabledata.insertAll`を用いて、対象データセットのテーブルへストリーミングインサートを行う。

### 3. エージェントへの指示事項

1. ワークスペース構築:本ディレクトリ内に、manifest.json, content.js, background.js を配置すること。

2. 変数分離の提案: 外接部分のURL等をハードコードせず、設定画面や外部ファイルから読み込む仕組みが必要であれば提案・実装すること。

3. ブラウザテスト: Browser Agent 機能を用いて対象AIサービス（ChatGPT等）のモックページを開き、キーボードイベント（Enterキー）が正常にフックされ、notifyUsage が発火するかデバッグ検証すること。