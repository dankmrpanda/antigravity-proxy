import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
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
    // gen-certs.mjs writes to both proxy/certs/ (repo/CI) and ~/.antigravity/certs/
    // (runtime). Older versions only wrote to proxy/certs/, so copy forward
    // as a fallback in case the script predates the dual-write behavior.
    try {
      const legacyCert = path.resolve(PROXY_DIR, 'certs', 'cert.pem');
      const legacyKey = path.resolve(PROXY_DIR, 'certs', 'key.pem');
      if (!fs.existsSync(CERT_FILE) && fs.existsSync(legacyCert)) {
        fs.mkdirSync(USER_CERTS_DIR, { recursive: true });
        fs.copyFileSync(legacyCert, CERT_FILE);
        if (fs.existsSync(legacyKey)) fs.copyFileSync(legacyKey, USER_KEY_FILE);
      }
    } catch {
      // Best-effort fallback — certExists() check by the caller will surface errors.
    }
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

function certFingerprintSha1(): string | null {
  try {
    const lines = fs.readFileSync(CERT_FILE, 'utf-8').split('\n').filter(l => !l.startsWith('-----') && l.trim());
    const b64 = lines.join('');
    const derBytes = Buffer.from(b64, 'base64');
    return crypto.createHash('sha1').update(derBytes).digest('hex').toUpperCase();
  } catch {
    return null;
  }
}

export function isCertTrusted(): boolean {
  if (!certExists()) return false;
  const p = platform();
  if (p === 'win32') {
    try {
      const sha1 = certFingerprintSha1();
      if (!sha1) return false;
      const out = execSync(
        `powershell -NoProfile -Command "Get-ChildItem Cert:\\LocalMachine\\Root | Where-Object { $_.Thumbprint -eq '${sha1}' } | Measure-Object | Select-Object -ExpandProperty Count"`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      return out.trim() !== '0';
    } catch {
      return false;
    }
  }
  if (p === 'darwin') {
    // macOS: look for our cert in the System keychain by SHA-1 hash.
    // `security find-certificate -c "localhost"` is too broad (any localhost
    // cert matches). Matching the fingerprint avoids false positives.
    try {
      const sha1 = certFingerprintSha1();
      if (!sha1) return false;
      // find-certificate -Z prints SHA-1 hashes; -a dumps all matching certs.
      const out = execSync(
        `security find-certificate -a -Z /Library/Keychains/System.keychain`,
        { encoding: 'utf-8', timeout: 10000, stdio: ['pipe', 'pipe', 'pipe'] }
      );
      const normalized = out.replace(/[^0-9A-Fa-f]/g, '').toUpperCase();
      return normalized.includes(sha1);
    } catch {
      return false;
    }
  }
  return false;
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
      throw new Error('Failed to add certificate to macOS keychain. Run: sudo antigravity certs trust');
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

export interface HostsCleanResult {
  found: boolean;
  cleaned: boolean;
  error?: string;
}

export function cleanHostsFile(): HostsCleanResult {
  const hostsPath = platform() === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';
  const elevateHint = platform() === 'win32'
    ? 'Run as Administrator.'
    : 'Run with sudo (e.g. sudo antigravity start).';

  try {
    let content = fs.readFileSync(hostsPath, 'utf-8');
    let found = false;

    for (const entry of PROXY_HOSTS_ENTRIES) {
      const domain = entry.trim().split(' ').pop() || '';
      const lines = content.split('\n');
      const newLines = lines.filter(line => {
        const trimmed = line.trim();
        if (trimmed.includes(domain) && !trimmed.startsWith('#')) {
          found = true;
          return false;
        }
        return true;
      });
      content = newLines.join('\n');
    }

    if (!found) {
      return { found: false, cleaned: false };
    }

    // Clean up multiple blank lines
    content = content.replace(/\n{3,}/g, '\n\n');

    fs.writeFileSync(hostsPath, content, 'utf-8');
    return { found: true, cleaned: true };
  } catch {
    return { found: true, cleaned: false, error: `Could not modify hosts file. ${elevateHint}` };
  }
}

export function setupHostsFile(): HostsCleanResult {
  const hostsPath = platform() === 'win32'
    ? 'C:\\Windows\\System32\\drivers\\etc\\hosts'
    : '/etc/hosts';
  const elevateHint = platform() === 'win32'
    ? 'Run as Administrator.'
    : 'Run with sudo (e.g. sudo antigravity start).';

  try {
    let content = fs.readFileSync(hostsPath, 'utf-8');
    const entriesToAdd: string[] = [];

    for (const entry of PROXY_HOSTS_ENTRIES) {
      const domain = entry.trim().split(' ').pop() || '';
      const domainExists = content.split('\n').some(line => {
        const trimmed = line.trim();
        return trimmed.includes(domain) && !trimmed.startsWith('#');
      });

      if (!domainExists) {
        entriesToAdd.push(entry);
      }
    }

    if (entriesToAdd.length === 0) {
      return { found: true, cleaned: true };
    }

    const marker = '# Antigravity Proxy';
    if (!content.includes(marker)) {
      content = content.trimEnd() + '\n\n' + marker + '\n';
    }
    content = content.trimEnd() + '\n' + entriesToAdd.join('\n') + '\n';

    fs.writeFileSync(hostsPath, content, 'utf-8');
    return { found: true, cleaned: true };
  } catch {
    return { found: true, cleaned: false, error: `Could not modify hosts file. ${elevateHint}` };
  }
}

export function untrustCert(): void {
  const p = platform();
  if (certExists()) {
    if (p === 'win32') {
      try {
        const sha1 = certFingerprintSha1();
        if (!sha1) throw new Error('no fingerprint');

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
