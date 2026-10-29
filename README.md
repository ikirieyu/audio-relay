<p align="center">
  <img src="AudioRelay%20Wireless%20Logo.png" width="160" alt="AudioRelay Logo" />
</p>

<h1 align="center">AudioRelay Wireless</h1>

<p align="center">
  <b>Low-latency bidirectional audio streaming bridge between PC and Android</b>
</p>

<p align="center">
  <a href="https://github.com/ikirieyu/audio-relay/actions/workflows/build.yml">
    <img src="https://github.com/ikirieyu/audio-relay/actions/workflows/build.yml/badge.svg" alt="Build Status" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" />
  </a>
  <img src="https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20Linux%20%7C%20macOS-informational" alt="Platforms" />
  <img src="https://img.shields.io/badge/Node.js-18%2B-green.svg" alt="Node.js 18+" />
</p>

---

## 📖 Overview

**AudioRelay Wireless** is a high-performance, low-latency audio streaming solution connecting your computer (Windows, macOS, Linux) and Android mobile device. Whether you want to turn your phone into a PC speaker, use your mobile microphone on PC, or stream both simultaneously, AudioRelay delivers real-time audio with customizable buffers and Opus compression.

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🚀 **Low Latency** | Powered by the Opus codec with configurable buffer windows (10–500 ms) |
| 🔄 **Bidirectional** | PC → Android (speaker), Android → PC (mic), or full-duplex bidirectional |
| 📡 **WiFi / LAN** | Automatic UDP discovery beacon (`7370`) and low-latency WebSocket audio |
| 🔌 **USB Cable (ADB)** | Zero-network USB port forwarding via Android Debug Bridge |
| 🔷 **Bluetooth Tunnel** | RFCOMM fallback connection for offline environments |
| 🎛️ **5 Quality Presets** | From *Ultra Low Latency* (monitoring/gaming) to *Studio* (lossless/recording) |
| 🎨 **Modern Desktop App** | Electron-based dark glassmorphism UI with real-time waveform visualizer |
| 📱 **Native Android App** | Capacitor 6 app with adaptive icons and dark theme |
| ⚙️ **Automated CI/CD** | GitHub Actions build workflows for Android APK and Windows Installer |

---

## 📦 Project Architecture

```
audio-relay/
├── AudioRelay Wireless Logo.png     # Official high-res master logo (1254x1254)
├── scripts/
│   ├── dev.js                       # Monorepo concurrent runner
│   └── generate-assets.ps1          # Icon & splash generation script
├── desktop/                         # Electron desktop app (PC server)
│   ├── assets/                      # Generated app icons (icon.ico, icon.png, tray)
│   ├── src/
│   │   ├── main.js                  # Electron main process
│   │   ├── preload.js               # Secure IPC context bridge
│   │   ├── audio/
│   │   │   └── engine.js            # PortAudio + Opus capture & playback
│   │   └── network/
│   │       ├── control-server.js    # WebSocket control channel (port 7372)
│   │       ├── audio-ws-server.js   # Binary audio WebSocket (port 7371)
│   │       ├── discovery.js         # UDP beacon broadcaster (port 7370)
│   │       ├── adb-bridge.js        # ADB USB reverse-port forwarding
│   │       └── bluetooth-bridge.js  # Bluetooth RFCOMM bridge
│   └── renderer/                    # Glassmorphism desktop UI
├── mobile/                          # Capacitor Android client
│   ├── android/                     # Native Android Studio project
│   │   └── app/src/main/res/        # Mipmap launcher icons & splash screens
│   ├── public/                      # Web assets (logo.png)
│   ├── src/
│   │   ├── app.js                   # Main mobile app controller
│   │   ├── audio-engine.js          # Web Audio API + AudioWorklet processor
│   │   └── network-client.js        # Mobile WebSocket network client
│   ├── capacitor.config.json        # Capacitor configuration
│   └── vite.config.js               # Vite build configuration
└── shared/                          # Shared cross-platform protocol
    ├── protocol.js                  # Node.js protocol definitions
    └── protocol-browser.js          # Browser ESM protocol definitions
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: `v18.x` or `v20.x` (LTS recommended)
- **npm**: `v9+`
- **Git**
- *(For Android local builds)*: **Android Studio** (JDK 17, Android SDK API 34)
- *(For USB mode)*: [Android Platform Tools (ADB)](https://developer.android.com/tools/releases/platform-tools)

### 1. Install Dependencies

Install root and workspace dependencies in one command:

```bash
npm run install:all
```

---

### 2. Running Desktop (PC)

Run the desktop application in development mode:

```bash
npm run dev:desktop
# or
cd desktop && npm start
```

Build standalone Windows installer (`.exe` + portable):

```bash
npm run build:exe
```

*The generated `.exe` installer will be located in `desktop/dist/`.*

---

### 3. Running & Building Android App

Run the mobile web preview:

```bash
npm run dev:mobile
```

Build the web bundle and sync to Android:

```bash
npm run build:android
```

Open and run with Android Studio:

```bash
cd mobile
npx cap open android
```

In Android Studio, click **Run (▶)** to test on your phone or emulator, or go to **Build → Build Bundle(s) / APK(s) → Build APK(s)**.

---

## 🎨 Asset & Icon Generation

All application icons (Windows `.ico`, Android `mipmap` adaptive icons, and 11 splash screen resolutions) are automatically generated from `AudioRelay Wireless Logo.png`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\generate-assets.ps1
```

