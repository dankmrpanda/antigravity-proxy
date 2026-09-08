import { isProxyRunning, getProxyPid } from '../utils/process.js';
import { config } from '../../config.js';
import chalk from 'chalk';
import { section, ok, fail, header, statusBadge, valueBadge, elapsed, startSpinner, succeedSpinner, failSpinner, warnSpinner, error } from '../ui.js';

interface StatusOptions {
  json?: boolean;
}

export async function statusCommand(opts: StatusOptions): Promise<void> {
  const running = isProxyRunning();
  const pid = getProxyPid();

  let healthData: any = null;
  if (running) {
    const spinner = startSpinner('Fetching health data');
    try {
      const res = await fetch(`http://localhost:${config.apiPort}/api/health`);
      if (res.ok) healthData = await res.json();
      succeedSpinner(spinner, 'Health data received');
    } catch {
      warnSpinner(spinner, 'Could not reach dashboard');
    }
  }

  if (opts?.json) {
    console.log(JSON.stringify({ running, pid, health: healthData }, null, 2));
    return;
  }

  header('Antigravity Proxy Status');

  console.log(`  ${statusBadge(running)}`);

  if (running) {
    console.log(`  ${valueBadge('PID', String(pid))}`);
    if (healthData) {
      console.log(`  ${valueBadge('Uptime', elapsed(Math.floor(healthData.uptime * 1000)))}`);
      const healthLabel = healthData.status === 'ok' ? chalk.green(healthData.status) : chalk.yellow(healthData.status);
      console.log(`  ${valueBadge('Health', healthLabel)}`);
    }
    section('Endpoints');
    console.log(`  ${valueBadge('Dashboard', `http://localhost:${config.apiPort}`)}`);
    console.log(`  ${valueBadge('TLS Proxy', `https://localhost:${config.proxyPort}`)}`);
  } else {
    console.log(`  ${valueBadge('Status', 'Stopped')}`);
    console.log('');
    console.log(`  ${chalk.cyan('Run `antigravity start` to start the proxy.')}`);
  }

  console.log('');
}
