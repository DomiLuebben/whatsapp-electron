# WhatsApp Electron for Linux

An unofficial, security-conscious Electron wrapper for WhatsApp Web on Linux.
It provides a native desktop window, tray integration, notifications, unread
badges, and working voice and video call controls.

> [!IMPORTANT]
> This project is not affiliated with, endorsed by, or sponsored by WhatsApp
> or Meta. WhatsApp is a trademark of Meta Platforms, Inc.

> [!NOTE]
> This is a **Linux-only** desktop application. The downloadable binary package
> currently targets Arch Linux on x86_64. Debian, Ubuntu, and Fedora users can
> build the AppImage from the same source; no Windows or macOS packages are
> provided.

## Downloads

The Linux 1.1.0 release provides:

- [Arch Linux x86_64 package](https://github.com/DomiLuebben/whatsapp-electron/releases/download/v1.1.0/whatsapp-electron-1.1.0-1-x86_64.pkg.tar.zst)
- [Source code archive](https://github.com/DomiLuebben/whatsapp-electron/releases/download/v1.1.0/whatsapp-electron-1.1.0-source.tar.gz)
- [SHA-256 checksums](https://github.com/DomiLuebben/whatsapp-electron/releases/download/v1.1.0/SHA256SUMS)
- [All files and release notes](https://github.com/DomiLuebben/whatsapp-electron/releases/tag/v1.1.0)

Install the downloaded Arch package with:

```bash
sudo pacman -U ./whatsapp-electron-1.1.0-1-x86_64.pkg.tar.zst
```

## Why voice and video calls work

WhatsApp Web may hide its call buttons when it detects Electron in Chromium's
User-Agent Client Hints. Changing only the traditional `User-Agent` header is
not enough because the site can also inspect `Sec-CH-UA` headers and
`navigator.userAgentData`.

This wrapper presents one consistent, regular Chromium identity before
WhatsApp Web is loaded:

- Electron is removed from the navigation and subresource User-Agent.
- `Sec-CH-UA` and the high-entropy Client Hint headers are kept consistent.
- `navigator.userAgentData` is patched in the main JavaScript world before the
  page scripts run.
- Chromium background throttling is disabled so ongoing calls remain stable
  when the window is not focused.
- Camera and microphone access is permitted only for trusted HTTPS WhatsApp
  origins and only inside the main application window.
- Screen sharing requires an explicit user gesture and a manual screen
  selection instead of silently choosing a source.

As a result, WhatsApp Web exposes its voice and video call interface and can
use the camera and microphone through Electron. This relies on WhatsApp Web's
current browser checks, so a future service-side change may require an update
to the wrapper.

## Features

- Voice and video calls through WhatsApp Web
- Native Wayland support through current Electron releases
- Camera, microphone, notification, fullscreen, and display-capture permissions
  restricted to trusted WhatsApp HTTPS origins
- Explicit screen selection for screen sharing
- Tray icon, unread badge, and persistent window position
- Automatic retry after temporary network or renderer failures
- External links opened safely in the system browser
- Sandboxed renderer with Node.js integration disabled
- Restrictive Electron fuses in packaged builds

## Build requirements

- Linux on x86_64
- Node.js 24 for reproducible source builds (see `.nvmrc`)
- npm, which is included with Node.js when using a version manager
- A working camera and microphone for calls
- PipeWire and a suitable XDG desktop portal for screen sharing on Wayland

Node.js 26 is intentionally not accepted by the build check yet because the
currently used electron-builder release does not support it reliably.

The commands below use [nvm](https://github.com/nvm-sh/nvm) to select Node.js
24. An equivalent Node.js version manager can be used instead.

## Build on Arch Linux

```bash
sudo pacman -S --needed base-devel git

git clone https://github.com/DomiLuebben/whatsapp-electron.git
cd whatsapp-electron
nvm install 24
nvm use 24
npm ci
npm test
npm run build:dir

cd arch-pkg
makepkg -sfc
```

The finished package is written to
`arch-pkg/whatsapp-electron-1.1.0-1-x86_64.pkg.tar.zst`. Install it with
`sudo pacman -U` as shown in the download section.

## Build on Debian or Ubuntu

These steps produce an AppImage rather than a native `.deb` package:

```bash
sudo apt update
sudo apt install build-essential git

git clone https://github.com/DomiLuebben/whatsapp-electron.git
cd whatsapp-electron
nvm install 24
nvm use 24
npm ci
npm test
npm run build
```

## Build on Fedora

These steps produce the same Linux AppImage:

```bash
sudo dnf install gcc-c++ make git

git clone https://github.com/DomiLuebben/whatsapp-electron.git
cd whatsapp-electron
nvm install 24
nvm use 24
npm ci
npm test
npm run build
```

On Debian, Ubuntu, and Fedora, the resulting file is written to:

```text
dist/WhatsApp-1.1.0-x86_64.AppImage
```

Make it executable and start it with:

```bash
chmod +x dist/WhatsApp-1.1.0-x86_64.AppImage
./dist/WhatsApp-1.1.0-x86_64.AppImage
```

## Run from source

After installing the distribution prerequisites and selecting Node.js 24:

```bash
npm ci
npm test
npm start
```

Scan the QR code with the WhatsApp mobile application. The session is stored
locally in Electron's `~/.config/WhatsApp` profile and is not removed when the
application is updated.

To start a call, open a conversation and use the phone or camera button shown
by WhatsApp Web. Allow camera and microphone access in your desktop environment
when prompted.

The generated package archives, `node_modules`, and Electron build output are
excluded from Git. The release source archive is generated directly from the
Git tag and therefore contains only tracked source files.

## Security and privacy

- The application loads the official `https://web.whatsapp.com/` client. It
  does not proxy messages through a custom server.
- Navigation inside the application is limited to WhatsApp Web. Other safe web,
  telephone, and email links are handed to the operating system.
- Media permissions are rejected for non-WhatsApp origins.
- WebViews and Node.js access in the renderer are disabled.
- Login data remains in the local Electron profile.

The Chromium identity adjustment is limited to WhatsApp-owned origins. It is
used to expose browser functionality that WhatsApp Web otherwise hides from
Electron clients; it does not bypass account authentication or WhatsApp's
end-to-end encryption.

## Limitations

- Only Linux x86_64 is packaged at the moment.
- The AppImage does not include an automatic updater.
- WhatsApp Web is a third-party service and can change without notice.
- Availability of calls can still depend on the WhatsApp account, region,
  connected devices, and service-side rollout.

## License

The wrapper source code is licensed under
[GPL-2.0-or-later](LICENSE). Electron, Chromium, WhatsApp Web, and the WhatsApp
name and artwork remain subject to their respective licenses and trademarks.
