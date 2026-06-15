import { nanoid } from 'nanoid';

export function newId(): string {
	return nanoid(10);
}

/** Short nanoid used as a per-file disambiguator inside a bundle. */
export function newFileId(): string {
	return nanoid(8);
}
