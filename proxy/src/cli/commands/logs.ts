import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';
import chalk from 'chalk';
import { LOGS_DIR } from '../utils/paths.js';
import { header, section, warn, info, error, table, formatBytes, divider } from '../ui.js';

function getLogFiles(): string[] {
  try {
    return fs.readdirSync(LOGS_DIR)
      .filter(f => f.startsWith('proxy_') && f.endsWith('.log'))
      .sort()
      .reverse();
  } catch { return []; }
}

const LOG_COLORS = {
  ERROR: chalk.red,
  WARN: chalk.yellow,
  INFO: chalk.cyan,
  DEBUG: chalk.dim,
} as const;

export function logsCommand(action?: string, file?: string): void {
  if (!action || action === 'tail') {
    const files = getLogFiles();
    if (files.length === 0) {
      header('Proxy Logs');
      console.log(`  ${warn('No log files found')}`);
      return;
    }
    const latest = path.join(LOGS_DIR, files[0]);
    header(`Tailing: ${chalk.dim(files[0])}`);
    console.log(`  ${info('Ctrl+C to stop')}\n`);

    const rl = createInterface({ input: createReadStream(latest), crlfDelay: Infinity });
    let lineCount = 0;
    rl.on('line', (line: string) => {
      lineCount++;
      const colored = colorizeLogLine(line);
      console.log(colored);
    });
    rl.on('close', () => {
      console.log(`\n  ${info(`End of log (${lineCount} lines shown)`)}`);
    });
    return;
  }

  if (action === 'list') {
    const files = getLogFiles();
    header('Log Files');

    if (files.length === 0) {
      console.log(`  ${warn('No log files found')}`);
      return;
    }

    const rows = files.map(f => {
      const stat = fs.statSync(path.join(LOGS_DIR, f));
      return [f, formatBytes(stat.size)];
    });

    table(['Filename', 'Size'], rows);
    return;
  }

  if (action === 'show' && file) {
    const filepath = path.join(LOGS_DIR, path.basename(file));
    if (!fs.existsSync(filepath)) {
      error(`Log file not found: ${file}`);
      process.exit(1);
    }
    header(`Showing: ${chalk.dim(file)}`);
    const content = fs.readFileSync(filepath, 'utf-8');
    for (const line of content.split('\n')) {
      console.log(colorizeLogLine(line));
    }
    return;
  }

  error('Usage: antigravity logs [tail|list|show <file>]', 'Try `antigravity logs list` to see available files');
  process.exit(1);
}

function colorizeLogLine(line: string): string {
  const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/);
  if (levelMatch) {
    const level = levelMatch[1] as keyof typeof LOG_COLORS;
    const color = LOG_COLORS[level] || chalk.dim;
    return line.replace(/\[(ERROR|WARN|INFO|DEBUG)\]/, (m) => color.bold(m));
  }
  return chalk.dim(line);
}
