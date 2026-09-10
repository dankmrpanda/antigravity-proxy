import { execSync } from 'child_process';
import { platform } from 'os';

function lsofAvailable(): boolean {
  try {
    execSync('command -v lsof', { stdio: 'pipe', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export function findProcessesOnPort(port: number): number[] {
  const pids: number[] = [];
  try {
    if (platform() === 'win32') {
      const out = execSync(`netstat -ano`, { encoding: 'utf-8', timeout: 5000 });
      for (const line of out.split('\n')) {
        if (line.includes(`:${port}`) && line.includes('LISTENING')) {
          const parts = line.trim().split(/\s+/);
          const pid = parseInt(parts[parts.length - 1], 10);
          if (!isNaN(pid) && pid > 0) pids.push(pid);
        }
      }
    } else {
      let out: string;
      try {
        // LISTEN-only: without -sTCP:LISTEN, lsof matches every socket with
        // this port as either endpoint — including outbound HTTPS connections
        // from browsers, Antigravity, etc. Killing those PIDs kills innocent
        // apps (and logs the user out of Antigravity). Only listeners (i.e.
        // a previous proxy instance) may be reaped here.
        out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf-8', timeout: 5000 });
      } catch {
        // lsof exits non-zero both when it is missing AND when nothing
        // listens (no match) — the latter means the port is free, not that
        // we should fall back. Only use ss when lsof itself is unavailable
        // (it doesn't exist on macOS, hence the availability check).
        if (lsofAvailable()) return pids;
        out = execSync(`ss -tlnp`, { encoding: 'utf-8', timeout: 5000 });
        for (const line of out.split('\n')) {
          if (line.includes(`:${port}`)) {
            const m = line.match(/pid=(\d+)/);
            if (m) pids.push(parseInt(m[1], 10));
          }
        }
        return pids;
      }
      for (const line of out.split('\n')) {
        const pid = parseInt(line.trim(), 10);
        if (!isNaN(pid) && pid > 0) pids.push(pid);
      }
    }
  } catch {
    // Command failed — port probably free
  }
  return [...new Set(pids)];
}

export function isPortAvailable(port: number): boolean {
  return findProcessesOnPort(port).length === 0;
}

export function killProcessOnPort(port: number): void {
  const pids = findProcessesOnPort(port);
  for (const pid of pids) {
    try {
      if (platform() === 'win32') {
        execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', timeout: 5000 });
      } else {
        process.kill(pid, 'SIGTERM');
      }
    } catch {
      // Process may have already exited
    }
  }
}

export function killProcessesOnPorts(ports: number[]): void {
  for (const port of ports) {
    killProcessOnPort(port);
  }
}
