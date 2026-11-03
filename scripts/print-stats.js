import fs from 'fs';
import os from 'os';
import path from 'path';

console.log('========================================================');
console.log('         GitIngest Server Live Resource Stats           ');
console.log('========================================================');

const jsonPath = path.join(os.tmpdir(), 'gitingest_stats.json');

try {
  if (fs.existsSync(jsonPath)) {
    const raw = fs.readFileSync(jsonPath, 'utf8');
    const data = JSON.parse(raw);
    const proc = Array.isArray(data) ? data.find((p) => p.name === 'gitingest') : null;

    if (!proc || proc.pm2_env?.status !== 'online') {
      console.log('Status:       [OFFLINE] GitIngest is currently stopped.');
      console.log('To start:     run start.bat');
    } else {
      const memMB = (proc.monit.memory / (1024 * 1024)).toFixed(1);
      const cpu = proc.monit.cpu;
      const uptimeSec = Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1000);
      const uptime = uptimeSec > 3600
        ? `${Math.floor(uptimeSec / 3600)}h ${Math.floor((uptimeSec % 3600) / 60)}m`
        : `${Math.floor(uptimeSec / 60)}m ${uptimeSec % 60}s`;

      console.log(`Status:       [ONLINE] Running`);
      console.log(`Process ID:   ${proc.pid}`);
      console.log(`CPU Usage:    ${cpu}%`);
      console.log(`Memory (RAM): ${memMB} MB`);
      console.log(`Uptime:       ${uptime}`);
      console.log(`Restarts:     ${proc.pm2_env.restart_time}`);
      console.log(`Local URL:    http://localhost:3000`);
    }
  } else {
    console.log('Status:       [OFFLINE] No PM2 metrics available.');
  }
} catch {
  console.log('Unable to parse server stats.');
} finally {
  try { if (fs.existsSync(jsonPath)) fs.unlinkSync(jsonPath); } catch {}
}

const freeMem = (os.freemem() / (1024 * 1024 * 1024)).toFixed(2);
const totalMem = (os.totalmem() / (1024 * 1024 * 1024)).toFixed(2);
console.log('--------------------------------------------------------');
console.log(`System Memory: ${freeMem} GB free / ${totalMem} GB total`);
console.log('========================================================');
