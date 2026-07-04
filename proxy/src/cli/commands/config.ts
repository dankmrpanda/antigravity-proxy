import fs from 'fs';
import chalk from 'chalk';
import { USER_ENV_PATH as ENV_PATH } from '../utils/paths.js';
import { header, ok, warn, error, section, maskKey, table, divider } from '../ui.js';

function readEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)/);
      if (m) result[m[1]] = m[2].trim();
    }
  } catch {}
  return result;
}

function writeEnv(updates: Record<string, string>): boolean {
  try {
    let raw = '';
    try { raw = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { raw = ''; }
    for (const [k, v] of Object.entries(updates)) {
      const re = new RegExp(`^${k}=.*`, 'm');
      if (re.test(raw)) raw = raw.replace(re, `${k}=${v}`);
      else raw += `\n${k}=${v}`;
    }
    fs.writeFileSync(ENV_PATH, raw, 'utf-8');
    return true;
  } catch { return false; }
}

interface ConfigOptions {
  json?: boolean;
}

export function configCommand(action?: string, key?: string, value?: string, opts?: ConfigOptions): void {
  if (!action || action === 'show') {
    const env = readEnv();
    if (opts?.json) {
      console.log(JSON.stringify(env, null, 2));
      return;
    }

    header('Current Configuration');

    const entries = Object.entries(env);
    if (entries.length === 0) {
      console.log(`  ${warn('No configuration found')}`);
      console.log(`  ${chalk.cyan('Run `antigravity setup` to configure.')}`);
      return;
    }

    section('Environment Variables');
    for (const [k, v] of Object.entries(env)) {
      const isKey = k.includes('KEY') || k.includes('PASSWORD') || k.includes('SECRET');
      const display = isKey ? maskKey(v) : v;
      console.log(`  ${chalk.cyan(k)}${chalk.dim('=')}${display}`);
    }
    console.log('');
    return;
  }

  if (action === 'get' && key) {
    const env = readEnv();
    const val = env[key];
    if (opts?.json) {
      console.log(JSON.stringify({ key, value: val || null }));
    } else if (val) {
      const isKey = key.includes('KEY') || key.includes('PASSWORD') || key.includes('SECRET');
      console.log(`${key}=${isKey ? maskKey(val) : val}`);
    } else {
      error(`Key "${key}" not found in .env`);
      process.exit(1);
    }
    return;
  }

  if (action === 'set' && key && value !== undefined) {
    if (!writeEnv({ [key]: value })) {
      error('Failed to write .env');
      process.exit(1);
    }
    const isKey = key.includes('KEY') || key.includes('PASSWORD') || key.includes('SECRET');
    console.log(`  ${ok(`${key} updated to ${isKey ? maskKey(value) : value}`)}`);
    return;
  }

  error('Usage: antigravity config [show|get|set] [key] [value]');
  process.exit(1);
}
