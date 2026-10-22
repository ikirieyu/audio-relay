/**
 * BluetoothBridge – RFCOMM serial over Bluetooth
 *
 * Creates a Bluetooth RFCOMM server that the Android app can connect to.
 * Once connected, TCP port traffic (control + audio) is tunneled over RFCOMM,
 * which is useful when the devices are on different networks.
 *
 * This uses the `node-bluetooth` package which requires:
 *  - Windows: Bluetooth LE support (Windows 10+)
 *  - Linux: BlueZ + libbluetooth-dev
 *  - macOS: CoreBluetooth (limited RFCOMM support)
 *
 * NOTE: Bluetooth has inherently higher latency than WiFi/USB.
 *       Recommend using LOW_LATENCY or BALANCED quality preset.
 */

'use strict';

const EventEmitter = require('events');
const net = require('net');

// Try to load node-bluetooth
let bluetooth;
try {
  bluetooth = require('node-bluetooth');
} catch {
  bluetooth = null;
  console.warn('[BluetoothBridge] node-bluetooth not available');
}

const SERVICE_UUID = '0000110b-0000-1000-8000-00805f9b34fb'; // Audio Sink UUID

class BluetoothBridge extends EventEmitter {
  constructor(controlPort) {
    super();
    this.controlPort  = controlPort;
    this._device      = null;
    this._connection  = null;
    this._scanning    = false;
  }

  async scan() {
    if (!bluetooth) {
      this.emit('status', { error: 'Bluetooth not available on this system' });
      return [];
    }

    this._scanning = true;
    this.emit('status', { scanning: true, message: 'Scanning for Bluetooth devices…' });

    return new Promise((resolve) => {
      const devices = [];
      const device = new bluetooth.DeviceINQ();

      device.on('found', (address, name) => {
        const info = { address, name: name || address };
        devices.push(info);
        this.emit('device-found', info);
      });

      device.on('finished', () => {
        this._scanning = false;
        this.emit('status', { scanning: false, message: `Found ${devices.length} devices` });
        resolve(devices);
      });

      device.scan();

      // Timeout after 15s
      setTimeout(() => {
        if (this._scanning) {
          this._scanning = false;
          this.emit('status', { scanning: false, message: 'Scan complete' });
          resolve(devices);
        }
      }, 15000);
    });
  }

  async connect(address) {
    if (!bluetooth) {
      throw new Error('Bluetooth not available');
    }

    return new Promise((resolve, reject) => {
      bluetooth.connect(address, 1, (err, connection) => {
        if (err) {
          this.emit('status', { connected: false, error: err.message });
          return reject(err);
        }

        this._connection = connection;
        console.log('[BluetoothBridge] Connected to', address);
        this.emit('status', { connected: true, address, message: 'Bluetooth connected' });

        // Bridge Bluetooth ↔ TCP
        this._bridgeToTcp(connection);
        resolve({ address });
      });
    });
  }

  async disconnect() {
    if (this._connection) {
      try { this._connection.close?.(); } catch {}
      this._connection = null;
    }
    this.emit('status', { connected: false, message: 'Bluetooth disconnected' });
  }

  async stop() {
    await this.disconnect();
  }

  /**
   * Pipe Bluetooth RFCOMM data ↔ local TCP port (control server)
   * This creates a transparent tunnel so the Android Bluetooth client
   * can reach the WebSocket server.
   */
  _bridgeToTcp(btConn) {
    const tcpSocket = net.createConnection(this.controlPort, '127.0.0.1', () => {
      console.log('[BluetoothBridge] TCP bridge connected');
    });

    btConn.on ('data',  (d) => tcpSocket.write(d));
    tcpSocket.on('data', (d) => { try { btConn.write(d); } catch {} });

    const cleanup = () => {
      tcpSocket.destroy();
      this.disconnect();
    };

    btConn.on('close',  cleanup);
    tcpSocket.on('close', cleanup);
    tcpSocket.on('error', (e) => console.error('[BluetoothBridge] TCP error:', e.message));
  }
}

module.exports = BluetoothBridge;
