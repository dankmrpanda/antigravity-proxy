import fs from 'fs';
import path from 'path';
import { execSync, spawn, exec } from 'child_process';
import { platform } from 'os';
import { certExists, generateCerts, trustCert } from '../utils/cert.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { startProxy, isProxyRunning, waitForHealth } from '../utils/process.js';
import { openUrl } from '../utils/open.js';
import { PROXY_DIR } from '../utils/paths.js';
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
        spawn('open', [exePath], { detached: true, stdio: 'ignore' }).unref();
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
        spawn(exePath, [], { detached: true, stdio: 'ignore' }).unref();
        return true;
      } catch {}
    }
  }
  return false;
}

export async function startCommand(opts: StartOptions): Promise<void> {
  const proxyPort = parseInt(opts.port || '443', 10);
  const apiPort = 4000;

  header('Antigravity Proxy', `v${JSON.parse(fs.readFileSync(path.join(PROXY_DIR, 'package.json'), 'utf-8')).version}`);

  // Simple mode: just launch Antigravity directly without proxy
  if (opts.simple) {
    section('Simple Mode');
    console.log(`  ${info('Launching Antigravity directly (no proxy)')}\n`);

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
  const depSpinner = startSpinner('Checking dependencies');
  const nodeModules = path.join(PROXY_DIR, 'node_modules');
  if (!fs.existsSync(nodeModules) && !fs.existsSync(path.join(PROXY_DIR, 'dist', 'index.js'))) {
    depSpinner.text = 'Installing dependencies...';
    execSync('npm install --production', { cwd: PROXY_DIR, stdio: 'pipe', timeout: 120000 });
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
  const certTrustedMarker = path.join(PROXY_DIR, 'certs', '.trusted');
  const shouldTrust = opts.trustCert || !fs.existsSync(certTrustedMarker);
  if (shouldTrust) {
    try {
      trustCert();
      fs.writeFileSync(certTrustedMarker, new Date().toISOString());
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
