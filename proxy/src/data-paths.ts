import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const USER_DATA_DIR = path.join(os.homedir(), '.antigravity');
export const USER_DB_DIR = path.join(USER_DATA_DIR, 'data');
export const USER_DB_PATH = path.join(USER_DB_DIR, 'proxy.db');
export const USER_CERTS_DIR = path.join(USER_DATA_DIR, 'certs');
export const USER_CERT_FILE = path.join(USER_CERTS_DIR, 'cert.pem');
export const USER_KEY_FILE = path.join(USER_CERTS_DIR, 'key.pem');
export const USER_LOGS_DIR = path.join(USER_DATA_DIR, 'logs');
export const USER_ENV_PATH = path.join(USER_DATA_DIR, '.env');

const OLD_DATA_DIR = path.resolve(__dirname, '..', 'data');
const OLD_CERTS_DIR = path.resolve(__dirname, '..', 'certs');
const OLD_LOGS_DIR = path.resolve(__dirname, '..', 'logs');
const MIGRATION_MARKER = path.join(USER_DATA_DIR, '.data-migrated');

export function migrateUserData(): void {
  if (fs.existsSync(MIGRATION_MARKER)) return;

  let migrated = false;

  if (fs.existsSync(OLD_DATA_DIR) && !fs.existsSync(USER_DB_DIR)) {
    fs.mkdirSync(USER_DB_DIR, { recursive: true });
    for (const f of fs.readdirSync(OLD_DATA_DIR)) {
      try {
        fs.copyFileSync(path.join(OLD_DATA_DIR, f), path.join(USER_DB_DIR, f));
      } catch { }
    }
    migrated = true;
  }

  if (fs.existsSync(OLD_CERTS_DIR) && !fs.existsSync(USER_CERTS_DIR)) {
    fs.mkdirSync(USER_CERTS_DIR, { recursive: true });
    for (const f of fs.readdirSync(OLD_CERTS_DIR)) {
      try {
        fs.copyFileSync(path.join(OLD_CERTS_DIR, f), path.join(USER_CERTS_DIR, f));
      } catch { }
    }
    migrated = true;
  }

  if (fs.existsSync(OLD_LOGS_DIR) && !fs.existsSync(USER_LOGS_DIR)) {
    fs.mkdirSync(USER_LOGS_DIR, { recursive: true });
    for (const f of fs.readdirSync(OLD_LOGS_DIR)) {
      try {
        fs.copyFileSync(path.join(OLD_LOGS_DIR, f), path.join(USER_LOGS_DIR, f));
      } catch { }
    }
    migrated = true;
  }

  if (migrated || fs.existsSync(USER_DATA_DIR)) {
    fs.writeFileSync(MIGRATION_MARKER, new Date().toISOString(), 'utf-8');
  }
}
