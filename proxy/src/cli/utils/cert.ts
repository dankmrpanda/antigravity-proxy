import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { platform } from 'os';
import { PROXY_DIR } from './paths.js';
import { USER_CERTS_DIR, USER_CERT_FILE, USER_KEY_FILE } from '../../data-paths.js';

const CERT_DIR = USER_CERTS_DIR;
const CERT_FILE = USER_CERT_FILE;
const KEY_FILE = USER_KEY_FILE;

export function certExists(): boolean {
  return fs.existsSync(CERT_FILE) && fs.existsSync(KEY_FILE);
}

export function generateCerts(): void {
  const scriptPath = path.resolve(PROXY_DIR, 'scripts', 'gen-certs.mjs');
  if (fs.existsSync(scriptPath)) {
    execSync(`node "${scriptPath}"`, { stdio: 'inherit', timeout: 30000 });
  } else {
    throw new Error('Certificate generation script not found');
  }
}

export function isAdmin(): boolean {
  if (platform() !== 'win32') return false;
  try {
    const out = execSync('net session', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function isCertTrusted(): boolean {
  if (platform() !== 'win32' || !certExists()) return false;
  try {
    const lines = fs.readFileSync(CERT_FILE, 'utf-8').split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    const derBytes = Buffer.from(b64, 'base64');
    const crypto = require('crypto');
    const sha1 = crypto.createHash('sha1').update(derBytes).digest('hex').toUpperCase();
    const out = execSync(
      `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Measure-Object | Select-Object -ExpandProperty Count"`,
      { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return out.trim() !== '0';
  } catch {
    return false;
  }
}

export function trustCert(): void {
  if (!certExists()) {
    throw new Error('No certificate to trust. Run `antigravity certs generate` first.');
  }

  // Check if already trusted (skip if so)
  if (isCertTrusted()) {
    return;
  }

  const p = platform();
  if (p === 'win32') {
    // Use PowerShell Import-Certificate (same as start.ps1)
    // This matches the approach that works in the PowerShell launcher
    try {
      execSync(
        `powershell -NoProfile -Command "Import-Certificate -FilePath '${CERT_FILE}' -CertStoreLocation Cert:\\LocalMachine\\Root"`,
        { stdio: 'pipe', timeout: 15000 }
      );
      return;
    } catch {
      // If Import-Certificate fails (no admin), try certutil
      try {
        execSync(`certutil -addstore -f Root "${CERT_FILE}"`, { stdio: 'pipe', timeout: 15000 });
        return;
      } catch {
        // Both failed — try with UAC elevation
        try {
          execSync(
            `powershell -NoProfile -Command "Start-Process certutil -ArgumentList '-addstore','-f','Root','${CERT_FILE}' -Verb RunAs -Wait"`,
            { stdio: 'inherit', timeout: 30000 }
          );
          return;
        } catch {
          throw new Error('Failed to add certificate to Windows trust store. Run as Administrator.');
        }
      }
    }
  } else if (p === 'darwin') {
    try {
      execSync(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${CERT_FILE}"`, {
        stdio: 'inherit', timeout: 30000,
      });
    } catch {
      throw new Error('Failed to add certificate to macOS keychain. Run with sudo.');
    }
  } else {
    // Linux
    const trustDir = '/usr/local/share/ca-certificates';
    try {
      execSync(`sudo cp "${CERT_FILE}" "${trustDir}/antigravity-proxy.crt" && sudo update-ca-certificates`, {
        stdio: 'inherit', timeout: 15000,
      });
    } catch {
      throw new Error('Failed to trust certificate. Run: sudo update-ca-certificates');
    }
  }
}

const PROXY_HOSTS_ENTRIES = [
  '127.0.0.1 cloudcode-pa.googleapis.com',
  '127.0.0.1 daily-cloudcode-pa.googleapis.com',
  '127.0.0.1  runtime.us-east-1.kiro.dev',
  '127.0.0.1  kiro.dev',
  '127.0.0.1  app.kiro.dev',
];

// Run a PowerShell command with UAC elevation without opening a new window
function runElevated(psCommand: string): boolean {
  if (platform() !== 'win32') return false;

  try {
    // Create a VBScript that uses ShellExecute with "runas" to elevate silently
    const vbsScript = `
      Set objShell = CreateObject("Shell.Application")
      objShell.ShellExecute "powershell.exe", "-NoProfile -NonInteractive -Command ""${psCommand.replace(/"/g, '""')}""", "", "runas", 1
    `.trim();

    const vbsFile = path.join(process.env.TEMP || '', 'antigravity_elevate.vbs');
    fs.writeFileSync(vbsFile, vbsScript, 'utf-8');

    // Run VBScript and wait for it to complete
    execSync(`cscript //nologo "${vbsFile}"`, { stdio: 'pipe', timeout: 30000 });

    // Clean up
    try { fs.unlinkSync(vbsFile); } catch {}

    return true;
  } catch {
    return false;
  }
}

export interface HostsCleanResult {
  found: boolean;
  cleaned: boolean;
  error?: string;
}

export function cleanHostsFile(): HostsCleanResult {
  const hostsPath = platform() === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

  try {
    let content = fs.readFileSync(hostsPath, 'utf-8');
    let found = false;

    for (const entry of PROXY_HOSTS_ENTRIES) {
      // Check with various spacing patterns
      const patterns = [
        entry,
        entry.replace('127.0.0.1 ', '127.0.0.1  '),
        entry.replace('127.0.0.1  ', '127.0.0.1 '),
      ];
      for (const pattern of patterns) {
        if (content.includes(pattern)) {
          found = true;
          content = content.split('\n').filter(line => line.trim() !== pattern.trim()).join('\n');
        }
      }
    }

    if (!found) {
      return { found: false, cleaned: false };
    }

    // Clean up multiple blank lines
    content = content.replace(/\n{3,}/g, '\n\n');

    // Try direct write first
    try {
      fs.writeFileSync(hostsPath, content, 'utf-8');
      return { found: true, cleaned: true };
    } catch {
      // Direct write failed (no admin) — try UAC elevation on Windows
      if (platform() === 'win32') {
        return cleanHostsFileWithUAC(content);
      }
      return { found: true, cleaned: false, error: 'Requires admin privileges' };
    }
  } catch {
    return { found: false, cleaned: false, error: 'Could not read hosts file' };
  }
}

function cleanHostsFileWithUAC(content: string): HostsCleanResult {
  try {
    const tmpFile = path.join(process.env.TEMP || '', 'antigravity_hosts.txt');
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const psCommand = `Copy-Item -Path '${tmpFile}' -Destination 'C:\\Windows\\System32\\drivers\\etc\\hosts' -Force`;
    const result = runElevated(psCommand);

    try { fs.unlinkSync(tmpFile); } catch {}

    if (!result) {
      return { found: true, cleaned: false, error: 'UAC elevation denied or failed' };
    }

    // Verify the cleanup worked
    const verifyContent = fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts', 'utf-8');
    const stillHasEntries = PROXY_HOSTS_ENTRIES.some(e => verifyContent.includes(e.trim()));

    if (stillHasEntries) {
      return { found: true, cleaned: false, error: 'Hosts file was not updated' };
    }
    return { found: true, cleaned: true };
  } catch {
    return { found: true, cleaned: false, error: 'UAC elevation failed' };
  }
}

export function setupHostsFile(): HostsCleanResult {
  const hostsPath = platform() === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';

  try {
    let content = fs.readFileSync(hostsPath, 'utf-8');
    const entriesToAdd: string[] = [];

    for (const entry of PROXY_HOSTS_ENTRIES) {
      // Check if entry already exists (with any spacing)
      const alreadyExists = content.includes('cloudcode-pa.googleapis.com') && entry.includes('cloudcode-pa.googleapis.com')
        || content.includes('daily-cloudcode-pa.googleapis.com') && entry.includes('daily-cloudcode-pa.googleapis.com')
        || content.includes('runtime.us-east-1.kiro.dev') && entry.includes('runtime.us-east-1.kiro.dev')
        || (content.includes('kiro.dev') && !content.includes('daily-cloudcode') && entry.includes('kiro.dev') && !entry.includes('daily'));

      if (!alreadyExists) {
        entriesToAdd.push(entry);
      }
    }

    if (entriesToAdd.length === 0) {
      return { found: true, cleaned: true }; // Already set up
    }

    // Add entries with a comment header
    const marker = '# Antigravity Proxy';
    if (!content.includes(marker)) {
      content = content.trimEnd() + '\n\n' + marker + '\n';
    }
    content = content.trimEnd() + '\n' + entriesToAdd.join('\n') + '\n';

    // Try direct write first
    try {
      fs.writeFileSync(hostsPath, content, 'utf-8');
      return { found: true, cleaned: true };
    } catch {
      // Direct write failed (no admin) — try UAC elevation on Windows
      if (platform() === 'win32') {
        return setupHostsFileWithUAC(content);
      }
      return { found: true, cleaned: false, error: 'Requires admin privileges' };
    }
  } catch {
    return { found: false, cleaned: false, error: 'Could not read hosts file' };
  }
}

function setupHostsFileWithUAC(content: string): HostsCleanResult {
  try {
    const tmpFile = path.join(process.env.TEMP || '', 'antigravity_hosts.txt');
    fs.writeFileSync(tmpFile, content, 'utf-8');

    const psCommand = `Copy-Item -Path '${tmpFile}' -Destination 'C:\\Windows\\System32\\drivers\\etc\\hosts' -Force`;
    const result = runElevated(psCommand);

    try { fs.unlinkSync(tmpFile); } catch {}

    if (!result) {
      return { found: true, cleaned: false, error: 'UAC elevation denied or failed' };
    }

    // Verify setup worked
    const verifyContent = fs.readFileSync('C:\\Windows\\System32\\drivers\\etc\\hosts', 'utf-8');
    const hasEntries = PROXY_HOSTS_ENTRIES.every(e => verifyContent.includes(e.trim().split(' ')[1]));

    if (!hasEntries) {
      return { found: true, cleaned: false, error: 'Hosts file was not updated' };
    }
    return { found: true, cleaned: true };
  } catch {
    return { found: true, cleaned: false, error: 'UAC elevation failed' };
  }
}

export function untrustCert(): void {
  const p = platform();
  if (certExists()) {
    if (p === 'win32') {
      try {
        const lines = fs.readFileSync(CERT_FILE, 'utf-8').split('\n').filter(l => !l.startsWith('-----') && l.trim());
        const b64 = lines.join('');
        const derBytes = Buffer.from(b64, 'base64');
        const crypto = require('crypto');
        const sha1 = crypto.createHash('sha1').update(derBytes).digest('hex').toUpperCase();

        execSync(
          `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Remove-Item"`,
          { stdio: 'pipe', timeout: 15000 }
        );
      } catch {
        // Certificate may not be trusted — continue silently
      }
    } else if (p === 'darwin') {
      try {
        execSync('sudo security delete-certificate -c "localhost" -t /Library/Keychains/System.keychain', {
          stdio: 'inherit', timeout: 15000,
        });
      } catch {
        // Certificate may not be in keychain — continue silently
      }
    } else {
      try {
        execSync('sudo rm -f /usr/local/share/ca-certificates/antigravity-proxy.crt && sudo update-ca-certificates', {
          stdio: 'inherit', timeout: 15000,
        });
      } catch {
        // Certificate may not exist — continue silently
      }
    }
  }

  // Always clean up hosts file entries that route traffic to the proxy
  cleanHostsFile();
}

export interface CertInfo {
  exists: boolean;
  subject?: string;
  issuer?: string;
  validFrom?: string;
  validTo?: string;
  fingerprint?: string;
  daysRemaining?: number;
}

export function getCertInfo(): CertInfo {
  if (!certExists()) return { exists: false };

  try {
    const pem = fs.readFileSync(CERT_FILE, 'utf-8');
    const lines = pem.split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    const der = Buffer.from(b64, 'base64');

    // Parse basic info from openssl if available
    try {
      const out = execSync(`openssl x509 -in "${CERT_FILE}" -noout -subject -issuer -dates -fingerprint`, {
        encoding: 'utf-8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const subject = out.match(/subject=(.*)/)?.[1]?.trim() || '';
      const issuer = out.match(/issuer=(.*)/)?.[1]?.trim() || '';
      const validFrom = out.match(/notBefore=(.*)/)?.[1]?.trim() || '';
      const validTo = out.match(/notAfter=(.*)/)?.[1]?.trim() || '';
      const fingerprint = out.match(/ingerprint=(.*)/)?.[1]?.trim() || '';
      const daysRemaining = Math.floor((new Date(validTo).getTime() - Date.now()) / 86400000);

      return { exists: true, subject, issuer, validFrom, validTo, fingerprint, daysRemaining };
    } catch {
      // openssl not available — return basic info
      return { exists: true };
    }
  } catch {
    return { exists: true };
  }
}
