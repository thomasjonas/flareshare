/**
 * Unit tests for src/lib/server/filename.ts
 *
 * Pure module — no runtime/env needed.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { zipFilename } from '../src/lib/server/filename.ts';

test('zipFilename appends .zip when the title has no extension', () => {
	assert.equal(zipFilename('My Photos', 'abcdefghij'), 'My Photos.zip');
});

test('zipFilename does not double the extension when title already ends in .zip', () => {
	assert.equal(zipFilename('archive.zip', 'abcdefghij'), 'archive.zip');
});

test('zipFilename treats the .zip extension case-insensitively', () => {
	assert.equal(zipFilename('archive.ZIP', 'abcdefghij'), 'archive.ZIP');
});

test('zipFilename falls back to a flareshare-{id} name when title is undefined', () => {
	assert.equal(zipFilename(undefined, 'abcdefghij'), 'flareshare-abcdefghij.zip');
});

test('zipFilename falls back when the title is empty or whitespace-only', () => {
	assert.equal(zipFilename('', 'abcdefghij'), 'flareshare-abcdefghij.zip');
	assert.equal(zipFilename('   ', 'abcdefghij'), 'flareshare-abcdefghij.zip');
});

test('zipFilename trims surrounding whitespace before appending', () => {
	assert.equal(zipFilename('  report  ', 'abcdefghij'), 'report.zip');
});

test('zipFilename keeps an inner .zip from being mistaken for the extension', () => {
	assert.equal(zipFilename('my.zip.files', 'abcdefghij'), 'my.zip.files.zip');
});
