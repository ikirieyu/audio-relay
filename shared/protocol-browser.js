/**
 * Protocol definitions – Browser/ESM version of shared/protocol.js
 * (No Node.js Buffer; uses Uint8Array and DataView instead)
 */

export const PROTOCOL_VERSION = '1.0.0';

export const PORTS = {
  DISCOVERY: 7370,
  AUDIO:     7371,
  CONTROL:   7372,
};

export const CONNECTION_MODE = {
  WIFI:      'wifi',
  USB:       'usb',
  BLUETOOTH: 'bluetooth',
};

export const STREAM_DIRECTION = {
  PC_TO_ANDROID:  'pc_to_android',
  ANDROID_TO_PC:  'android_to_pc',
  BIDIRECTIONAL:  'bidirectional',
};

export const QUALITY_PRESET = {
  ULTRA_LOW_LATENCY: {
    label: 'Ultra Low Latency', bufferMs: 20,  bitrate: 64000,  frameMs: 10, sampleRate: 16000, channels: 1,
  },
  LOW_LATENCY: {
    label: 'Low Latency',       bufferMs: 60,  bitrate: 96000,  frameMs: 20, sampleRate: 48000, channels: 2,
  },
  BALANCED: {
    label: 'Balanced',          bufferMs: 120, bitrate: 128000, frameMs: 20, sampleRate: 48000, channels: 2,
  },
  HIGH_QUALITY: {
    label: 'High Quality',      bufferMs: 250, bitrate: 256000, frameMs: 20, sampleRate: 48000, channels: 2,
  },
  STUDIO: {
    label: 'Studio',            bufferMs: 500, bitrate: 320000, frameMs: 20, sampleRate: 48000, channels: 2,
  },
};

export const MSG = {
  HELLO: 'hello', HELLO_ACK: 'hello_ack',
  START_STREAM: 'start_stream', STOP_STREAM: 'stop_stream',
  STREAM_STARTED: 'stream_started', STREAM_STOPPED: 'stream_stopped',
  SET_QUALITY: 'set_quality', QUALITY_CHANGED: 'quality_changed',
  STATS_REQUEST: 'stats_request', STATS_RESPONSE: 'stats_response',
  DEVICE_INFO: 'device_info', ERROR: 'error', PING: 'ping', PONG: 'pong',
};

export const AUDIO_HEADER_SIZE = 12;

export function encodeAudioHeader(seq, timestampMs, payloadLen, flags = 0) {
  const buf  = new ArrayBuffer(AUDIO_HEADER_SIZE);
  const view = new DataView(buf);
  view.setUint32(0, seq,         false);
  view.setUint32(4, timestampMs, false);
  view.setUint16(8, payloadLen,  false);
  view.setUint8(10, flags);
  view.setUint8(11, 0);
  return new Uint8Array(buf);
}

export function decodeAudioHeader(buf) {
  const view = new DataView(buf.buffer ?? buf, buf.byteOffset ?? 0);
  return {
    seq:         view.getUint32(0, false),
    timestampMs: view.getUint32(4, false),
    payloadLen:  view.getUint16(8, false),
    flags:       view.getUint8(10),
  };
}

export function encodeDiscoveryBeacon(deviceName, controlPort) {
  return JSON.stringify({
    app: 'audio-relay', version: PROTOCOL_VERSION, device: deviceName, port: controlPort,
  });
}

export function decodeDiscoveryBeacon(raw) {
  try {
    const obj = JSON.parse(raw);
    if (obj.app !== 'audio-relay') return null;
    return obj;
  } catch { return null; }
}