Generated outputs include:
- `desktop/assets/icon.ico`: Multi-size Windows icon (16, 32, 48, 64, 128, 256 px)
- `desktop/assets/icon.png`: 512x512 high-res window icon
- `desktop/assets/tray-icon.png`: 32x32 system tray icon
- `mobile/android/app/src/main/res/mipmap-*`: Android adaptive launcher icons
- `mobile/android/app/src/main/res/drawable-*`: Android launch splash screens
- `mobile/public/logo.png`: Web UI logo

---

## 🎛️ Quality Presets

AudioRelay adjusts bitrate, buffer size, and sample rate to optimize for your network conditions:

| Preset | Buffer | Bitrate | Sample Rate | Channels | Recommended For |
|--------|:------:|:-------:|:-----------:|:--------:|-----------------|
| **Ultra Low Latency** | 20 ms | 64 kbps | 16 kHz | Mono | FPS gaming, live voice monitoring |
| **Low Latency** *(Default)* | 60 ms | 96 kbps | 48 kHz | Stereo | General gaming, video calls |
| **Balanced** | 120 ms | 128 kbps | 48 kHz | Stereo | Video streaming, podcasting |
| **High Quality** | 250 ms | 256 kbps | 48 kHz | Stereo | Hi-Fi music playback |
| **Studio** | 500 ms | 320 kbps | 48 kHz | Stereo | Critical music listening & recording |

---

## 🔌 Connection Modes

### 1. 📶 WiFi / LAN (Fastest & Easiest)
1. Ensure PC and Android device are connected to the same WiFi router or LAN.
2. Launch AudioRelay on your PC.
3. Open the AudioRelay app on Android. Tap the **🔍 Scan** button or manually enter the PC's local IP address (e.g. `192.168.1.50`).
4. Tap **Connect** and select your desired audio direction.

### 2. 🔌 USB Cable (Zero Wireless Interference)
1. Enable **Developer Options** and **USB Debugging** on your Android device:
   - *Settings → About Phone → Tap "Build Number" 7 times.*
   - *Settings → Developer Options → Enable "USB Debugging".*
2. Connect your phone to your PC via USB cable.
3. In AudioRelay Desktop, navigate to **Connections → USB (ADB)** and click **Start ADB Reverse**.
4. In the Android app, switch the mode to **USB** (IP automatically sets to `127.0.0.1`) and tap **Connect**.

### 3. 🔷 Bluetooth
1. Pair your Android device with your PC in Windows Bluetooth settings.
2. In AudioRelay Desktop, open **Connections → Bluetooth** and initiate the connection tunnel.
3. Select **Balanced** or higher preset to compensate for Bluetooth transmission jitter.

---

## 🌐 Network Ports

Make sure these ports are permitted through Windows Firewall or your router:

| Port | Protocol | Purpose |
|:----:|:--------:|---------|
| `7370` | UDP | Discovery beacon for LAN auto-detection |
| `7371` | TCP / WebSocket | Binary Opus/PCM audio streaming channel |
| `7372` | TCP / WebSocket | Control channel (handshakes, quality, stats) |

---

## 🏗️ Automated CI/CD (GitHub Actions)

This repository includes a multi-platform CI/CD workflow defined in [`.github/workflows/build.yml`](.github/workflows/build.yml):

- **Android APK Build**: Builds both debug APK and signed release APK on push / tag.
- **Windows Installer**: Builds Windows NSIS installer (`.exe`) via `electron-builder`.
- **Linux & macOS**: Automated builds for Linux AppImage and macOS DMG.

### Signing Releases (Optional)
To create signed release APKs automatically when pushing tags (`v*`), configure these **GitHub Repository Secrets**:
- `KEYSTORE_BASE64`: Base64 encoded `release.keystore`
- `KEYSTORE_PASS`: Keystore password
- `KEY_ALIAS`: Keystore alias
- `KEY_PASS`: Key alias password

---

## 📝 License

This project is licensed under the **MIT License** — see the [LICENSE](LICENSE) file for details.
