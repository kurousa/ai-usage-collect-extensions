/**
 * AI Usage Tracker - Background Service Worker
 *
 * content.jsからのプロンプト送信通知を受信し、
 * chrome.identity でユーザー情報を取得後、GAS Webhook へ POST する。
 */

// config.js は service_worker では直接 import できないため、設定を再定義
// （Manifest V3 の service_worker は ES modules をサポートするが、
//   content_scripts と共有するため直接読み込みも行う）
importScripts("config.js");

/**
 * chrome.storage.sync から GAS Webhook URL を取得する
 * @returns {Promise<string>} GAS Webhook URL
 */
async function getWebhookUrl() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["gasWebhookUrl"], (result) => {
            resolve(result.gasWebhookUrl || CONFIG.DEFAULT_GAS_WEBHOOK_URL);
        });
    });
}

/**
 * chrome.storage.sync から AUTH_TOKEN を取得する
 * @returns {Promise<string>} GAS Auth Token
 */
async function getAuthToken() {
    return new Promise((resolve) => {
        chrome.storage.sync.get(["authToken"], (result) => {
            resolve(result.authToken || "");
        });
    });
}

/**
 * chrome.identity でログインユーザーのメールアドレスを取得する
 * @returns {Promise<string>} ユーザーメールアドレス
 */
async function getUserEmail() {
    return new Promise((resolve, reject) => {
        chrome.identity.getProfileUserInfo({ accountStatus: "ANY" }, (userInfo) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
                return;
            }
            if (userInfo && userInfo.email) {
                resolve(userInfo.email);
            } else {
                reject(new Error("ユーザーメールアドレスが取得できませんでした"));
            }
        });
    });
}

/**
 * GAS Webhook へデータを POST 送信する（リトライ付き）
 * @param {string} url - GAS Webhook URL
 * @param {object} data - 送信データ
 * @param {number} retryCount - 残りリトライ回数
 * @returns {Promise<object>} レスポンス
 */
async function postToGas(url, data, retryCount = CONFIG.MAX_RETRY_COUNT) {
    try {
        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain"
            },
            body: JSON.stringify(data),
            redirect: "follow" // GAS のリダイレクトに対応
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const result = await response.json();
        // セキュリティのため、プロンプト等の機密情報を含むレスポンス全文はログ出力しない
        console.log("[AI Usage Tracker] GAS送信成功:", { success: result.success, service_name: result.service_name });
        return result;
    } catch (error) {
        console.warn(
            `[AI Usage Tracker] GAS送信エラー (残りリトライ: ${retryCount}):`,
            error.message
        );

        if (retryCount > 0) {
            await new Promise((resolve) =>
                setTimeout(resolve, CONFIG.RETRY_INTERVAL_MS)
            );
            return postToGas(url, data, retryCount - 1);
        }

        throw error;
    }
}

// --- メッセージリスナー ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // 許可された送信元かチェック（自分の拡張機能以外からのメッセージを無視）
    if (sender.id !== chrome.runtime.id) {
        console.warn("[AI Usage Tracker] 拒否されたメッセージ送信元:", sender.id);
        return false;
    }

    // --- 接続テスト（オプション画面から） ---
    if (message.type === "CONNECTION_TEST") {
        // オプション画面からのリクエストであることをURLで追加検証
        const optionsUrl = chrome.runtime.getURL("options.html");
        if (sender.url !== optionsUrl) {
            console.warn("[AI Usage Tracker] CONNECTION_TEST が許可されていないURLから送信されました:", sender.url);
            return false;
        }

        (async () => {
            try {
                const result = await postToGas(message.url, message.payload, 0);
                sendResponse({ success: true, result: result });
            } catch (error) {
                sendResponse({ success: false, error: error.message });
            }
        })();
        return true;
    }

    // --- プロンプト送信検知（content.jsから） ---
    if (message.type !== "PROMPT_SUBMITTED") {
        return false;
    }

    // セキュリティのため、プロンプト等の機密情報を含むメッセージ全文はログ出力しない
    console.log("[AI Usage Tracker] 送信検知メッセージ受信:", {
        type: message.type,
        serviceName: message.serviceName,
        trigger: message.trigger,
        timestamp: message.timestamp
    });

    // 非同期処理を行うため true を返して sendResponse を保持
    (async () => {
        try {
            // 1. Webhook URL を取得
            const webhookUrl = await getWebhookUrl();
            if (!webhookUrl) {
                console.warn(
                    "[AI Usage Tracker] GAS Webhook URL が未設定です。オプション画面から設定してください。"
                );
                sendResponse({
                    success: false,
                    error: "GAS Webhook URL が未設定です"
                });
                return;
            }

            // 2. ユーザーメールアドレスを取得
            let userEmail = "unknown";
            try {
                userEmail = await getUserEmail();
            } catch (emailError) {
                console.warn(
                    "[AI Usage Tracker] メールアドレス取得失敗（匿名で続行）:",
                    emailError.message
                );
            }

            // 3. トークンを取得
            const authToken = await getAuthToken();

            // 4. ペイロードを構築
            const payload = {
                user_email: userEmail,
                service_name: message.serviceName,
                action: "prompt_submit",
                prompt_text: message.promptText || null,
                timestamp: message.timestamp,
                url: message.url,
                token: authToken
            };

            // 5. GAS へ POST 送信
            const result = await postToGas(webhookUrl, payload);
            sendResponse({ success: true, result: result });
        } catch (error) {
            console.error("[AI Usage Tracker] 処理エラー:", error);
            sendResponse({ success: false, error: error.message });
        }
    })();

    return true; // 非同期 sendResponse を有効化
});

// --- インストール時の初期設定 ---
chrome.runtime.onInstalled.addListener((details) => {
    if (details.reason === "install") {
        console.log("[AI Usage Tracker] 拡張機能がインストールされました");
        // オプション画面を開いて初期設定を促す
        chrome.runtime.openOptionsPage();
    }
});

console.log("[AI Usage Tracker] Background Service Worker 起動完了");

// Node.js 環境（テスト実行時）のためのエクスポート
if (typeof module !== "undefined" && module.exports) {
    module.exports = { getAuthToken };
}
