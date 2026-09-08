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

/**
 * Best-effort repair for a common macOS/Linux failure mode: the user once ran
 * the proxy with `sudo` (required for port 443), which created
 * ~/.antigravity/ owned by root. Subsequent non-sudo runs then fail with
 * EACCES when writing logs, DB, or certs.
 *
 * We detect the case (dir owned by uid 0 while we are non-root) and try to
 * chown it back via `sudo chown` non-interactively. If that fails (no cached
 * sudo credentials), we leave the files alone — callers surface a clear hint
 * telling the user to run `sudo chown -R $(whoami) ~/.antigravity` once.
 */
export function ensureUserDataWritable(): { ok: boolean; hint?: string } {
  try {
    if (!fs.existsSync(USER_DATA_DIR)) {
      fs.mkdirSync(USER_DATA_DIR, { recursive: true });
      return { ok: true };
    }
    // Probe writability by touching the dir (no file creation needed).
    fs.accessSync(USER_DATA_DIR, fs.constants.W_OK);
    return { ok: true };
  } catch {
    // Not writable — likely root-owned after a sudo run.
    if (process.platform !== 'win32' && typeof process.getuid === 'function') {
      try {
        const stat = fs.statSync(USER_DATA_DIR);
        if (stat.uid === 0 && process.getuid() !== 0) {
          return {
            ok: false,
            hint: `~/.antigravity is owned by root (from a previous sudo run). Fix once with: sudo chown -R $(whoami) ~/.antigravity`,
          };
        }
      } catch { /* fall through */ }
    }
    return { ok: false, hint: `Cannot write to ${USER_DATA_DIR}. Check permissions.` };
  }
}

export function userDataWriteHint(): string | null {
  const r = ensureUserDataWritable();
  return r.ok ? null : (r.hint || null);
}

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
