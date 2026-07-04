import chalk from 'chalk';
import { certExists, generateCerts, trustCert, getCertInfo } from '../utils/cert.js';
import { header, ok, warn, error, section, valueBadge, startSpinner, succeedSpinner, failSpinner } from '../ui.js';

export function certsCommand(action?: string): void {
  if (!action || action === 'show') {
    const info = getCertInfo();
    if (!info.exists) {
      header('TLS Certificates');
      console.log(`  ${warn('No TLS certificates found.')}`);
      console.log(`  ${chalk.cyan('Run `antigravity certs generate` to create them.')}`);
      return;
    }

    header('TLS Certificate');

    if (info.subject) {
      console.log(`  ${valueBadge('Subject', info.subject)}`);
      if (info.issuer) console.log(`  ${valueBadge('Issuer', info.issuer)}`);
      if (info.validFrom) console.log(`  ${valueBadge('Valid from', info.validFrom)}`);
      if (info.validTo) console.log(`  ${valueBadge('Valid to', info.validTo)}`);
      if (info.fingerprint) console.log(`  ${valueBadge('Fingerprint', info.fingerprint)}`);
      if (info.daysRemaining !== undefined) {
        const daysStr = String(info.daysRemaining);
        const colored = info.daysRemaining < 7
          ? chalk.red.bold(daysStr)
          : info.daysRemaining < 30
          ? chalk.yellow.bold(daysStr)
          : chalk.green.bold(daysStr);
        console.log(`  ${valueBadge('Days remaining', colored)}`);
      }
    } else {
      console.log(`  ${ok('Certificates exist')}`);
      console.log(`  ${chalk.dim('Install openssl for detailed cert info')}`);
    }
    console.log('');
    return;
  }

  if (action === 'generate') {
    const spinner = startSpinner('Generating TLS certificates');
    try {
      generateCerts();
      succeedSpinner(spinner, 'Certificates generated');
    } catch (e: any) {
      failSpinner(spinner, `Failed: ${e.message}`);
    }
    return;
  }

  if (action === 'trust') {
    const spinner = startSpinner('Trusting TLS certificate');
    try {
      trustCert();
      succeedSpinner(spinner, 'Certificate trusted');
    } catch (e: any) {
      failSpinner(spinner, e.message);
      process.exit(1);
    }
    return;
  }

  error('Usage: antigravity certs [show|generate|trust]');
  process.exit(1);
}
