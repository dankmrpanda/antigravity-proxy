import fs from 'fs';
import path from 'path';
import { execSync, spawn, exec } from 'child_process';
import { platform } from 'os';
import { certExists, generateCerts, trustCert, isCertTrusted, cleanHostsFile, setupHostsFile } from '../utils/cert.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { startProxy, isProxyRunning, waitForHealth } from '../utils/process.js';
import { openUrl } from '../utils/open.js';
import { PROXY_DIR } from '../utils/paths.js';
import { USER_CERTS_DIR } from '../../data-paths.js';
import { ensureUserDataWritable } from '../../data-paths.js';
import { checkAndPromptUpdate } from '../utils/update-check.js';
import chalk from 'chalk';
import { section, ok, fail, warn, info, header, startSpinner, succeedSpinner, failSpinner, warnSpinner, arrow, error } from '../ui.js';

interface StartOptions {
  port?: string;
  browser?: boolean;
  foreground?: boolean;
  trustCert?: boolean;
  simple?: boolean;
}

/**
 * When running under sudo, GUI apps must be launched as the invoking user —
 * never as root. A root-launched Electron app creates root-owned profile
 * data, locking the user out on next normal launch (looks like a logout).
 */
function dropToRealUser(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (platform() === 'win32') return { cmd, args };
  try {
    const sudoUser = process.env.SUDO_USER;
    const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
    if (isRoot && sudoUser && sudoUser !== 'root') {
      return { cmd: 'sudo', args: ['-u', sudoUser, cmd, ...args] };
    }
  } catch { /* fall through unmodified */ }
  return { cmd, args };
}

