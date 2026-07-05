#!/usr/bin/env node
import { Command } from 'commander';
import { createRequire } from 'module';
import { execSync, spawn } from 'child_process';
import { platform } from 'os';

const require = createRequire(import.meta.url);
const pkg = require('../package.json');

// Commands that need admin privileges on Windows
const ADMIN_COMMANDS = ['start', 'switch', 'remove', 'setup', 'certs'];

function isAdmin() {
  if (platform() !== 'win32') return true;
  try {
    execSync('net session', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function elevateAndRun() {
  const args = process.argv.slice(2);
  const cmd = args[0] || '';

  // Only elevate on Windows, for commands that need it
  if (platform() !== 'win32' || !ADMIN_COMMANDS.includes(cmd)) return false;
  if (isAdmin()) return false;

  console.log('\n  This command requires Administrator privileges.\n');

  // Build the full command line
  const nodeExe = process.execPath;
  const scriptPath = process.argv[1];
  const fullArgs = [scriptPath, ...args].map(a => `"${a}"`).join(' ');

  // Use cmd /c start /wait to run elevated and wait for completion
  // This shows UAC, runs in a new console, and blocks until done
  try {
    const psCmd = `Start-Process -FilePath '${nodeExe}' -ArgumentList '${fullArgs}' -Verb RunAs -Wait`;
    execSync(`powershell -NoProfile -Command "${psCmd}"`, { stdio: 'inherit', timeout: 300000 });
    return true;
  } catch {
    console.log('  Failed to elevate. Run this terminal as Administrator.\n');
    process.exit(1);
  }
}

// Try to elevate if needed — this may exit the process
if (elevateAndRun()) {
  process.exit(0);
}

import { startCommand } from '../dist/cli/commands/start.js';
import { stopCommand } from '../dist/cli/commands/stop.js';
import { statusCommand } from '../dist/cli/commands/status.js';
import { healthCommand } from '../dist/cli/commands/health.js';
import { configCommand } from '../dist/cli/commands/config.js';
import { logsCommand } from '../dist/cli/commands/logs.js';
import { certsCommand } from '../dist/cli/commands/certs.js';
import { setupCommand } from '../dist/cli/commands/setup.js';
import { shellCommand } from '../dist/cli/commands/shell.js';
import { switchCommand } from '../dist/cli/commands/switch.js';
import { removeCommand } from '../dist/cli/commands/remove.js';

const program = new Command();

program
  .name('antigravity')
  .description('LLM proxy for Antigravity — translate Google Gemini API calls to any provider')
  .version(pkg.version);

program
  .command('start')
  .description('Start the proxy and dashboard')
  .option('-p, --port <port>', 'proxy port', '443')
  .option('--no-browser', 'do not open dashboard in browser')
  .option('-f, --foreground', 'run in foreground (do not detach)')
  .option('--trust-cert', 'auto-trust TLS certificate')
  .option('-s, --simple', 'launch Antigravity directly without proxy')
  .action(startCommand);

program
  .command('stop')
  .description('Stop the running proxy')
  .action(stopCommand);

program
  .command('status')
  .description('Show proxy status and uptime')
  .option('--json', 'output as JSON')
  .action(statusCommand);

program
  .command('health')
  .description('Check proxy health endpoint')
  .option('--json', 'output as JSON')
  .action(healthCommand);

program
  .command('config')
  .description('Show or update configuration')
  .argument('[action]', 'show, get, or set')
  .argument('[key]', 'environment variable name')
  .argument('[value]', 'value to set (for set action)')
  .option('--json', 'output as JSON')
  .action(configCommand);

program
  .command('logs')
  .description('View proxy logs')
  .argument('[action]', 'tail, list, or show')
  .argument('[file]', 'log filename (for show action)')
  .action(logsCommand);

program
  .command('certs')
  .description('Manage TLS certificates')
  .argument('[action]', 'show, generate, or trust')
  .action(certsCommand);

program
  .command('setup')
  .description('Run the onboarding wizard')
  .action(setupCommand);

program
  .command('shell')
  .description('Interactive monitoring shell')
  .option('-p, --port <port>', 'proxy port', '443')
  .action(shellCommand);

program
  .command('switch')
  .description('Switch between proxy and simple mode')
  .action(switchCommand);

program
  .command('remove')
  .description('Remove proxy artifacts and clean up')
  .action(removeCommand);

program.parse();
