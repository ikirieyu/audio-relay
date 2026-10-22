/**
 * AdbBridge – USB audio relay via Android Debug Bridge (ADB)
 *
 * When a USB cable is connected and ADB is available, this module
 * sets up port forwarding so the Android app can reach the PC's
 * WebSocket server over USB (no WiFi needed).
 *
 * adb reverse tcp:7372 tcp:7372  → control channel
 * adb reverse tcp:7371 tcp:7371  → audio UDP channel
 *
 * The Android app always connects to localhost:7372 – when ADB
 * reverse is active it tunnels over USB, otherwise it falls back
 * to TCP/IP (WiFi).
 */

'use strict';

const EventEmitter = require('events');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');

const execAsync = promisify(exec);

class AdbBridge extends EventEmitter {
  constructor(controlPort, audioPort) {
    super();
    this.controlPort = controlPort;
    this.audioPort   = audioPort;
    this._enabled    = false;
    this._checkTimer = null;
    this._adbPath    = 'adb'; // assumes adb is in PATH
  }

  async enable() {
    this._enabled = true;
    await this._setupForward();
    // Poll for device connect/disconnect
    this._checkTimer = setInterval(() => this._checkDevices(), 3000);
    console.log('[AdbBridge] Enabled');
    this.emit('status', { enabled: true, message: 'ADB USB bridge enabled' });
  }

  async disable() {
    this._enabled = false;
    clearInterval(this._checkTimer);
    await this._removeForward();
    console.log('[AdbBridge] Disabled');
    this.emit('status', { enabled: false, message: 'ADB USB bridge disabled' });
  }

  async stop() {
    await this.disable();
  }

  async _setupForward() {
    try {
      // reverse: forward from Android to PC
      await execAsync(`${this._adbPath} reverse tcp:${this.controlPort} tcp:${this.controlPort}`);
      await execAsync(`${this._adbPath} reverse tcp:${this.audioPort}   tcp:${this.audioPort}`);
      console.log('[AdbBridge] Port forwarding established');
      this.emit('status', { enabled: true, connected: true, message: 'USB connected – ADB forwarding active' });
    } catch (e) {
      console.warn('[AdbBridge] Forward setup failed (device may not be connected):', e.message);
      this.emit('status', { enabled: true, connected: false, message: 'Waiting for USB device…' });
    }
  }

  async _removeForward() {
    try {
      await execAsync(`${this._adbPath} reverse --remove-all`);
    } catch {}
  }

  async _checkDevices() {
    if (!this._enabled) return;
    try {
      const { stdout } = await execAsync(`${this._adbPath} devices`);
      const lines    = stdout.split('\n').filter(l => l.includes('device') && !l.startsWith('List'));
      const connected = lines.length > 0;
      if (connected) {
        await this._setupForward();
      } else {
        this.emit('status', { enabled: true, connected: false, message: 'No USB device detected' });
      }
    } catch {
      this.emit('status', { enabled: true, connected: false, message: 'ADB not found – install Android Platform Tools' });
    }
  }

  /**
   * Check if ADB is available on the system PATH
   */
  static async isAvailable() {
    try {
      await execAsync('adb version');
      return true;
    } catch {
      return false;
    }
  }
}

module.exports = AdbBridge;
