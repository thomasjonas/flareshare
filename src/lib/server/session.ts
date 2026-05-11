import jwt from '@tsndr/cloudflare-worker-jwt';

const SESSION_TTL = 60 * 60 * 24 * 30; // 30 days

export async function createSession(userId: number, secret: string): Promise<string> {
	return jwt.sign(
		{ sub: String(userId), exp: Math.floor(Date.now() / 1000) + SESSION_TTL },
		secret
	);
}

export async function verifySession(
	token: string,
	secret: string
): Promise<{ id: number } | null> {
	try {
		const valid = await jwt.verify(token, secret);
		if (!valid) return null;
		const { payload } = jwt.decode(token);
		const id = Number(payload?.sub);
		if (!Number.isInteger(id) || id <= 0) return null;
		return { id };
	} catch {
		return null;
	}
}
