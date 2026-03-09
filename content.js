/**
 * AI Usage Tracker - Content Script
 *
 * 対象AIサービスのDOMを監視し、プロンプト送信アクションを検知する。
 * 検知時にbackground.jsへメッセージを送信する。
 *
 * 検知戦略（3重）:
 *   1. Enterキー検知（textarea / contenteditable）
 *   2. 送信ボタンクリック検知
 *   3. DOM変化検知（MutationObserver - フォールバック）
 */

(function () {
    "use strict";

    // --- 現在のページに対応するサービスを特定 ---
    let currentService = null;
    let currentServiceKey = null;

    for (const [key, service] of Object.entries(CONFIG.SERVICES)) {
        if (service.urlPatterns.some((pattern) => location.href.startsWith(pattern))) {
            currentService = service;
            currentServiceKey = key;
            break;
        }
    }

    if (!currentService) {
        return; // 対象外サービスの場合は何もしない
    }

    // --- サービスの有効/無効設定を確認してから初期化 ---
    chrome.storage.sync.get(["serviceSettings"], (result) => {
        const settings = result.serviceSettings || {};
        if (settings[currentServiceKey] === false) {
            console.log(`[AI Usage Tracker] ${currentService.name} は無効化されています。検知をスキップします。`);
            return;
        }

        console.log(`[AI Usage Tracker] 検知開始: ${currentService.name} (${location.href})`);
        initDetection();
    });

    function initDetection() {

        // --- デバウンス管理 ---
        let lastNotifyTime = 0;

        /**
         * プロンプト送信を通知する（デバウンス付き）
         * @param {string} trigger - 検知トリガーの種別
         * @param {string|null} promptText - 送信されたプロンプトのテキスト
         */
        function notifyUsage(trigger, promptText = null) {
            const now = Date.now();
            if (now - lastNotifyTime < CONFIG.DEBOUNCE_INTERVAL_MS) {
                console.log(`[AI Usage Tracker] デバウンス: ${trigger} (スキップ)`);
                return;
            }
            lastNotifyTime = now;

            const payload = {
                type: "PROMPT_SUBMITTED",
                serviceName: currentServiceKey,
                serviceDisplayName: currentService.name,
                trigger: trigger,
                promptText: promptText,
                timestamp: new Date().toISOString(),
                url: location.href
            };

            console.log(`[AI Usage Tracker] 送信検知: ${trigger}`, payload);

            try {
                chrome.runtime.sendMessage(payload, (response) => {
                    if (chrome.runtime.lastError) {
                        console.warn(
                            "[AI Usage Tracker] メッセージ送信エラー:",
                            chrome.runtime.lastError.message
                        );
                        return;
                    }
                    console.log("[AI Usage Tracker] background応答:", response);
                });
            } catch (err) {
                console.warn("[AI Usage Tracker] sendMessage例外:", err);
            }
        }

        // --- 戦略1: Enterキー検知 ---
        function setupEnterKeyDetection() {
            document.addEventListener(
                "keydown",
                (event) => {
                    if (event.key !== "Enter" || event.shiftKey) {
                        return; // Shift+Enter（改行）は除外
                    }

                    const target = event.target;
                    if (!target) return;

                    // textarea または contenteditable 要素からの送信か判定
                    const isTextarea = target.tagName === "TEXTAREA";
                    const isContentEditable =
                        target.getAttribute("contenteditable") === "true";

                    if (!isTextarea && !isContentEditable) return;

                    // 対象サービスのセレクタにマッチするか確認
                    const selectors = currentService.selectors.textarea;
                    const matchesSelector = selectors
                        .split(",")
                        .some((sel) => target.matches(sel.trim()));

                    // セレクタがマッチするか、もしくは入力エリアとして妥当な要素か
                    if (matchesSelector || isTextarea || isContentEditable) {
                        // IME変換中（isComposing）は除外
                        if (event.isComposing) return;

                        let promptText = target.value || target.innerText || target.textContent || "";
                        notifyUsage("enter_key", promptText.trim());
                    }
                },
                true // captureフェーズで先にフック
            );

            console.log("[AI Usage Tracker] Enterキー検知を設定");
        }

        // --- 戦略2: 送信ボタンクリック検知 ---
        function setupSendButtonDetection() {
            const buttonSelectors = currentService.selectors.sendButton;

            // クリックイベントのデリゲーション（動的要素対応）
            document.addEventListener(
                "click",
                (event) => {
                    const target = event.target;
                    if (!target) return;

                    // ボタン自体、またはボタンの子要素（アイコン等）がクリックされた場合
                    const selectors = buttonSelectors.split(",").map((s) => s.trim());
                    for (const sel of selectors) {
                        if (target.matches(sel) || target.closest(sel)) {
                            // 入力欄のテキストを取得
                            let promptText = "";
                            const textareaSelectors = currentService.selectors.textarea.split(",").map(s => s.trim());
                            for (const taSel of textareaSelectors) {
                                // 複数見つかる可能性がある場合、入力がある要素を優先して探す
                                const inputAreas = document.querySelectorAll(taSel);
                                for (const area of inputAreas) {
                                    const text = area.value || area.innerText || area.textContent || "";
                                    if (text.trim().length > 0) {
                                        promptText = text;
                                        break; // 空ではないテキストが見つかったら終了
                                    }
                                }
                                if (promptText) break;
                            }

                            notifyUsage("send_button_click", promptText.trim());
                            return;
                        }
                    }
                },
                true // captureフェーズ
            );

            console.log("[AI Usage Tracker] 送信ボタンクリック検知を設定");
        }

        // --- 戦略3: DOM変化検知（フォールバック） ---
        function setupMutationObserverDetection() {
            const responseSelectors = currentService.selectors.responseArea;
            if (!responseSelectors) return;

            // 応答エリアの出現を待ち、子要素の追加を監視する
            let observingResponse = false;

            const bodyObserver = new MutationObserver(() => {
                if (observingResponse) return;

                const selectors = responseSelectors.split(",").map((s) => s.trim());
                for (const sel of selectors) {
                    const responseArea = document.querySelector(sel);
                    if (responseArea) {
                        observeResponseArea(responseArea);
                        observingResponse = true;
                        return;
                    }
                }
            });

            bodyObserver.observe(document.body, {
                childList: true,
                subtree: true
            });

            function observeResponseArea(area) {
                const responseObserver = new MutationObserver((mutations) => {
                    for (const mutation of mutations) {
                        if (mutation.addedNodes.length > 0) {
                            // DOM検知時は入力テキストがすでに消えている可能性が高いため null を送る
                            notifyUsage("dom_mutation", null);
                            return;
                        }
                    }
                });

                responseObserver.observe(area, {
                    childList: true,
                    subtree: true
                });

                console.log("[AI Usage Tracker] DOM変化検知（MutationObserver）を設定");
            }
        }

        // --- 全戦略を初期化 ---
        setupEnterKeyDetection();
        setupSendButtonDetection();
        setupMutationObserverDetection();

        console.log("[AI Usage Tracker] 全検知戦略の初期化完了");

    } // end initDetection
})();

