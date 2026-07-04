import path from 'path';
import { fileURLToPath } from 'url';
import { USER_DATA_DIR, USER_ENV_PATH } from '../../data-paths.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// utils/ → commands/ → cli/ → src/ → proxy/
export const PROXY_DIR = path.resolve(__dirname, '..', '..', '..');
export const CLI_DIR = path.resolve(__dirname, '..');
export const LOGS_DIR = path.resolve(USER_DATA_DIR, 'logs');
export const ENV_PATH = path.resolve(PROXY_DIR, '.env');
export const ENV_EXAMPLE = path.resolve(PROXY_DIR, '.env.example');

// User config location: ~/.antigravity/.env (persists across package updates)
export const USER_CONFIG_DIR = USER_DATA_DIR;
export { USER_ENV_PATH };
