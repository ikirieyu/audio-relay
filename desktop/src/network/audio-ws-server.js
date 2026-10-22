/**
 * Audio WebSocket Server – wraps the binary UDP audio channel
 * for browser clients (which cannot use raw UDP).
 *
 * The mobile web app sends/receives Opus frames via WebSocket.
 * This module bridges those WebSocket connections to the AudioEngine.
 */

'use strict';

const EventEmitter = require('events');
const { WebSocketServer, WebSocket } = require('ws');
const http = require('http');
const { PORTS, AUDIO_HEADER_SIZE, encodeAudioHeader, decodeAudioHeader } = require('../protocol');
const os = require('os');

class AudioWebSocketServer extends EventEmitter {
  constructor(audioEngine) {
    super();
    this.audioEngine = audioEngine;
    this.httpServer  = null;
    this.wss         = null;
    this.clients     = new Set();
    this._seq        = 0;
  }

  async start() {
    // Create HTTP server that also serves /info for mobile discovery
    this.httpServer = http.createServer((req, res) => {
      if (req.url === '/info') {
        res.writeHead(200, {
          'Content-Type':                'application/json',
          'Access-Control-Allow-Origin': '*',
        });
        res.end(JSON.stringify({
          app:     'audio-relay',
          version: '1.0.0',
          device:  `${os.hostname()} (PC)`,
          port:    PORTS.CONTROL,
        }));
      } else {
        res.writeHead(404); res.end();
      }
    });

    this.wss = new WebSocketServer({
      server: this.httpServer,
      path:   '/audio',
    });

    this.wss.on('connection', (ws) => this._onConnect(ws));

    await new Promise((res) => {
      this.httpServer.listen(PORTS.AUDIO, () => {
        console.log(`[AudioWS] Listening on :${PORTS.AUDIO} (HTTP + WS /audio)`);
        res();
      });
    });
  }

  async stop() {
    for (const ws of this.clients) { try { ws.close(); } catch {} }
    this.clients.clear();
    await new Promise((res) => this.wss?.close(res));
    await new Promise((res) => this.httpServer?.close(res));
    console.log('[AudioWS] Stopped');
  }

  _onConnect(ws) {
    this.clients.add(ws);
    console.log('[AudioWS] Client connected');

    ws.on('message', (data) => {
      if (!(data instanceof Buffer) || data.length < AUDIO_HEADER_SIZE) return;
      const payload = data.slice(AUDIO_HEADER_SIZE);
      this.audioEngine.feedEncodedAudio(payload);
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      console.log('[AudioWS] Client disconnected');
    });
  }

  /**
   * Send an encoded Opus frame to all connected WebSocket audio clients.
   */
  broadcast(frame) {
    const { seq, ts, encoded } = frame;
    const header = encodeAudioHeader(seq, ts, encoded.length);
    const packet = Buffer.concat([header, Buffer.from(encoded)]);

    for (const ws of this.clients) {
      if (ws.readyState === WebSocket.OPEN) {
        try { ws.send(packet); } catch {}
      }
    }
  }
}

module.exports = AudioWebSocketServer;
