import fs from 'fs';
import path from 'path';
import chalk from 'chalk';
import { USER_ENV_PATH as ENV_PATH, ENV_EXAMPLE } from '../utils/paths.js';
import { header, section, ok, warn, info, confirm, prompt, select, maskKey, arrow, divider } from '../ui.js';

const PROVIDERS = [
  { id: 'meta', name: 'Meta Model API (Muse Spark)', envKey: 'MODEL_API_KEY', placeholder: '...' },
  { id: 'openrouter', name: 'OpenRouter', envKey: 'OPENROUTER_API_KEY', placeholder: 'sk-or-v1-...' },
  { id: 'nvidia', name: 'NVIDIA', envKey: 'NVIDIA_API_KEY', placeholder: 'nvapi-...' },
  { id: 'openai', name: 'OpenAI', envKey: 'OPENAI_API_KEY', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', envKey: 'ANTHROPIC_API_KEY', placeholder: 'sk-ant-...' },
  { id: 'groq', name: 'Groq', envKey: 'GROQ_API_KEY', placeholder: 'gsk_...' },
  { id: 'google', name: 'Google AI', envKey: 'GOOGLE_API_KEY', placeholder: 'AIza...' },
  { id: 'zen', name: 'OpenCode Zen', envKey: 'OPENCODE_API_KEY', placeholder: 'sk-...' },
  { id: 'opencode-go', name: 'OpenCode Go', envKey: 'OPENCODE_GO_API_KEY', placeholder: 'sk-...' },
  { id: 'ollama', name: 'Ollama (local)', envKey: '', placeholder: '' },
  { id: 'vllm', name: 'vLLM (local)', envKey: '', placeholder: '' },
  { id: 'lmstudio', name: 'LM Studio (local)', envKey: '', placeholder: '' },
];

function ensureEnvExists(): void {
  if (!fs.existsSync(ENV_PATH) && fs.existsSync(ENV_EXAMPLE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_PATH);
  }
}

function readEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const raw = fs.readFileSync(ENV_PATH, 'utf-8');
    for (const line of raw.split('\n')) {
      const m = line.match(/^([A-Z_]+)=(.*)/);
      if (m) result[m[1]] = m[2].trim();
    }
  } catch {}
  return result;
}

function writeEnv(updates: Record<string, string>): void {
  let raw = '';
  try { raw = fs.readFileSync(ENV_PATH, 'utf-8'); } catch { raw = ''; }
  for (const [k, v] of Object.entries(updates)) {
    const re = new RegExp(`^${k}=.*`, 'm');
    if (re.test(raw)) raw = raw.replace(re, `${k}=${v}`);
    else raw += `\n${k}=${v}`;
  }
  fs.writeFileSync(ENV_PATH, raw, 'utf-8');
}

