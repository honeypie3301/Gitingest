import fs from 'fs';
import path from 'path';
import { exec, execSync } from 'child_process';
import os from 'os';

const projectDir = process.cwd();
const appData = process.env.APPDATA;

if (!appData && process.platform === 'win32') {
  console.error('Could not locate Windows APPDATA directory.');
  process.exit(1);
}

// 1. Locate the Windows Startup directory
const startupDir = process.platform === 'win32'
  ? path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup')
  : null;

// 2. Generate the silent VBScript launcher in the project root
// Optimized: V8 GC exposure + max memory cap
const vbsContent = `' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
WshShell.CurrentDirectory = "${projectDir.replace(/\\/g, '\\\\')}"
WshShell.Run "cmd /c npx tsx --expose-gc --max-old-space-size=1024 server.ts", 0, False
`;

const projectVbsPath = path.join(projectDir, 'start-background.vbs');
fs.writeFileSync(projectVbsPath, vbsContent, 'utf8');

// 3. Install to Windows Startup folder for automatic boot
if (startupDir && fs.existsSync(startupDir)) {
  const startupVbsPath = path.join(startupDir, 'gitingest-autostart.vbs');
  fs.writeFileSync(startupVbsPath, vbsContent, 'utf8');
  console.log(`[OK] Registered autostart hook in: ${startupVbsPath}`);
} else if (process.platform === 'win32') {
  console.warn('[Warning] Startup folder not found. Generated start-background.vbs in project root.');
}

// 4. Immediately launch it in the background now
if (process.platform === 'win32') {
  console.log('[OK] Launching GitIngest server silently in the background...');
  exec(`wscript.exe "${projectVbsPath}"`);
} else {
  console.log('[OK] Generated background launcher.');
}

console.log('\n======================================================');
console.log(' GitIngest Windows Autostart Setup Complete!');
console.log(' - Server will start silently on every Windows boot.');
console.log(' - Currently running in background at http://localhost:3000');
console.log(' - To stop: run "npm run stop:background"');
console.log('======================================================\n');
