import { exec } from 'child_process';
import { platform } from 'os';

export function openUrl(url: string): void {
  const p = platform();
  // Under sudo, open the browser as the invoking user — `open` as root
  // targets the root session and the dashboard never appears for the user.
  const sudoPrefix =
    p !== 'win32' && process.env.SUDO_USER &&
    typeof process.getuid === 'function' && process.getuid() === 0
      ? `sudo -u ${process.env.SUDO_USER} `
      : '';
  let cmd: string;
  if (p === 'win32') {
    cmd = `start "" "${url}"`;
  } else if (p === 'darwin') {
    cmd = `${sudoPrefix}open "${url}"`;
  } else {
    cmd = `${sudoPrefix}xdg-open "${url}" || ${sudoPrefix}gnome-open "${url}" || true`;
  }
  exec(cmd, { timeout: 5000 }, () => {});
}
