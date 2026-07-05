import fs from 'fs';
import path from 'path';
import { isProxyRunning, stopProxy } from '../utils/process.js';
import { isCertTrusted, untrustCert } from '../utils/cert.js';
import { USER_DATA_DIR, USER_ENV_PATH } from '../../data-paths.js';
import { header, section, ok, warn, info, select, confirm, divider } from '../ui.js';

function getDirSize(dirPath: string): string {
  try {
    const stats = fs.statSync(dirPath);
    if (stats.isFile()) {
      const bytes = stats.size;
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return '0 B';
  } catch {
    return 'not found';
  }
}

function getEnvKeyCount(): number {
  try {
    const content = fs.readFileSync(USER_ENV_PATH, 'utf-8');
    const keys = content.split('\n').filter(line =>
      line.match(/^[A-Z_]+_API_KEY=.+/) && !line.includes('your_')
    );
    return keys.length;
  } catch {
    return 0;
  }
}

export async function removeCommand(): Promise<void> {
  header('Antigravity Proxy Removal');

  // Show current state
  section('Current State');

  const proxyRunning = isProxyRunning();
  console.log(`  ${info(`Proxy process: ${proxyRunning ? 'Running' : 'Not running'}`)}`);

  const certTrusted = isCertTrusted();
  console.log(`  ${info(`Certificate: ${certTrusted ? 'Trusted in OS store' : 'Not trusted'}`)}`);

  const configExists = fs.existsSync(USER_ENV_PATH);
  const keyCount = getEnvKeyCount();
  console.log(`  ${info(`Config: ${configExists ? `${USER_ENV_PATH} (${keyCount} API keys)` : 'Not found'}`)}`);

  const dataDir = path.join(USER_DATA_DIR, 'data');
  const logsDir = path.join(USER_DATA_DIR, 'logs');
  const certsDir = path.join(USER_DATA_DIR, 'certs');
  console.log(`  ${info(`Data: ${getDirSize(dataDir)}`)}`);
  console.log(`  ${info(`Logs: ${getDirSize(logsDir)}`)}`);
  console.log(`  ${info(`Certs: ${getDirSize(certsDir)}`)}`);
  console.log('');

  // Removal options
  const options = [
    { name: 'Remove proxy files & certs (keep API keys for future use)', value: 'partial' },
    { name: 'Complete removal (delete everything including config)', value: 'complete' },
    { name: 'Cancel', value: 'cancel' },
  ];

  const choice = await select('Select removal option:', options);

  if (choice === 'cancel') {
    console.log(`  ${info('Cancelled')}\n`);
    return;
  }

  // Confirm
  const warning = choice === 'complete'
    ? 'This will delete ALL data including API keys. This cannot be undone.'
    : 'This will delete proxy files but keep your API keys.';
  console.log(`  ${warn(warning)}\n`);

  const confirmed = await confirm('Proceed with removal?', false);
  if (!confirmed) {
    console.log(`  ${info('Cancelled')}\n`);
    return;
  }

  // Execute removal
  section('Stopping proxy');
  if (proxyRunning) {
    stopProxy();
    console.log(`  ${ok('Proxy stopped')}`);
  } else {
    console.log(`  ${info('Proxy was not running')}`);
  }

  section('Removing certificate from trust store');
  if (certTrusted) {
    untrustCert();
    console.log(`  ${ok('Certificate removed')}`);
  } else {
    console.log(`  ${info('Certificate was not trusted')}`);
  }

  section('Removing files');

  if (choice === 'partial') {
    // Remove certs, data, logs — keep .env
    const dirsToRemove = [certsDir, dataDir, logsDir];
    for (const dir of dirsToRemove) {
      if (fs.existsSync(dir)) {
        fs.rmSync(dir, { recursive: true, force: true });
        console.log(`  ${ok(`Removed ${path.basename(dir)}/`)}`);
      }
    }
    console.log(`  ${info('Kept .env (API keys preserved)')}`);
  } else {
    // Complete removal — delete entire ~/.antigravity/
    if (fs.existsSync(USER_DATA_DIR)) {
      fs.rmSync(USER_DATA_DIR, { recursive: true, force: true });
      console.log(`  ${ok('Removed ~/.antigravity/ directory')}`);
    }
  }

  divider();
  console.log(`  ${ok('Removal complete')}`);

  if (choice === 'partial') {
    console.log(`  ${info('Run `antigravity setup` to reconfigure')}`);
  } else {
    console.log(`  ${info('Run `npm uninstall -g @12errh/antigravity-proxy` to remove the CLI')}`);
  }
  console.log('');
}