export async function setupCommand(): Promise<void> {
  ensureEnvExists();

  const env = readEnv();

  header('Antigravity Setup Wizard');
  console.log(`  ${chalk.dim("Let's configure your proxy in a few steps.")}\n`);

  const existingKeys = Object.keys(env).filter(k => k.includes('API_KEY') && env[k]);
  if (existingKeys.length > 0) {
    section('Existing Configuration');
    for (const k of existingKeys) {
      console.log(`  ${chalk.cyan(k)}${chalk.dim('=')}${maskKey(env[k])}`);
    }
    console.log('');
    const keep = await confirm('Keep existing configuration?', true);
    if (!keep) {
      console.log(`  ${info('Starting fresh')}\n`);
    } else {
      console.log(`  ${ok('Preserving existing config')}\n`);
    }
  }

  section('Step 1: Choose Provider');
  const providerChoices = PROVIDERS.map(p => ({ name: p.name, value: p.id }));
  const providerId = await select('Select your LLM provider:', providerChoices);
  const provider = PROVIDERS.find(p => p.id === providerId)!;
  console.log(`  ${arrow(`Selected: ${chalk.bold(provider.name)}`)}\n`);

  section('Step 2: API Key');
  let apiKey = '';
  if (provider.envKey) {
    const existingKey = env[provider.envKey] || '';
    if (existingKey && existingKey !== `sk-...` && !existingKey.startsWith('sk-...')) {
      console.log(`  ${info(`Existing key: ${maskKey(existingKey)}`)}`);
      const keep = await confirm('Keep existing key?', true);
      if (keep) {
        apiKey = existingKey;
        console.log(`  ${ok('Keeping existing key')}\n`);
      }
    }
    if (!apiKey) {
      apiKey = await prompt(`Enter your ${provider.name} API key:`);
      if (apiKey) {
        console.log(`  ${arrow(`Key: ${maskKey(apiKey)}`)}\n`);
      } else {
        console.log(`  ${warn('Skipped — set it later from the dashboard Config tab')}\n`);
      }
    }
  }

  section('Step 3: Proxy Port');
  const currentPort = env['PROXY_PORT'] || '443';
  const portChoices = [
    { name: `443   (default, requires admin/root)`, value: '443' },
    { name: `8443  (no admin needed)`, value: '8443' },
  ];
  const defaultPort = currentPort === '8443' ? '8443' : '443';
  const proxyPort = await select(`Select proxy port [current: ${currentPort}]:`, portChoices);
  console.log(`  ${arrow(`Port: ${chalk.bold(proxyPort)}`)}\n`);

  section('Step 4: Context Mode');
  const currentMode = env['CONTEXT_STRIP_MODE'] || 'passthrough';
  const contextChoices = [
    { name: `lite (recommended) — compressed context, ~66% fewer tokens`, value: 'lite' },
    { name: `strip — remove skills/plugins, inject full agent-context.md`, value: 'strip' },
    { name: `passthrough — send full Antigravity context unchanged`, value: 'passthrough' },
  ];
  const contextMode = await select(`Context strip mode [current: ${currentMode}]:`, contextChoices);
  console.log(`  ${arrow(`Mode: ${chalk.bold(contextMode)}`)}\n`);

  section('Step 5: Certificate Trust');
  const trustCerts = await confirm('Auto-trust TLS certificate on this machine?', true);
  console.log(`  ${trustCerts ? ok('Will trust certificates') : warn('Will skip certificate trust')}\n`);

  section('Step 6: Dashboard Auth');
  const existingUser = env['DASHBOARD_USER'] || '';
  if (existingUser) {
    console.log(`  ${info(`Existing auth user: ${existingUser}`)}`);
    const keep = await confirm('Keep existing auth?', true);
    if (keep) {
      console.log(`  ${ok('Keeping existing auth')}\n`);
    } else {
      const dashUser = await prompt('Username:', existingUser);
      const dashPass = await prompt('Password:');
      if (dashUser && dashPass) {
        writeEnv({
          'DASHBOARD_USER': dashUser,
          'DASHBOARD_PASSWORD': dashPass,
          'PROVIDER_PRIORITY': providerId,
          ...(apiKey && provider.envKey ? { [provider.envKey]: apiKey } : {}),
          'PROXY_PORT': proxyPort,
          'CONTEXT_STRIP_MODE': contextMode,
        });
      }
    }
    if (keep) {
      writeEnv({
        'PROVIDER_PRIORITY': providerId,
        ...(apiKey && provider.envKey ? { [provider.envKey]: apiKey } : {}),
        'PROXY_PORT': proxyPort,
        'CONTEXT_STRIP_MODE': contextMode,
      });
    }
  } else {
    const enableAuth = await confirm('Enable dashboard authentication?', false);
    let dashUser = '';
    let dashPass = '';
    if (enableAuth) {
      dashUser = await prompt('Username:');
      dashPass = await prompt('Password:');
    }
    writeEnv({
      'PROVIDER_PRIORITY': providerId,
      ...(apiKey && provider.envKey ? { [provider.envKey]: apiKey } : {}),
      'PROXY_PORT': proxyPort,
      'CONTEXT_STRIP_MODE': contextMode,
      'DASHBOARD_USER': dashUser,
      'DASHBOARD_PASSWORD': dashPass,
    });
  }

  divider();
  console.log(`  ${ok('Configuration saved!')}`);
  console.log(`  ${info(`File: ${chalk.dim(ENV_PATH)}`)}\n`);

  const startNow = await confirm('Start the proxy now?', true);
  if (startNow) {
    console.log('');
    const { startCommand } = await import('./start.js');
    await startCommand({ port: proxyPort, browser: true, trustCert: trustCerts });
  } else {
    console.log(`  ${arrow('Run `antigravity start` when ready.')}`);
    console.log(`  ${arrow('Run `antigravity start --trust-cert` to auto-trust the TLS cert.')}`);
    console.log('');
  }
}
