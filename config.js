/**
 * AI Usage Tracker - 設定ファイル
 *
 * 対象AIサービスの定義と外部接続先URLを一元管理する。
 * GAS Webhook URLはオプション画面（options.html）から設定可能。
 */

const CONFIG = {
    /** デフォルトのGAS Webhook URL（オプション画面で上書き可能） */
    DEFAULT_GAS_WEBHOOK_URL: "",

    /** デバウンス間隔（ミリ秒） - 同一操作の多重検知防止 */
    DEBOUNCE_INTERVAL_MS: 2000,

    /** 送信リトライ回数 */
    MAX_RETRY_COUNT: 3,

    /** リトライ間隔（ミリ秒） */
    RETRY_INTERVAL_MS: 1000,

    /**
     * 対象AIサービス定義
     * - urlPattern: マッチングに使用するURLパターン
     * - selectors.textarea: プロンプト入力エリアのCSSセレクタ
     * - selectors.sendButton: 送信ボタンのCSSセレクタ
     * - selectors.responseArea: チャット応答エリアのCSSセレクタ（MutationObserver用フォールバック）
     */
    SERVICES: {
        chatgpt: {
            name: "ChatGPT",
            urlPatterns: [
                "https://chatgpt.com",
                "https://chat.openai.com"
            ],
            selectors: {
                textarea: 'textarea[id="prompt-textarea"], div[id="prompt-textarea"], div[contenteditable="true"]',
                sendButton: 'button[data-testid="send-button"], button[aria-label="Send prompt"]',
                responseArea: 'div[class*="markdown"], div[data-message-author-role="assistant"]'
            }
        },
        perplexity: {
            name: "Perplexity",
            urlPatterns: [
                "https://www.perplexity.ai"
            ],
            selectors: {
                textarea: 'textarea, div[contenteditable="true"]',
                sendButton: 'button[aria-label="Submit"], button[type="submit"]',
                responseArea: 'div[class*="prose"], div[class*="answer"]'
            }
        },
        notebooklm: {
            name: "NotebookLM",
            urlPatterns: [
                "https://notebooklm.google.com"
            ],
            selectors: {
                textarea: 'textarea, div[contenteditable="true"]',
                sendButton: 'button[aria-label="Send"], button[type="submit"]',
                responseArea: 'div[class*="response"], div[class*="answer"]'
            }
        },
        devin: {
            name: "Devin",
            urlPatterns: [
                "https://app.devin.ai"
            ],
            selectors: {
                textarea: 'textarea, div[contenteditable="true"]',
                sendButton: 'button[type="submit"], button[aria-label="Send"]',
                responseArea: 'div[class*="message"], div[class*="response"]'
            }
        },
        gemini: {
            name: "Gemini",
            urlPatterns: [
                "https://gemini.google.com"
            ],
            selectors: {
                textarea: 'div[contenteditable="true"], textarea, .ql-editor, rich-textarea textarea',
                sendButton: 'button[aria-label*="Send"], button.send-button, button[mattooltip*="Send"]',
                responseArea: 'message-content, div[class*="response"], div[class*="markdown"]'
            }
        }
    }
};

// content.js からも background.js からもアクセスできるようグローバルに公開
if (typeof globalThis !== "undefined") {
    globalThis.AI_TRACKER_CONFIG = CONFIG;
}
