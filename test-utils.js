/**
 * Simple dependency-free testing utility
 */

const testResults = {
    pass: 0,
    fail: 0,
    failures: []
};

function describe(name, fn) {
    console.log(`\n📦 ${name}`);
    fn();
}

function it(name, fn) {
    try {
        fn();
        console.log(`  ✅ ${name}`);
        testResults.pass++;
    } catch (error) {
        console.error(`  ❌ ${name}`);
        console.error(`     ${error.message}`);
        testResults.fail++;
        testResults.failures.push(`${name}: ${error.message}`);
    }
}

function expect(actual) {
    return {
        toBe(expected) {
            if (actual !== expected) {
                throw new Error(`Expected ${expected} but got ${actual}`);
            }
        },
        toEqual(expected) {
            const actualStr = JSON.stringify(actual);
            const expectedStr = JSON.stringify(expected);
            if (actualStr !== expectedStr) {
                throw new Error(`Expected ${expectedStr} but got ${actualStr}`);
            }
        },
        toBeTruthy() {
            if (!actual) {
                throw new Error(`Expected truthy but got ${actual}`);
            }
        },
        toBeFalsy() {
            if (actual) {
                throw new Error(`Expected falsy but got ${actual}`);
            }
        }
    };
}

function runTests() {
    console.log('\n--- Test Summary ---');
    console.log(`Passed: ${testResults.pass}`);
    console.log(`Failed: ${testResults.fail}`);

    if (testResults.fail > 0) {
        process.exit(1);
    }
}

module.exports = { describe, it, expect, runTests };
