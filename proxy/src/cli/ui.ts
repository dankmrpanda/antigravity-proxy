import chalk from 'chalk';
import ora from 'ora';

export type Spinner = ReturnType<typeof ora>;

export function ok(text: string): string {
  return chalk.green('✔') + ' ' + text;
}

export function fail(text: string): string {
  return chalk.red('✘') + ' ' + text;
}

export function warn(text: string): string {
  return chalk.yellow('⚠') + ' ' + text;
}

export function info(text: string): string {
  return chalk.blue('ℹ') + ' ' + text;
}

export function arrow(text: string): string {
  return chalk.cyan('→') + ' ' + text;
}

export function section(title: string): void {
  const line = chalk.dim('─'.repeat(50));
  console.log(`\n  ${chalk.bold(title)}`);
  console.log(`  ${line}`);
}

export function header(title: string, subtitle?: string): void {
  console.log('');
  console.log(`  ${chalk.bold.cyan('══════════════════════════════════════════════')}`);
  console.log(`  ${chalk.bold.cyan('  ' + title)}`);
  if (subtitle) {
    console.log(`  ${chalk.dim(subtitle)}`);
  }
  console.log(`  ${chalk.bold.cyan('══════════════════════════════════════════════')}`);
}

export function step(num: number, total: number, text: string): string {
  return chalk.cyan(`[${num}/${total}]`) + ' ' + text;
}

export function startSpinner(text: string): Spinner {
  return ora({ text, color: 'cyan' }).start();
}

export function succeedSpinner(spinner: Spinner, text?: string): void {
  spinner.succeed(text || spinner.text);
}

export function failSpinner(spinner: Spinner, text?: string): void {
  spinner.fail(text || spinner.text);
}

export function warnSpinner(spinner: Spinner, text?: string): void {
  spinner.warn(text || spinner.text);
}

export function elapsed(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60000);
  const s = Math.round((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function maskKey(key: string): string {
  if (!key || key.length < 10) return key || '';
  return key.slice(0, 6) + chalk.dim('***') + key.slice(-4);
}

export function table(headers: string[], rows: string[][]): void {
  if (rows.length === 0) {
    console.log(`  ${chalk.dim('(empty)')}`);
    return;
  }

  const colWidths = headers.map((h, i) => {
    const maxData = rows.reduce((max, r) => Math.max(max, r[i]?.length || 0), 0);
    return Math.max(h.length, maxData) + 2;
  });

  const hLine = '  ' + colWidths.map(w => chalk.dim('─'.repeat(w))).join(' ') + ' ';

  console.log(hLine);
  console.log('  ' + headers.map((h, i) => chalk.bold(h.padEnd(colWidths[i]))).join(' '));
  console.log(hLine);

  for (const row of rows) {
    console.log('  ' + row.map((c, i) => c.padEnd(colWidths[i])).join(' '));
  }
  console.log(hLine);
}

export function statusBadge(running: boolean): string {
  return running ? chalk.green.bold('● RUNNING') : chalk.red.bold('● STOPPED');
}

export function valueBadge(label: string, value: string): string {
  return `  ${chalk.dim(label + ':')} ${chalk.white(value)}`;
}

export async function confirm(prompt: string, defaultYes = true): Promise<boolean> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const hint = defaultYes ? 'Y/n' : 'y/N';
  return new Promise((resolve) => {
    rl.question(`  ${chalk.cyan('?')} ${prompt} ${chalk.dim(`[${hint}]`)} `, (answer) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      if (a === '') resolve(defaultYes);
      else resolve(a === 'y' || a === 'yes');
    });
  });
}

export async function prompt(prompt: string, defaultValue?: string): Promise<string> {
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const fullPrompt = defaultValue
    ? `  ${chalk.cyan('?')} ${prompt} ${chalk.dim(`[${defaultValue}]`)} `
    : `  ${chalk.cyan('?')} ${prompt} `;
  return new Promise((resolve) => {
    rl.question(fullPrompt, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultValue || '');
    });
  });
}

export async function select(prompt: string, choices: { name: string; value: string }[]): Promise<string> {
  console.log(`  ${chalk.cyan('?')} ${prompt}`);
  for (let i = 0; i < choices.length; i++) {
    console.log(`    ${chalk.cyan(String(i + 1))}. ${choices[i].name}`);
  }
  const { createInterface } = await import('readline');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`  ${chalk.dim('Enter number')} `, (answer) => {
      rl.close();
      const idx = parseInt(answer.trim(), 10) - 1;
      if (idx >= 0 && idx < choices.length) {
        resolve(choices[idx].value);
      } else {
        resolve(choices[0].value);
      }
    });
  });
}

export function error(message: string, hint?: string): void {
  console.error(`\n  ${chalk.red.bold('ERROR')} ${message}`);
  if (hint) {
    console.error(`  ${chalk.yellow('TIP')}   ${hint}`);
  }
}

export function success(message: string): void {
  console.log(`  ${chalk.green.bold('OK')} ${message}`);
}

export function divider(): void {
  console.log(`  ${chalk.dim('─'.repeat(50))}`);
}
