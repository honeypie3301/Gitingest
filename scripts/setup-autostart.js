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

// Ensure production bundles are fresh before setting up autostart
try {
  console.log('Building latest production bundle...');
  execSync('npm run build', { stdio: 'inherit' });
} catch (e) {
  console.warn('[Warning] Pre-build failed. Attempting npm install to restore binaries...');
  try {
    execSync('npm install', { stdio: 'inherit' });
    execSync('npm run build', { stdio: 'inherit' });
  } catch (retryErr) {
    console.error('[Error] Build failed even after npm install. Please check errors above.');
  }
}

// 2. Generate resilient silent VBScript launcher
const nodePath = process.execPath;
const vbsContent = `' GitIngest Background Silent Launcher
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
projectDir = "${projectDir.replace(/\\/g, '\\\\')}"
WshShell.CurrentDirectory = projectDir

serverFile = projectDir & "\\dist-server\\server.mjs"
nodeExe = "${nodePath.replace(/\\/g, '\\\\')}"

' Ensure production server bundle exists; if missing upon boot, build it silently
If Not fso.FileExists(serverFile) Then
  WshShell.Run "cmd.exe /c npm run build", 0, True
End If

' Launch server with GC flag or fallback to tsx
If fso.FileExists(serverFile) Then
  WshShell.Run """" & nodeExe & """ --expose-gc --max-old-space-size=512 dist-server/server.mjs", 0, False
Else
  WshShell.Run "cmd.exe /c npx tsx server.ts", 0, False
End If
`;

const projectVbsPath = path.join(projectDir, 'start-background.vbs');
fs.writeFileSync(projectVbsPath, vbsContent, 'utf8');

// 3. Install to Windows Startup folder for automatic boot
if (startupDir && fs.existsSync(startupDir)) {
  const startupVbsPath = path.join(startupDir, 'gitingest-autostart.vbs');
  fs.writeFileSync(startupVbsPath, vbsContent, 'utf8');
  console.log(`[OK] Registered autostart hook in Windows Startup folder: ${startupVbsPath}`);
} else if (process.platform === 'win32') {
  console.warn('[Warning] Startup folder not found. Generated start-background.vbs in project root.');
}

// 4. Register in Windows Registry (HKCU Run key) for guaranteed boot persistence
if (process.platform === 'win32') {
  try {
    const regCmd = `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run" /v "GitIngest" /t REG_SZ /d "wscript.exe \\"${projectVbsPath}\\"" /f`;
    execSync(regCmd, { stdio: 'ignore' });
    console.log('[OK] Registered Windows Registry autostart key (HKCU Run)');
  } catch {
    // Non-fatal if policy restricts registry
  }
}

// 5. Immediately launch in the background now
if (process.platform === 'win32') {
  console.log('[OK] Launching GitIngest server silently in the background...');
  exec(`wscript.exe "${projectVbsPath}"`);
} else {
  console.log('[OK] Generated background launcher.');
}

console.log('\n======================================================');
console.log(' GitIngest Windows Autostart Setup Complete!');
console.log(' - Server will start automatically on every Windows boot.');
console.log(' - Dual redundancy: Startup folder + Windows Registry Run key.');
console.log(' - Running in background at http://localhost:3000');
console.log(' - To stop: run "npm run stop:background"');
console.log('======================================================\n');
