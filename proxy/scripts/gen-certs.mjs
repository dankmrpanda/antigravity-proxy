import forge from 'node-forge';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Legacy repo-local dir (used by CI and as a fallback). The runtime reads
// certs from the per-user dir (~/.antigravity/certs) so the proxy works when
// installed globally via npm and so `sudo` runs don't clobber user files.
const legacyCertsDir = path.resolve(__dirname, '..', 'certs');
const userCertsDir = path.join(os.homedir(), '.antigravity', 'certs');

// Optional CLI override: node scripts/gen-certs.mjs --out-dir <dir>
const outDirFlag = process.argv.indexOf('--out-dir');
const extraOutDir = outDirFlag !== -1 ? process.argv[outDirFlag + 1] : null;

const targetDirs = [legacyCertsDir, userCertsDir];
if (extraOutDir) targetDirs.push(path.resolve(extraOutDir));

for (const dir of targetDirs) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

const keys = forge.pki.rsa.generateKeyPair(2048);

const cert = forge.pki.createCertificate();
cert.publicKey = keys.publicKey;
cert.serialNumber = '01' + forge.util.bytesToHex(forge.random.getBytesSync(15));

const now = new Date();
cert.validity.notBefore = new Date(now.getTime() - 86400000);
cert.validity.notAfter = new Date(now.getTime() + 365 * 86400000);

const attrs = [{ name: 'commonName', value: 'localhost' }];
cert.setSubject(attrs);
cert.setIssuer(attrs);

cert.setExtensions([
  { name: 'basicConstraints', cA: false },
  { name: 'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true },
  { name: 'extKeyUsage', serverAuth: true },
  {
    name: 'subjectAltName',
    altNames: [
      { type: 2, value: 'localhost' },
      { type: 2, value: 'cloudcode-pa.googleapis.com' },
      { type: 2, value: 'daily-cloudcode-pa.googleapis.com' },
      { type: 2, value: 'runtime.us-east-1.kiro.dev' },
      { type: 2, value: 'kiro.dev' },
      { type: 2, value: 'app.kiro.dev' },
      { type: 7, ip: '127.0.0.1' },
    ],
  },
]);

cert.sign(keys.privateKey, forge.md.sha256.create());

const certPem = forge.pki.certificateToPem(cert);
const keyPem = forge.pki.privateKeyToPem(keys.privateKey);

for (const dir of targetDirs) {
  try {
    fs.writeFileSync(path.join(dir, 'cert.pem'), certPem);
    fs.writeFileSync(path.join(dir, 'key.pem'), keyPem);
    // Restrict private key permissions on POSIX (macOS/Linux).
    try {
      if (process.platform !== 'win32') fs.chmodSync(path.join(dir, 'key.pem'), 0o600);
    } catch { /* best-effort */ }
  } catch (err) {
    console.error(`Failed to write certs to ${dir}: ${err.message}`);
  }
}

console.log('TLS certs generated:');
for (const dir of targetDirs) {
  console.log(`  cert: ${path.join(dir, 'cert.pem')}`);
  console.log(`  key:  ${path.join(dir, 'key.pem')}`);
}
