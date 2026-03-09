/**
 * AI Usage Tracker - Options Page Script
 *
 * GAS Webhook URL の保存・読み込み・接続テストを管理する。
 * 監視対象サービスの有効/無効切り替えを管理する。
 */

(function () {
    "use strict";

    const webhookUrlInput = document.getElementById("webhookUrl");
    const saveBtn = document.getElementById("saveBtn");
    const testBtn = document.getElementById("testBtn");
    const statusEl = document.getElementById("status");
    const servicesList = document.getElementById("servicesList");

    // --- ステータス表示 ---
    function showStatus(message, type) {
        statusEl.textContent = message;
        statusEl.className = "status " + type;
    }

    // --- 接続テスト（background.js 経由） ---
    function runConnectionTest(url) {
        showStatus("🔄 接続テスト中...", "info");

        chrome.runtime.sendMessage(
            {
                type: "CONNECTION_TEST",
                url: url,
                payload: {
                    user_email: "test@example.com",
                    service_name: "connection_test",
                    action: "ping",
                    prompt_text: "test_prompt",
                    timestamp: new Date().toISOString(),
                    url: "chrome-extension://options"
                }
            },
            (response) => {
                if (chrome.runtime.lastError) {
                    showStatus("❌ 接続エラー: " + chrome.runtime.lastError.message, "error");
                    return;
                }
                if (response && response.success) {
                    showStatus("✅ 保存しました（接続OK）: " + JSON.stringify(response.result), "success");
                } else {
                    showStatus("⚠️ 保存しましたが接続に失敗: " + (response ? response.error : "不明なエラー"), "error");
                }
            }
        );
    }

    // --- URL バリデーション ---
    function validateUrl(url) {
        if (!url) {
            showStatus("URLを入力してください", "error");
            return false;
        }
        try {
            new URL(url);
            return true;
        } catch (e) {
            showStatus("有効なURLを入力してください", "error");
            return false;
        }
    }

    // --- 保存して接続テスト ---
    saveBtn.addEventListener("click", () => {
        const url = webhookUrlInput.value.trim();
        if (!validateUrl(url)) return;

        chrome.storage.sync.set({ gasWebhookUrl: url }, () => {
            if (chrome.runtime.lastError) {
                showStatus("保存に失敗しました: " + chrome.runtime.lastError.message, "error");
                return;
            }
            runConnectionTest(url);
        });
    });

    // --- 接続テストのみ ---
    testBtn.addEventListener("click", () => {
        const url = webhookUrlInput.value.trim();
        if (!validateUrl(url)) return;
        runConnectionTest(url);
    });

    // --- 保存済みURL読み込み ---
    chrome.storage.sync.get(["gasWebhookUrl"], (result) => {
        if (result.gasWebhookUrl) {
            webhookUrlInput.value = result.gasWebhookUrl;
        }
    });

    // --- 監視対象サービスの有効/無効トグル ---
    function saveServiceSettings(settings) {
        chrome.storage.sync.set({ serviceSettings: settings });
    }

    function renderServicesList() {
        if (!CONFIG || !CONFIG.SERVICES) return;

        // 保存済みのサービス設定を読み込んでからレンダリング
        chrome.storage.sync.get(["serviceSettings"], (result) => {
            const settings = result.serviceSettings || {};
            servicesList.textContent = "";

            for (const [key, service] of Object.entries(CONFIG.SERVICES)) {
                // デフォルトは有効
                const isEnabled = settings[key] !== false;

                const item = document.createElement("div");
                item.className = "service-item" + (isEnabled ? "" : " disabled");

                const name = document.createElement("span");
                name.className = "service-name";
                name.textContent = service.name + " — " + service.urlPatterns.join(", ");

                const toggle = document.createElement("label");
                toggle.className = "toggle";

                const checkbox = document.createElement("input");
                checkbox.type = "checkbox";
                checkbox.checked = isEnabled;
                checkbox.dataset.serviceKey = key;

                checkbox.addEventListener("change", (e) => {
                    const serviceKey = e.target.dataset.serviceKey;
                    const enabled = e.target.checked;

                    // UI更新
                    if (enabled) {
                        item.classList.remove("disabled");
                    } else {
                        item.classList.add("disabled");
                    }

                    // chrome.storage に保存
                    chrome.storage.sync.get(["serviceSettings"], (res) => {
                        const current = res.serviceSettings || {};
                        current[serviceKey] = enabled;
                        saveServiceSettings(current);
                    });
                });

                const slider = document.createElement("span");
                slider.className = "toggle-slider";

                toggle.appendChild(checkbox);
                toggle.appendChild(slider);

                item.appendChild(name);
                item.appendChild(toggle);
                servicesList.appendChild(item);
            }
        });
    }

    renderServicesList();
})();
