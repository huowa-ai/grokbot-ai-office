import { spawn } from 'node:child_process';

export function killProcessTree(pid: number | undefined): void {
  if (pid === undefined || pid <= 0 || pid === process.pid) {
    return;
  }
  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(pid), '/t', '/f'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    return;
  }
  try {
    process.kill(-pid, 'SIGKILL');
  } catch (error) {
    if (!isGone(error)) {
      killOne(pid);
    }
  }
}

function killOne(pid: number): void {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if (!isGone(error)) {
      const message = error instanceof Error ? error.message : '无法结束进程';
      throw new Error(message, { cause: error });
    }
  }
}

function isGone(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  const code = error.code;
  return code === 'ESRCH' || code === 'EPERM' || code === 'EINVAL';
}
