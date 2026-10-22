/**
 * Preload script – bridges renderer and main process
 * Exposes a safe, typed API via contextBridge
 */

'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('audioRelay', {
  // ── Device Info ──────────────────────────────────────────────────────────
  getAudioDevices:  ()         => ipcRenderer.invoke('get-audio-devices'),
  getServerInfo:    ()         => ipcRenderer.invoke('get-server-info'),

  // ── Stream Control ────────────────────────────────────────────────────────
  startStream:      (opts)     => ipcRenderer.invoke('start-stream', opts),
  stopStream:       ()         => ipcRenderer.invoke('stop-stream'),
  setQuality:       (preset)   => ipcRenderer.invoke('set-quality', preset),

  // ── Audio Device Selection ────────────────────────────────────────────────
  setInputDevice:   (id)       => ipcRenderer.invoke('set-input-device', id),
  setOutputDevice:  (id)       => ipcRenderer.invoke('set-output-device', id),

  // ── USB / ADB ─────────────────────────────────────────────────────────────
  adbEnable:        ()         => ipcRenderer.invoke('adb-enable'),
  adbDisable:       ()         => ipcRenderer.invoke('adb-disable'),

  // ── Bluetooth ─────────────────────────────────────────────────────────────
  btScan:           ()         => ipcRenderer.invoke('bt-scan'),
  btConnect:        (address)  => ipcRenderer.invoke('bt-connect', address),
  btDisconnect:     ()         => ipcRenderer.invoke('bt-disconnect'),

  // ── Window Controls ───────────────────────────────────────────────────────
  minimize:         ()         => ipcRenderer.invoke('window-minimize'),
  maximize:         ()         => ipcRenderer.invoke('window-maximize'),
  close:            ()         => ipcRenderer.invoke('window-close'),

  // ── Events (subscribe) ────────────────────────────────────────────────────
  on: (channel, cb) => {
    const allowed = [
      'client-connected', 'client-disconnected',
      'stream-started',   'stream-stopped',
      'stats',
      'adb-status',
      'bt-status',        'bt-device-found',
    ];
    if (!allowed.includes(channel)) return;
    const handler = (_, data) => cb(data);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  },
});
