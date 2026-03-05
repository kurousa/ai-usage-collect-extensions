/**
 * AI Usage Tracker - Google Apps Script (GAS)
 *
 * Chrome拡張機能からのPOSTリクエストを受信し、
 * BigQueryへストリーミングインサートを行うWebhookエンドポイント。
 *
 * 使い方:
 *   1. Google Apps Script プロジェクトにこのコードを貼り付ける
 *   2. BigQuery APIサービスを有効化する（サービス > BigQuery API）
 *   3. 下記の定数を自身の環境に合わせて変更する
 *   4. デプロイ > Webアプリ > 「全員」にアクセス許可してデプロイ
 */

// === 設定 ===
const PROJECT_ID = "YOUR_GCP_PROJECT_ID";     // GCPプロジェクトID
const DATASET_ID = "ai_usage_logs";            // BigQueryデータセットID
const TABLE_ID   = "usage_events";             // BigQueryテーブルID

/**
 * POSTリクエストのエントリーポイント
 * @param {object} e - リクエストオブジェクト
 * @returns {ContentService.TextOutput} JSON応答
 */
function doPost(e) {
  try {
    // 1. リクエストボディをパース
    const body = JSON.parse(e.postData.contents);

    // 2. バリデーション
    const requiredFields = ["user_email", "service_name", "action", "timestamp", "url"];
    const missingFields = requiredFields.filter(function(field) {
      return !body[field];
    });

    if (missingFields.length > 0) {
      return createResponse(400, {
        success: false,
        error: "Missing required fields: " + missingFields.join(", ")
      });
    }

    // 3. 接続テスト（pingアクション）の場合はBQインサートをスキップ
    if (body.action === "ping") {
      return createResponse(200, {
        success: true,
        message: "pong - connection test successful"
      });
    }

    // 4. BigQueryへストリーミングインサート
    var row = {
      user_email: body.user_email,
      service_name: body.service_name,
      action: body.action,
      timestamp: body.timestamp,
      url: body.url,
      inserted_at: new Date().toISOString()
    };

    var insertAllRequest = {
      rows: [
        {
          insertId: Utilities.getUuid(), // 重複排除用
          json: row
        }
      ]
    };

    try {
      BigQuery.Tabledata.insertAll(
        insertAllRequest,
        PROJECT_ID,
        DATASET_ID,
        TABLE_ID
      );
    } catch (insertError) {
      // データセット・テーブルが存在しない場合は自動作成してリトライ
      if (insertError.message && insertError.message.indexOf("Not found") !== -1) {
        Logger.log("Dataset/Table not found. Auto-creating...");
        createBigQueryTable();
        BigQuery.Tabledata.insertAll(
          insertAllRequest,
          PROJECT_ID,
          DATASET_ID,
          TABLE_ID
        );
      } else {
        throw insertError;
      }
    }

    Logger.log("BigQuery insert success: " + JSON.stringify(row));

    return createResponse(200, {
      success: true,
      message: "Data inserted successfully",
      data: row
    });

  } catch (error) {
    Logger.log("Error in doPost: " + error.message);
    return createResponse(500, {
      success: false,
      error: error.message
    });
  }
}

/**
 * GETリクエスト（疎通確認用）
 * @param {object} e - リクエストオブジェクト
 * @returns {ContentService.TextOutput} JSON応答
 */
function doGet(e) {
  return createResponse(200, {
    success: true,
    message: "AI Usage Tracker GAS Webhook is running",
    version: "1.0.0"
  });
}

/**
 * JSONレスポンスを生成するヘルパー関数
 * @param {number} statusCode - HTTPステータスコード（ログ用）
 * @param {object} data - レスポンスデータ
 * @returns {ContentService.TextOutput} JSON応答
 */
function createResponse(statusCode, data) {
  Logger.log("Response [" + statusCode + "]: " + JSON.stringify(data));
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * BigQueryテーブルを作成するユーティリティ関数
 * 初回セットアップ時に手動実行する。
 */
function createBigQueryTable() {
  // データセットが存在しない場合は作成
  try {
    BigQuery.Datasets.get(PROJECT_ID, DATASET_ID);
    Logger.log("Dataset already exists: " + DATASET_ID);
  } catch (e) {
    var dataset = {
      datasetReference: {
        projectId: PROJECT_ID,
        datasetId: DATASET_ID
      },
      location: "asia-northeast1"
    };
    BigQuery.Datasets.insert(dataset, PROJECT_ID);
    Logger.log("Dataset created: " + DATASET_ID);
  }

  // テーブルを作成
  var table = {
    tableReference: {
      projectId: PROJECT_ID,
      datasetId: DATASET_ID,
      tableId: TABLE_ID
    },
    schema: {
      fields: [
        { name: "user_email",    type: "STRING",    mode: "REQUIRED", description: "ユーザーメールアドレス" },
        { name: "service_name",  type: "STRING",    mode: "REQUIRED", description: "AIサービス名" },
        { name: "action",        type: "STRING",    mode: "REQUIRED", description: "アクション種別" },
        { name: "timestamp",     type: "TIMESTAMP", mode: "REQUIRED", description: "検知日時" },
        { name: "url",           type: "STRING",    mode: "NULLABLE", description: "利用URL" },
        { name: "inserted_at",   type: "TIMESTAMP", mode: "REQUIRED", description: "BQ挿入日時" }
      ]
    },
    timePartitioning: {
      type: "DAY",
      field: "timestamp"
    }
  };

  try {
    BigQuery.Tables.insert(table, PROJECT_ID, DATASET_ID);
    Logger.log("Table created: " + TABLE_ID);
  } catch (e) {
    Logger.log("Table creation error (may already exist): " + e.message);
  }
}
