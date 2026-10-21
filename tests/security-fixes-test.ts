import assert from 'node:assert';
import { verifyAndConsumeWithdrawalCode, mockCode } from '../server.js';

console.log('--- RUNNING SECURITY FIXES TARGETED VERIFICATION TESTS ---');

// Test 1: mockCode returns empty object (never leaks codes)
const mockResult = mockCode('mockEmailCode', '123456');
assert.deepStrictEqual(mockResult, {}, 'mockCode must always return empty object to prevent leaking verification codes');
console.log('✅ Test 1: mockCode never leaks codes in responses');

// Test 2: verifyAndConsumeWithdrawalCode rejects missing or invalid code
const missingCheck = verifyAndConsumeWithdrawalCode('u_test', undefined);
assert.strictEqual(missingCheck.ok, false);
assert.strictEqual(missingCheck.status, 400);
console.log('✅ Test 2: Withdrawal code verification rejects missing code');

const nonStringCheck = verifyAndConsumeWithdrawalCode('u_test', 123456 as any);
assert.strictEqual(nonStringCheck.ok, false);
assert.strictEqual(nonStringCheck.status, 400);
console.log('✅ Test 3: Withdrawal code verification rejects non-string code');

const noRecordCheck = verifyAndConsumeWithdrawalCode('non_existent_user', '123456');
assert.strictEqual(noRecordCheck.ok, false);
assert.strictEqual(noRecordCheck.status, 400);
console.log('✅ Test 4: Withdrawal code verification rejects user with no active code');

console.log('🎉 All Security Fixes Targeted Unit Tests Passed!');
process.exit(0);
