declare global {
	namespace App {
		interface Locals {
			user: { id: number } | null;
		}
		interface Platform {
			env: {
				BUCKET: R2Bucket;
				GITHUB_CLIENT_ID: string;
				GITHUB_CLIENT_SECRET: string;
				ALLOWED_GITHUB_ID: string;
				SESSION_SECRET: string;
				R2_ACCOUNT_ID: string;
				R2_ACCESS_KEY_ID: string;
				R2_SECRET_ACCESS_KEY: string;
				R2_BUCKET: string;
				R2_ENDPOINT: string;
			};
		}
	}
}

export {};
