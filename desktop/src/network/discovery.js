/**
 * Discovery – UDP broadcast beacon
 *
 * The desktop PC broadcasts its presence every 2 seconds on the local network.
 * Android clients listen for this beacon and use the IP + port to connect.
 *
 * Beacon format (JSON UTF-8):
 *   { app: "audio-relay", version, device, port }
 */

'use strict';

const EventEmitter = require('events');
const dgram  = require('dgram');
const os     = require('os');
const { encodeDiscoveryBeacon } = require('../protocol');

class Discovery extends EventEmitter {
  constructor(discoveryPort, controlPort, deviceName) {
    super();
    this.discoveryPort = discoveryPort;
    this.controlPort   = controlPort;
    this.deviceName    = deviceName;
    this.socket        = null;
    this._timer        = null;
  }

  async start() {
    this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });

    this.socket.on('error', (e) => {
      console.error('[Discovery] Socket error:', e.message);
    });

    await new Promise((res, rej) => {
      this.socket.bind(this.discoveryPort, (err) => err ? rej(err) : res());
    });

    try { this.socket.setBroadcast(true); } catch {}

    this._timer = setInterval(() => this._broadcast(), 2000);
    this._broadcast(); // immediate first broadcast
    console.log(`[Discovery] Broadcasting on port ${this.discoveryPort}`);
  }

  async stop() {
    clearInterval(this._timer);
    await new Promise((res) => {
      try { this.socket?.close(res); } catch { res(); }
    });
  }

  _broadcast() {
    const msg = Buffer.from(encodeDiscoveryBeacon(this.deviceName, this.controlPort));
    // Broadcast to each interface's broadcast address
    const addresses = this._getBroadcastAddresses();
    for (const addr of addresses) {
      try {
        this.socket.send(msg, this.discoveryPort, addr);
      } catch {}
    }
  }

  _getBroadcastAddresses() {
    const result = ['255.255.255.255'];
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
      for (const iface of ifaces[name]) {
        if (iface.family === 'IPv4' && !iface.internal && iface.netmask) {
          // Calculate broadcast address
          const ip   = iface.address.split('.').map(Number);
          const mask = iface.netmask.split('.').map(Number);
          const bcast = ip.map((b, i) => (b | (~mask[i] & 0xFF)) >>> 0);
          result.push(bcast.join('.'));
        }
      }
    }
    return [...new Set(result)];
  }
}

module.exports = Discovery;
