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
const AUTH_TOKEN = "";        // 認証用トークン

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

    // 認証トークンの確認
    // AUTH_TOKENがデフォルト値のまま、または未設定の場合はセキュリティリスクのため処理を停止
    if (!AUTH_TOKEN || AUTH_TOKEN === "YOUR_SECRET_TOKEN") {
      Logger.log("Security Alert: AUTH_TOKEN is not configured. Please configure a secret token in gas/Code.gs.");
      return createResponse(500, {
        success: false,
        error: "Server configuration error: Authentication token is not set."
      });
    }
    if (body.token !== AUTH_TOKEN) {
      return createResponse(401, {
        success: false,
        error: "Unauthorized: Invalid token"
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
    const row = {
      user_email: body.user_email,
      service_name: body.service_name,
      action: body.action,
      prompt_text: body.prompt_text || null,
      timestamp: body.timestamp,
      url: body.url,
      inserted_at: new Date().toISOString()
    };

    const insertAllRequest = {
      rows: [
        {
          insertId: Utilities.getUuid(), // 重複排除用
          json: row
        }
      ]
    };

    try {
      const response = BigQuery.Tabledata.insertAll(
        insertAllRequest,
        PROJECT_ID,
        DATASET_ID,
        TABLE_ID
      );

      // 200 OK で返るエラー (スキーマ不一致など) を検知
      if (response.insertErrors && response.insertErrors.length > 0) {

        // no such field エラーかどうかを insertErrors の中身を走査して確認
        let hasNoSuchFieldError = false;
        for (let i = 0; i < response.insertErrors.length; i++) {
          const errors = response.insertErrors[i].errors;
          if (errors) {
            for (let j = 0; j < errors.length; j++) {
              if (errors[j].reason === "invalid" && errors[j].message && errors[j].message.indexOf("no such field") !== -1) {
                hasNoSuchFieldError = true;
                break;
              }
            }
          }
          if (hasNoSuchFieldError) break;
        }

        if (hasNoSuchFieldError) {
          Logger.log("Field not found. Updating table schema to add prompt_text...");
          addPromptTextColumn();

          let retrySuccess = false;
          let retryWait = 2000; // 初期待機時間 2秒
          let lastErrors = null;

          // エクスポネンシャルバックオフによるリトライ (最大3回)
          for (let attempt = 1; attempt <= 3; attempt++) {
            Logger.log("Retry attempt " + attempt + " after waiting " + retryWait + "ms...");
            Utilities.sleep(retryWait);

            const retryResponse = BigQuery.Tabledata.insertAll(
              insertAllRequest,
              PROJECT_ID,
              DATASET_ID,
              TABLE_ID
            );

            if (retryResponse.insertErrors && retryResponse.insertErrors.length > 0) {
              lastErrors = retryResponse.insertErrors;
              retryWait *= 2; // 次回の待機時間を倍にする (2s -> 4s -> 8s)
            } else {
              retrySuccess = true;
              break;
            }
          }

          if (!retrySuccess) {
            Logger.log("Retry insert errors after backoff: " + JSON.stringify(lastErrors));
            return createResponse(500, {
              success: false,
              error: "An internal error occurred during data insertion. Please contact the administrator."
            });
          }
        } else {
          Logger.log("Insert errors: " + JSON.stringify(response.insertErrors));
          return createResponse(500, {
            success: false,
            error: "An internal error occurred during data insertion. Please contact the administrator."
          });
        }
      }
    } catch (insertError) {
      // データセット・テーブルが見つからない場合 (404)
      if (insertError.message && insertError.message.indexOf("Not found") !== -1) {
        Logger.log("Dataset/Table not found. Auto-creating...");
        createBigQueryTable();

        let retrySuccess = false;
        let retryWait = 2000;

        // 404時もエクスポネンシャルバックオフでリトライ
        for (let attempt = 1; attempt <= 3; attempt++) {
          Utilities.sleep(retryWait);
          try {
            BigQuery.Tabledata.insertAll(
              insertAllRequest,
              PROJECT_ID,
              DATASET_ID,
              TABLE_ID
            );
            retrySuccess = true;
            break;
          } catch (e) {
            if (e.message && e.message.indexOf("Not found") !== -1 && attempt < 3) {
              retryWait *= 2;
            } else {
              throw e;
            }
          }
        }

        if (!retrySuccess) {
          Logger.log("Failed to insert after creating dataset/table");
          return createResponse(500, {
            success: false,
            error: "An internal error occurred during data insertion. Please contact the administrator."
          });
        }
      } else {
        Logger.log("Insert error: " + insertError.message);
        return createResponse(500, {
          success: false,
          error: "An internal error occurred during data insertion. Please contact the administrator."
        });
      }
    }

    // セキュリティのため、プロンプト等の機密情報を含む行データ全文はログ出力しない
    Logger.log("BigQuery insert success: " + row.service_name + " / " + row.action);

    return createResponse(200, {
      success: true,
      message: "Data inserted successfully",
      // レスポンスにも機密情報を含めないようにする
      service_name: row.service_name
    });

  } catch (error) {
    Logger.log("Error in doPost: " + error.message);
    return createResponse(500, {
      success: false,
      error: "An internal server error occurred."
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
  // セキュリティのため、機密情報を含む可能性があるレスポンス全文はログ出力しない
  Logger.log("Response [" + statusCode + "]: " + (data.success ? "success" : "error: " + data.error));
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
    const dataset = {
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
  const table = {
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
        { name: "prompt_text",   type: "STRING",    mode: "NULLABLE", description: "プロンプトのテキスト" },
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

/**
 * 既存のテーブルに prompt_text カラムを追加する
 */
function addPromptTextColumn() {
  try {
    // 現在のテーブルスキーマを取得
    const table = BigQuery.Tables.get(PROJECT_ID, DATASET_ID, TABLE_ID);
    const schema = table.schema;
    const fields = schema.fields;

    // すでに存在するか確認
    const hasPromptText = fields.some(function(field) {
      return field.name === "prompt_text";
    });

    if (!hasPromptText) {
      fields.push({
        name: "prompt_text",
        type: "STRING",
        mode: "NULLABLE",
        description: "プロンプトのテキスト"
      });

      // テーブルを更新
      BigQuery.Tables.patch(table, PROJECT_ID, DATASET_ID, TABLE_ID);
      Logger.log("Successfully added 'prompt_text' column to the table.");
    } else {
      Logger.log("'prompt_text' column already exists.");
    }
  } catch (e) {
    Logger.log("Error adding 'prompt_text' column: " + e.message);
    throw e;
  }
}
