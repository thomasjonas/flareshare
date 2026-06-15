/**
 * Unit tests for src/lib/server/bundle-key.ts
 *
 * Pure module — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseBundleId, bundleMemberKey, BUNDLE_ID_RE } from '../src/lib/server/bundle-key.ts';

// ---------------------------------------------------------------------------
// parseBundleId
// ---------------------------------------------------------------------------

test('parseBundleId: returns null for undefined', () => {
	assert.equal(parseBundleId(undefined), null);
});

test('parseBundleId: returns null for null', () => {
	assert.equal(parseBundleId(null), null);
});

test('parseBundleId: accepts a valid 10-char nanoid-alphabet string', () => {
	const id = 'aBcDeFgHiJ';
	assert.equal(parseBundleId(id), id);
});

test('parseBundleId: accepts IDs containing _ and -', () => {
	const id = 'aB_cD-eF01';
	assert.equal(parseBundleId(id), id);
});

test('parseBundleId: throws on non-string value', () => {
	assert.throws(() => parseBundleId(42));
});

test('parseBundleId: throws on string shorter than 10 chars', () => {
	assert.throws(() => parseBundleId('short'));
});

test('parseBundleId: throws on string longer than 10 chars', () => {
	assert.throws(() => parseBundleId('toolongstring'));
});

test('parseBundleId: throws on string with disallowed characters', () => {
	assert.throws(() => parseBundleId('invalid!@#$%'));
});

// ---------------------------------------------------------------------------
// bundleMemberKey
// ---------------------------------------------------------------------------

test('bundleMemberKey: produces three-segment path', () => {
	const key = bundleMemberKey('bundleId01', 'fileId01', 'report.pdf');
	assert.equal(key, 'bundleId01/fileId01/report.pdf');
});

test('bundleMemberKey: two files with the same name yield distinct keys when fileId differs', () => {
	const bundleId = 'sameBundle0';
	const key1 = bundleMemberKey(bundleId, 'fileId001', 'report.pdf');
	const key2 = bundleMemberKey(bundleId, 'fileId002', 'report.pdf');
	assert.notEqual(key1, key2);
	assert.ok(key1.startsWith(`${bundleId}/`), 'key1 must be under the bundle prefix');
	assert.ok(key2.startsWith(`${bundleId}/`), 'key2 must be under the bundle prefix');
});

test('bundleMemberKey: member key never equals manifest key', () => {
	const bundleId = 'bundleId01';
	// manifest lives at {bundleId}/manifest.json — two segments
	const manifestKey = `${bundleId}/manifest.json`;
	const memberKey = bundleMemberKey(bundleId, 'fileId001', 'manifest.json');
	// even if the filename is manifest.json, the extra fileId segment makes it distinct
	assert.notEqual(memberKey, manifestKey);
});

// ---------------------------------------------------------------------------
// BUNDLE_ID_RE: spot checks matching the validation used in /d/[id]
// ---------------------------------------------------------------------------

test('BUNDLE_ID_RE: matches a 10-char alphanumeric string', () => {
	assert.ok(BUNDLE_ID_RE.test('abcdefghij'));
});

test('BUNDLE_ID_RE: does not match 9-char string', () => {
	assert.ok(!BUNDLE_ID_RE.test('abcdefghi'));
});

test('BUNDLE_ID_RE: does not match 11-char string', () => {
	assert.ok(!BUNDLE_ID_RE.test('abcdefghijk'));
});
