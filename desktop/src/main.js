/**
 * AudioRelay Desktop – Main Process (Electron)
 *
 * Responsibilities:
 *  - Create the browser window (renderer UI)
 *  - Start/stop the audio capture & playback engine (naudiodon / Web Audio)
 *  - Manage WebSocket server for mobile clients
 *  - Handle UDP discovery broadcasts
 *  - Manage USB (ADB) port-forwarding
 *  - Bridge IPC messages between renderer and audio engine
 */

'use strict';

const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path   = require('path');
const os     = require('os');

const AudioEngine   = require('./audio/engine');
const ControlServer = require('./network/control-server');
const Discovery     = require('./network/discovery');
const AdbBridge     = require('./network/adb-bridge');
const BluetoothBridge = require('./network/bluetooth-bridge');
const { PORTS, CONNECTION_MODE } = require('./protocol');

// ─── State ───────────────────────────────────────────────────────────────────
let mainWindow   = null;
let tray         = null;
let audioEngine  = null;
let ctrlServer   = null;
let discovery    = null;
let adbBridge    = null;
let btBridge     = null;
let isDevMode    = process.argv.includes('--dev');

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  createWindow();
  await startServices();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
  await stopServices();
});

// ─── Window ───────────────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:           900,
    height:          640,
    minWidth:        700,
    minHeight:       500,
    frame:           false,
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    icon: path.join(__dirname, '../assets/icon.png'),
    title: 'AudioRelay',
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  if (isDevMode) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  setupTray();
}

function setupTray() {
  try {
    const iconPath = path.join(__dirname, '../assets/tray-icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
    tray.setToolTip('AudioRelay');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open AudioRelay', click: () => mainWindow?.show() },
      { type: 'separator' },
      { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
    ]));
    tray.on('double-click', () => mainWindow?.show());
  } catch {
    // Tray icon optional
  }
}

// ─── Services ─────────────────────────────────────────────────────────────────
async function startServices() {
  // Audio engine
  audioEngine = new AudioEngine();
  await audioEngine.initialize();

  // Control WebSocket server
  ctrlServer = new ControlServer(PORTS.CONTROL, audioEngine);
  ctrlServer.on('client-connected',    (info) => sendToRenderer('client-connected',    info));
  ctrlServer.on('client-disconnected', (info) => sendToRenderer('client-disconnected', info));
  ctrlServer.on('stream-started',      (info) => sendToRenderer('stream-started',      info));
  ctrlServer.on('stream-stopped',      (info) => sendToRenderer('stream-stopped',      info));
  ctrlServer.on('stats',               (info) => sendToRenderer('stats',               info));
  await ctrlServer.start();

  // UDP discovery
  discovery = new Discovery(PORTS.DISCOVERY, PORTS.CONTROL, getDeviceName());
  await discovery.start();

  // ADB USB bridge
  adbBridge = new AdbBridge(PORTS.CONTROL, PORTS.AUDIO);
  adbBridge.on('status', (s) => sendToRenderer('adb-status', s));

  // Bluetooth bridge
  btBridge = new BluetoothBridge(PORTS.CONTROL);
  btBridge.on('status', (s) => sendToRenderer('bt-status', s));
  btBridge.on('device-found', (d) => sendToRenderer('bt-device-found', d));
}

async function stopServices() {
  await ctrlServer?.stop();
  await discovery?.stop();
  await adbBridge?.stop();
  await btBridge?.stop();
  audioEngine?.destroy();
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────
ipcMain.handle('get-audio-devices', async () => {
  return audioEngine?.getDevices() ?? [];
});

ipcMain.handle('get-server-info', async () => ({
  ip:   getLocalIP(),
  port: PORTS.CONTROL,
  name: getDeviceName(),
}));

ipcMain.handle('start-stream', async (_, opts) => {
  return ctrlServer?.startStream(opts);
});

ipcMain.handle('stop-stream', async () => {
  return ctrlServer?.stopStream();
});

ipcMain.handle('set-quality', async (_, preset) => {
  return ctrlServer?.setQuality(preset);
});

ipcMain.handle('set-input-device', async (_, deviceId) => {
  return audioEngine?.setInputDevice(deviceId);
});

ipcMain.handle('set-output-device', async (_, deviceId) => {
  return audioEngine?.setOutputDevice(deviceId);
});

ipcMain.handle('adb-enable', async () => {
  return adbBridge?.enable();
});

ipcMain.handle('adb-disable', async () => {
  return adbBridge?.disable();
});

ipcMain.handle('bt-scan', async () => {
  return btBridge?.scan();
});

ipcMain.handle('bt-connect', async (_, address) => {
  return btBridge?.connect(address);
});

ipcMain.handle('bt-disconnect', async () => {
  return btBridge?.disconnect();
});

ipcMain.handle('window-minimize', () => mainWindow?.minimize());
ipcMain.handle('window-maximize', () => {
  if (mainWindow?.isMaximized()) mainWindow.unmaximize();
  else mainWindow?.maximize();
});
ipcMain.handle('window-close', () => mainWindow?.hide());

// ─── Helpers ──────────────────────────────────────────────────────────────────
function sendToRenderer(channel, data) {
  if (mainWindow?.webContents && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

function getLocalIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const iface of ifaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function getDeviceName() {
  return `${os.hostname()} (PC)`;
}
