/**
 * AudioRelay Shared Protocol Definitions
 * Defines message types, packet structures, and constants
 * used by both desktop and mobile clients.
 */

'use strict';

// ─── Protocol Version ────────────────────────────────────────────────────────
const PROTOCOL_VERSION = '1.0.0';

// ─── Default Ports ────────────────────────────────────────────────────────────
const PORTS = {
  DISCOVERY: 7370,   // UDP broadcast for auto-discovery
  AUDIO:     7371,   // TCP/UDP audio stream
  CONTROL:   7372,   // WebSocket control channel
};

// ─── Connection Modes ─────────────────────────────────────────────────────────
const CONNECTION_MODE = {
  WIFI:      'wifi',
  USB:       'usb',        // ADB port-forward
  BLUETOOTH: 'bluetooth',
};

// ─── Stream Direction ─────────────────────────────────────────────────────────
const STREAM_DIRECTION = {
  PC_TO_ANDROID:   'pc_to_android',
  ANDROID_TO_PC:   'android_to_pc',
  BIDIRECTIONAL:   'bidirectional',
};

// ─── Audio Quality Presets ────────────────────────────────────────────────────
/**
 * Each preset trades latency for quality.
 *  bufferMs  - target jitter buffer size (lower = less latency, more glitches)
 *  bitrate   - Opus bitrate in bps
 *  frameMs   - Opus frame size in ms (2.5 | 5 | 10 | 20 | 40 | 60)
 *  sampleRate- audio sample rate
 */
const QUALITY_PRESET = {
  ULTRA_LOW_LATENCY: {
    label:      'Ultra Low Latency',
    bufferMs:   20,
    bitrate:    64000,
    frameMs:    10,
    sampleRate: 16000,
    channels:   1,
  },
  LOW_LATENCY: {
    label:      'Low Latency',
    bufferMs:   60,
    bitrate:    96000,
    frameMs:    20,
    sampleRate: 48000,
    channels:   2,
  },
  BALANCED: {
    label:      'Balanced',
    bufferMs:   120,
    bitrate:    128000,
    frameMs:    20,
    sampleRate: 48000,
    channels:   2,
  },
  HIGH_QUALITY: {
    label:      'High Quality',
    bufferMs:   250,
    bitrate:    256000,
    frameMs:    20,
    sampleRate: 48000,
    channels:   2,
  },
  STUDIO: {
    label:      'Studio',
    bufferMs:   500,
    bitrate:    320000,
    frameMs:    20,
    sampleRate: 48000,
    channels:   2,
  },
};

// ─── Control Message Types (WebSocket) ───────────────────────────────────────
const MSG = {
  // Handshake
  HELLO:           'hello',
  HELLO_ACK:       'hello_ack',

  // Session
  START_STREAM:    'start_stream',
  STOP_STREAM:     'stop_stream',
  STREAM_STARTED:  'stream_started',
  STREAM_STOPPED:  'stream_stopped',

  // Quality
  SET_QUALITY:     'set_quality',
  QUALITY_CHANGED: 'quality_changed',

  // Stats
  STATS_REQUEST:   'stats_request',
  STATS_RESPONSE:  'stats_response',

  // Device info
  DEVICE_INFO:     'device_info',

  // Error
  ERROR:           'error',

  // Keep-alive
  PING:            'ping',
  PONG:            'pong',
};

// ─── Audio Packet Header (binary, 12 bytes) ───────────────────────────────────
/**
 * Offset  Size  Field
 * 0       4     sequence number (uint32 BE)
 * 4       4     timestamp in ms (uint32 BE)
 * 8       2     payload length (uint16 BE)
 * 10      1     flags  (bit 0 = last-in-frame)
 * 11      1     reserved
 */
const AUDIO_HEADER_SIZE = 12;

function encodeAudioHeader(seq, timestampMs, payloadLen, flags = 0) {
  const buf = Buffer.allocUnsafe(AUDIO_HEADER_SIZE);
  buf.writeUInt32BE(seq,         0);
  buf.writeUInt32BE(timestampMs, 4);
  buf.writeUInt16BE(payloadLen,  8);
  buf[10] = flags;
  buf[11] = 0;
  return buf;
}

function decodeAudioHeader(buf) {
  return {
    seq:         buf.readUInt32BE(0),
    timestampMs: buf.readUInt32BE(4),
    payloadLen:  buf.readUInt16BE(8),
    flags:       buf[10],
  };
}

// ─── Discovery Beacon ─────────────────────────────────────────────────────────
function encodeDiscoveryBeacon(deviceName, controlPort) {
  return JSON.stringify({
    app:     'audio-relay',
    version: PROTOCOL_VERSION,
    device:  deviceName,
    port:    controlPort,
  });
}

function decodeDiscoveryBeacon(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj.app !== 'audio-relay') return null;
    return obj;
  } catch {
    return null;
  }
}

module.exports = {
  PROTOCOL_VERSION,
  PORTS,
  CONNECTION_MODE,
  STREAM_DIRECTION,
  QUALITY_PRESET,
  MSG,
  AUDIO_HEADER_SIZE,
  encodeAudioHeader,
  decodeAudioHeader,
  encodeDiscoveryBeacon,
  decodeDiscoveryBeacon,
};
