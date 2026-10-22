const { spawn } = require('child_process');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

console.log('🚀 Starting AudioRelay (Desktop App + Mobile Web Server)...\n');

// 1. Mobile Web Server (Vite)
const mobile = spawn(isWin ? 'npm.cmd run start' : 'npm run start', {
  cwd: path.join(rootDir, 'mobile'),
  stdio: 'inherit',
  shell: true,
});

// 2. Desktop Electron App
const desktop = spawn(isWin ? 'npm.cmd start' : 'npm start', {
  cwd: path.join(rootDir, 'desktop'),
  stdio: 'inherit',
  shell: true,
});

function cleanup() {
  console.log('\n🛑 Stopping AudioRelay services...');
  mobile.kill();
  desktop.kill();
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);
