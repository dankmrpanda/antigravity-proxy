import { execSync } from 'child_process';
import chalk from 'chalk';
import { logger } from '../../logger.js';
import { header, info, divider } from '../ui.js';

interface UpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
}

export function checkForUpdates(currentVersion: string): UpdateInfo {
  try {
    const latest = execSync('npm view @12errh/antigravity-proxy version', {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();

    const updateAvailable = latest !== currentVersion;

    return {
      currentVersion,
      latestVersion: latest,
      updateAvailable,
    };
  } catch (err: any) {
    logger.debug(`[update-check] Could not check for updates: ${err.message}`);
    return {
      currentVersion,
      latestVersion: currentVersion,
      updateAvailable: false,
    };
  }
}

export function showUpdateBanner(info: UpdateInfo): boolean {
  if (!info.updateAvailable) return false;

  console.log('');
  console.log(`  ${chalk.bold.yellow('══════════════════════════════════════════════')}`);
  console.log(`  ${chalk.bold.yellow('  Update Available!')}`);
  console.log(`  ${chalk.bold.yellow('══════════════════════════════════════════════')}`);
  console.log('');
  console.log(`  ${chalk.dim('Current:')}  ${chalk.red(info.currentVersion)}`);
  console.log(`  ${chalk.dim('Latest:')}   ${chalk.green(info.latestVersion)}`);
  console.log('');
  console.log(`  ${chalk.cyan('npm update -g @12errh/antigravity-proxy')}`);
  console.log('');

  return true;
}

export function checkAndPromptUpdate(currentVersion: string): boolean {
  const info = checkForUpdates(currentVersion);

  if (!info.updateAvailable) {
    return false;
  }

  const wantsUpdate = showUpdateBanner(info);

  if (wantsUpdate) {
    console.log(`  ${chalk.dim('Press Ctrl+C to cancel, or wait 5 seconds to continue with current version...')}`);
    try {
      const sab = new SharedArrayBuffer(4);
      const int32 = new Int32Array(sab);
      Atomics.wait(int32, 0, 0, 5000);
    } catch {
    }
  }

  return false;
}
