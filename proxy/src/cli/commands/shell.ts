import chalk from 'chalk';
import { header, ok, info, error, section, statusBadge, startSpinner, succeedSpinner } from '../ui.js';
import { startProxy, isProxyRunning, stopProxy } from '../utils/process.js';
import { waitForHealth } from '../utils/process.js';
import { logBus } from '../../logger.js';

interface ShellOptions {
  port?: string;
}

export async function shellCommand(opts: ShellOptions): Promise<void> {
  const proxyPort = parseInt(opts.port || '443', 10);
  const apiPort = 4000;

  header('Antigravity Shell', 'Interactive monitoring mode');

  if (!isProxyRunning()) {
    console.log(`  ${info('Proxy is not running. Starting...')}`);
    const spinner = startSpinner('Starting proxy');
    const pid = startProxy({ proxyPort, apiPort, foreground: false });
    if (pid) {
      succeedSpinner(spinner, `Proxy started (PID ${pid})`);
    } else {
      error('Failed to start proxy');
      process.exit(1);
    }
    const healthy = await waitForHealth(apiPort);
    if (healthy) {
      console.log(`  ${ok('Dashboard ready')}`);
    }
  }

  section('Shell Commands');
  console.log(`  ${chalk.cyan('h')}  ${chalk.dim('— show this help')}`);
  console.log(`  ${chalk.cyan('s')}  ${chalk.dim('— show status')}`);
  console.log(`  ${chalk.cyan('l')}  ${chalk.dim('— tail last 5 log lines')}`);
  console.log(`  ${chalk.cyan('d')}  ${chalk.dim('— open dashboard')}`);
  console.log(`  ${chalk.cyan('q')}  ${chalk.dim('— quit shell')}`);
  console.log('');

  const { createInterface } = await import('readline');
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.cyan('antigravity> '),
  });

  rl.prompt();

  const logUnsub = logBus.on('log', (entry: any) => {
    if (entry.level === 'error') {
      process.stdout.write(`\r  ${chalk.red.bold(`[${entry.level.toUpperCase()}] ${entry.msg}`)}\n${chalk.cyan('antigravity> ')}`);
    }
  });

  rl.on('line', async (line: string) => {
    const cmd = line.trim().toLowerCase();

    if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') {
      rl.close();
      return;
    }

    if (cmd === 'h' || cmd === 'help') {
      console.log(`  ${chalk.cyan('h')}  ${chalk.dim('— show this help')}`);
      console.log(`  ${chalk.cyan('s')}  ${chalk.dim('— show status')}`);
      console.log(`  ${chalk.cyan('l')}  ${chalk.dim('— tail last 5 log lines')}`);
      console.log(`  ${chalk.cyan('d')}  ${chalk.dim('— open dashboard')}`);
      console.log(`  ${chalk.cyan('q')}  ${chalk.dim('— quit shell')}`);
    } else if (cmd === 's' || cmd === 'status') {
      const running = isProxyRunning();
      console.log(`  ${statusBadge(running)}`);
      if (running) {
        try {
          const res = await fetch(`http://localhost:${apiPort}/api/health`);
          if (res.ok) {
            const data = await res.json();
            console.log(`  ${chalk.dim('Uptime:')} ${Math.floor(data.uptime)}s`);
          }
        } catch {}
      }
    } else if (cmd === 'l' || cmd === 'logs') {
      const { getRecentLogs } = await import('../../logger.js');
      const logs = getRecentLogs(5);
      for (const log of logs) {
        console.log(`  ${chalk.dim(`[${log.timestamp}]`)} ${chalk.cyan(`[${log.level.toUpperCase()}]`)} ${log.msg}`);
      }
    } else if (cmd === 'd' || cmd === 'dashboard') {
      const { openUrl } = await import('../utils/open.js');
      openUrl(`http://localhost:${apiPort}`);
      console.log(`  ${ok('Dashboard opened')}`);
    } else if (cmd) {
      console.log(`  ${chalk.yellow(`Unknown command: ${cmd}`)}`);
    }

    rl.prompt();
  });

  rl.on('close', () => {
    console.log(`\n  ${info('Shell closed')}`);
    console.log(`  ${chalk.cyan('Run `antigravity shell` to reopen.')}`);
    process.exit(0);
  });
}
