import { execSync } from 'child_process';

console.log('Stopping background GitIngest server...');

if (process.platform === 'win32') {
  try {
    // Find processes listening on port 3000 and terminate them
    const output = execSync('netstat -ano | findstr :3000', { encoding: 'utf8' });
    const lines = output.split('\n').filter(Boolean);
    const pids = new Set();
    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && pid !== '0') pids.add(pid);
    }
    for (const pid of pids) {
      try {
        execSync(`taskkill /F /PID ${pid}`);
        console.log(`[OK] Terminated GitIngest process on PID ${pid}`);
      } catch {}
    }
  } catch {
    console.log('[Notice] No active process was found listening on port 3000.');
  }
} else {
  try {
    execSync('fuser -k 3000/tcp');
    console.log('[OK] Terminated process on port 3000');
  } catch {}
}

console.log('GitIngest background server stopped.');
