import { execSync } from 'child_process';
import { platform } from 'os';
import { stopProxy, isProxyRunning } from '../utils/process.js';
import { killProcessesOnPorts } from '../utils/port.js';
import { header, section, ok, warn, info, error, divider } from '../ui.js';

function killAntigravityDesktop(): boolean {
  const p = platform();
  let killed = false;

  if (p !== 'win32') {
    try {
      const cmd = p === 'darwin' ? 'pkill -f Antigravity 2>/dev/null' : 'pkill -f antigravity 2>/dev/null';
      execSync(cmd, { stdio: 'ignore', timeout: 5000 });
      killed = true;
    } catch {}
    return killed;
  }

  try {
    execSync('taskkill /F /IM Antigravity.exe', { stdio: 'ignore', timeout: 3000 });
    killed = true;
  } catch {}

  try {
    execSync('taskkill /F /IM antigravity-desktop.exe', { stdio: 'ignore', timeout: 3000 });
    killed = true;
  } catch {}

  try {
    execSync(
      `powershell -NoProfile -Command "Get-Process | Where-Object { $_.CommandLine -match 'antigravity' } | Stop-Process -Force"`,
      { stdio: 'ignore', timeout: 5000 }
    );
    killed = true;
  } catch {}

  return killed;
}

export async function stopCommand(): Promise<void> {
  header('Stopping Antigravity');

  section('Killing desktop app');
  console.log(`  ${info('Checking for Antigravity desktop...')}`);
  const desktopKilled = killAntigravityDesktop();
  if (desktopKilled) {
    console.log(`  ${ok('Desktop app stopped')}`);
  } else {
    console.log(`  ${warn('Desktop app not running or already closed')}`);
  }

  section('Killing proxy');
  const proxyRunning = isProxyRunning();
  if (proxyRunning) {
    console.log(`  ${info('Stopping proxy...')}`);
    const stopped = stopProxy();
    if (stopped) {
      console.log(`  ${ok('Proxy stopped by PID')}`);
    } else {
      console.log(`  ${warn('PID file not found — killing by port')}`);
      killProcessesOnPorts([443, 8443, 4000]);
      console.log(`  ${ok('Ports cleared')}`);
    }
  } else {
    console.log(`  ${info('Proxy not running — cleaning up ports anyway')}`);
    killProcessesOnPorts([443, 8443, 4000]);
    console.log(`  ${ok('Ports cleared')}`);
  }

  divider();
  console.log(`  ${ok('All stopped')}`);
  console.log(`  ${info('Run')} ${info('antigravity start')} ${info('to start again.')}`);
  console.log('');
}
