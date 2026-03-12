/**
 * Tests for options.js
 */

const { describe, it, expect, runTests } = require('./test-utils');
const { validateUrlLogic } = require('./options');

describe('validateUrlLogic', () => {
    it('should return success for a valid HTTPS URL', () => {
        const result = validateUrlLogic('https://script.google.com/macros/s/xxx/exec');
        expect(result.success).toBeTruthy();
    });

    it('should return success for a valid HTTP URL', () => {
        const result = validateUrlLogic('http://localhost:3000');
        expect(result.success).toBeTruthy();
    });

    it('should return error for empty string', () => {
        const result = validateUrlLogic('');
        expect(result.success).toBeFalsy();
        expect(result.message).toBe('URLを入力してください');
    });

    it('should return error for null', () => {
        const result = validateUrlLogic(null);
        expect(result.success).toBeFalsy();
        expect(result.message).toBe('URLを入力してください');
    });

    it('should return error for invalid URL format', () => {
        const result = validateUrlLogic('not-a-url');
        expect(result.success).toBeFalsy();
        expect(result.message).toBe('有効なURLを入力してください');
    });

    it('should return error for URL with missing protocol', () => {
        const result = validateUrlLogic('google.com');
        expect(result.success).toBeFalsy();
        expect(result.message).toBe('有効なURLを入力してください');
    });

    it('should return error for non-http/https protocol (e.g., ftp)', () => {
        const result = validateUrlLogic('ftp://example.com');
        expect(result.success).toBeFalsy();
        expect(result.message).toBe('http または https のURLを入力してください');
    });
});

runTests();