function launchAntigravityDesktop(): boolean {
  const p = platform();
  let exePath = '';

  if (p === 'win32') {
    const candidates = [
      path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Antigravity', 'Antigravity.exe'),
      path.join(process.env.ProgramFiles || '', 'Antigravity', 'Antigravity.exe'),
      path.join(process.env['ProgramFiles(x86)'] || '', 'Antigravity', 'Antigravity.exe'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        exec(`start "" "${exePath}"`, { timeout: 5000, windowsHide: false }, () => {});
        return true;
      } catch {}
    }
  } else if (p === 'darwin') {
    const candidates = [
      '/Applications/Antigravity.app',
      path.join(process.env.HOME || '', 'Applications', 'Antigravity.app'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        const { cmd, args } = dropToRealUser('open', [exePath]);
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
  } else {
    const candidates = [
      '/usr/bin/antigravity',
      '/usr/local/bin/antigravity',
      path.join(process.env.HOME || '', '.local', 'bin', 'antigravity'),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) { exePath = c; break; }
    }
    if (exePath) {
      try {
        const { cmd, args } = dropToRealUser(exePath, []);
        spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
  }
  return false;
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const proxyPort = parseInt(opts.port || process.env.PROXY_PORT || '443', 10);
  const apiPort = parseInt(process.env.API_PORT || '4000', 10);

  header('Antigravity Proxy', `v${JSON.parse(fs.readFileSync(path.join(PROXY_DIR, 'package.json'), 'utf-8')).version}`);

  // Simple mode: just launch Antigravity directly without proxy
  if (opts.simple) {
    section('Simple Mode');
    console.log(`  ${info('Launching Antigravity directly (no proxy)')}\n`);

    // Clean up hosts file entries that route traffic to the proxy
    section('Cleaning up proxy routing');
    const hostsResult = cleanHostsFile();
    if (hostsResult.found && hostsResult.cleaned) {
      console.log(`  ${ok('Proxy routing entries removed from hosts file')}`);
    } else if (hostsResult.found && !hostsResult.cleaned) {
      console.log(`  ${warn(`Found proxy entries but could not remove: ${hostsResult.error}`)}`);
      console.log(`  ${info('Run as Administrator to clean hosts file')}`);
    } else {
      console.log(`  ${ok('No proxy routing entries found in hosts file')}`);
    }

    console.log(`  ${arrow('Launching Antigravity desktop')}`);
    if (launchAntigravityDesktop()) {
      console.log(`  ${ok('Antigravity launched')}`);
    } else {
      console.log(`  ${warn('Antigravity not found — launch it manually')}`);
    }

    console.log('');
    console.log(`  ${chalk.bold.green('✓ Ready!')}`);
    console.log(`  ${info('Antigravity is running in simple mode (direct Google access)')}`);
    console.log('');
    console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity start')} ${chalk.dim('to start with proxy.')}`);
    return;
  }

  section('Checking prerequisites');

  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1), 10);
  if (major < 20) {
    fail(`Node.js 20+ required (found ${nodeVersion})`);
    process.exit(1);
  }
  console.log(`  ${ok(`Node.js ${nodeVersion}`)}`);

  const updateSpinner = startSpinner('Checking for updates');
  try {
    const pkgPath = path.join(PROXY_DIR, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    checkAndPromptUpdate(pkg.version);
    succeedSpinner(updateSpinner);
  } catch {
    succeedSpinner(updateSpinner);
  }

  section('Setting up environment');
  const dataCheck = ensureUserDataWritable();
  if (!dataCheck.ok && dataCheck.hint) {
    console.log(`  ${warn(dataCheck.hint)}`);
  }
  const depSpinner = startSpinner('Checking dependencies');
  const nodeModules = path.join(PROXY_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules) && !fs.existsSync(path.join(PROXY_DIR, 'dist', 'index.js'))) {
    depSpinner.text = 'Installing dependencies...';
    try {
      execSync('npm install --omit=dev', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 120000 });
    } catch {
      // Fallback for old npm (<8) that doesn't support --omit=dev
      execSync('npm install --production', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 120000 });
    }
    succeedSpinner(depSpinner, 'Dependencies installed');
  } else {
    succeedSpinner(depSpinner, 'Dependencies ready');
  }

  const certSpinner = startSpinner('Setting up TLS certificates');
  if (!certExists()) {
    generateCerts();
    succeedSpinner(certSpinner, 'TLS certificates generated');
  } else {
    succeedSpinner(certSpinner, 'TLS certificates ready');
  }

  const certTrustSpinner = startSpinner('Trusting TLS certificate');
  // Marker lives next to the user certs (not the repo dir) so global npm
  // installs and source checkouts share the same trust state.
  const certTrustedMarker = path.join(USER_CERTS_DIR, '.trusted');
  const alreadyTrusted = isCertTrusted() || fs.existsSync(certTrustedMarker);
  const shouldTrust = opts.trustCert || !alreadyTrusted;
  if (shouldTrust) {
    try {
      trustCert();
      try { fs.writeFileSync(certTrustedMarker, new Date().toISOString()); } catch { /* best-effort */ }
      succeedSpinner(certTrustSpinner, 'Certificate trusted');
    } catch (e: any) {
      warnSpinner(certTrustSpinner, `Certificate not auto-trusted: ${e.message}`);
      console.log(`  ${info('Run: antigravity certs trust')}`);
    }
  } else {
    succeedSpinner(certTrustSpinner, 'Certificate already trusted');
  }

  section('Clearing old processes');
  const portsToCheck = [443, 8443, apiPort];
  if (!portsToCheck.includes(proxyPort)) portsToCheck.push(proxyPort);
  killProcessesOnPorts(portsToCheck);
  console.log(`  ${ok('Ports cleared')}`);

  section('Setting up proxy routing');
  const hostsSpinner = startSpinner('Configuring hosts file');
  const hostsResult = setupHostsFile();
  if (hostsResult.found && hostsResult.cleaned) {
    succeedSpinner(hostsSpinner, 'Proxy routing entries added to hosts file');
  } else if (hostsResult.found && !hostsResult.cleaned) {
    warnSpinner(hostsSpinner, `Could not add routing entries: ${hostsResult.error}`);
    const elevateMsg = platform() === 'win32'
      ? 'Run as Administrator to update hosts file'
      : 'Run with sudo to update hosts file (e.g. sudo antigravity start)';
    console.log(`  ${info(elevateMsg)}`);
  } else {
    succeedSpinner(hostsSpinner, 'Hosts file already configured');
  }

  // macOS/Linux privilege hint for port 443 (privileged port <1024)
  if (platform() !== 'win32' && proxyPort < 1024 && typeof process.getuid === 'function' && process.getuid() !== 0) {
    console.log(`  ${warn(`Port ${proxyPort} requires root. If bind fails, re-run with sudo or use --port 8443 with a 443→8443 forwarder (see docs/SETUP.md).`)}`);
  }

  const envDir = PROXY_DIR;
  const envPath = path.join(envDir, '.env');
  const envExample = path.join(envDir, '.env.example');
  if (!fs.existsSync(envPath) && fs.existsSync(envExample)) {
    fs.copyFileSync(envExample, envPath);
    console.log(`  ${warn('.env created from template — add API keys in dashboard Config tab')}`);
  }

  const logsDir = path.join(PROXY_DIR, 'logs');
  if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  const distDir = path.join(PROXY_DIR, 'dist');
  if (!fs.existsSync(distDir)) {
    const buildSpinner = startSpinner('Building TypeScript');
    try {
      execSync('npx tsc', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 60000 });
      succeedSpinner(buildSpinner, 'TypeScript compiled');
    } catch {
      warnSpinner(buildSpinner, 'Build failed, running in dev mode with tsx');
    }
  }

  if (isProxyRunning()) {
    error('Proxy already running. Use `antigravity stop` first.');
    process.exit(1);
  }

  section('Starting proxy');

  if (opts.foreground) {
    console.log(`  ${arrow('Launching Antigravity desktop')}`);
    if (launchAntigravityDesktop()) {
      console.log(`  ${ok('Antigravity launched')}`);
    } else {
      console.log(`  ${warn('Antigravity not found — launch it manually')}`);
    }

    console.log(`  ${arrow('Starting proxy in foreground')}`);
    startProxy({ proxyPort, apiPort, foreground: true });
    return;
  }

  const proxySpinner = startSpinner('Starting proxy');
  const pid = startProxy({ proxyPort, apiPort, foreground: false });
  if (pid) {
    succeedSpinner(proxySpinner, `Proxy started (PID ${pid})`);
  } else {
    failSpinner(proxySpinner, 'Failed to start proxy');
    process.exit(1);
  }

  const healthSpinner = startSpinner('Waiting for dashboard');
  const healthy = await waitForHealth(apiPort);
  if (healthy) {
    succeedSpinner(healthSpinner, 'Dashboard ready');
  } else {
    warnSpinner(healthSpinner, 'Dashboard not yet responding — check logs');
  }

  if (opts.browser !== false) {
    openUrl(`http://localhost:${apiPort}`);
  }

  console.log(`  ${arrow('Launching Antigravity desktop')}`);
  if (launchAntigravityDesktop()) {
    console.log(`  ${ok('Antigravity launched')}`);
  } else {
    console.log(`  ${warn('Antigravity not found — launch it manually')}`);
  }

  console.log('');
  console.log(`  ${chalk.bold.green('✓ Ready!')}`);
  console.log(`  ${info(`Dashboard:  http://localhost:${apiPort}`)}`);
  console.log(`  ${info(`TLS Proxy:  https://localhost:${proxyPort}`)}`);
  console.log('');
  console.log(`  ${chalk.dim('Configure providers and API keys from the dashboard Config tab.')}`);
  console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity stop')} ${chalk.dim('to stop everything.')}`);
  console.log(`  ${chalk.dim('Run')} ${chalk.cyan('antigravity start --foreground')} ${chalk.dim('to see live logs.')}`);
}
