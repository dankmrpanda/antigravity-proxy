import chalk from 'chalk';
import { config } from '../../config.js';
import { header, valueBadge, elapsed, startSpinner, succeedSpinner, failSpinner, error as showError } from '../ui.js';

interface HealthOptions {
  json?: boolean;
}

export async function healthCommand(opts: HealthOptions): Promise<void> {
  const spinner = startSpinner('Checking proxy health');

  try {
    const res = await fetch(`http://localhost:${config.apiPort}/api/health`);
    const data = await res.json();

    succeedSpinner(spinner, 'Proxy is healthy');

    if (opts?.json) {
      console.log(JSON.stringify(data, null, 2));
      return;
    }

    header('Health Check');

    const statusColor = data.status === 'ok' ? chalk.green : chalk.yellow;
    console.log(`  Status:    ${statusColor.bold(data.status)}`);
    console.log(`  ${valueBadge('Uptime', elapsed(Math.floor(data.uptime * 1000)))}`);
    console.log(`  ${valueBadge('Timestamp', data.timestamp)}`);
    console.log('');
  } catch (e: any) {
    failSpinner(spinner, 'Cannot reach proxy');

    if (opts?.json) {
      console.log(JSON.stringify({ status: 'error', error: e.message }));
    } else {
      showError(`Cannot reach proxy: ${e.message}`, 'Is the proxy running? Try `antigravity start`');
    }
    process.exit(1);
  }
}
