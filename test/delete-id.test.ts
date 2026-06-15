/**
 * Unit tests for resolveDeleteId — the pure input-normalisation helper used by
 * POST /api/delete.  No runtime or network access needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { resolveDeleteId } from '../src/lib/server/bundle-key.ts';

// ---------------------------------------------------------------------------
// New contract: { id }
// ---------------------------------------------------------------------------

test('resolveDeleteId: accepts a valid 10-char id', () => {
	assert.equal(resolveDeleteId({ id: 'aBcDeFgHiJ' }), 'aBcDeFgHiJ');
});

test('resolveDeleteId: accepts id containing _ and -', () => {
	assert.equal(resolveDeleteId({ id: 'aB_cD-eF01' }), 'aB_cD-eF01');
});

test('resolveDeleteId: throws on id shorter than 10 chars', () => {
	assert.throws(() => resolveDeleteId({ id: 'short' }), /Invalid id/);
});

test('resolveDeleteId: throws on id longer than 10 chars', () => {
	assert.throws(() => resolveDeleteId({ id: 'toolongstring' }), /Invalid id/);
});

test('resolveDeleteId: throws on non-string id', () => {
	assert.throws(() => resolveDeleteId({ id: 12345 }), /Invalid id/);
});

test('resolveDeleteId: throws on id with disallowed characters', () => {
	assert.throws(() => resolveDeleteId({ id: 'bad!char!!' }), /Invalid id/);
});

// ---------------------------------------------------------------------------
// Legacy contract: { key }
// ---------------------------------------------------------------------------

test('resolveDeleteId: derives id from a well-formed legacy key', () => {
	assert.equal(resolveDeleteId({ key: 'aBcDeFgHiJ/photo.jpg' }), 'aBcDeFgHiJ');
});

test('resolveDeleteId: derives id from a three-segment bundle member key', () => {
	// New-style key: {bundleId}/{fileId}/{filename}
	assert.equal(resolveDeleteId({ key: 'aBcDeFgHiJ/fId0000001/report.pdf' }), 'aBcDeFgHiJ');
});

test('resolveDeleteId: throws on key whose first segment is not a valid id', () => {
	assert.throws(() => resolveDeleteId({ key: 'bad/photo.jpg' }), /Invalid key/);
});

test('resolveDeleteId: throws on non-string key', () => {
	assert.throws(() => resolveDeleteId({ key: 42 }), /Invalid key/);
});

// ---------------------------------------------------------------------------
// Precedence & missing-input
// ---------------------------------------------------------------------------

test('resolveDeleteId: id takes precedence when both id and key are present', () => {
	assert.equal(
		resolveDeleteId({ id: 'aBcDeFgHiJ', key: 'zzzzzzzzzz/file.txt' }),
		'aBcDeFgHiJ'
	);
});

test('resolveDeleteId: throws when neither id nor key is provided', () => {
	assert.throws(() => resolveDeleteId({}), /must include either/);
});

test('resolveDeleteId: throws when both id and key are undefined explicitly', () => {
	assert.throws(() => resolveDeleteId({ id: undefined, key: undefined }), /must include either/);
});
