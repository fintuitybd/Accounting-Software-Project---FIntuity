import { config as loadDotenv } from 'dotenv';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_PATH = fileURLToPath(new URL('../../.env', import.meta.url));

/**
 * Load the repository-root .env file for local development and CLI use. Real deployments must
 * inject environment variables from the platform secret store instead.
 */
export function loadDotEnv(): void {
  loadDotenv({ path: ROOT_ENV_PATH, quiet: true });
}
