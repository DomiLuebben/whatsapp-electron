#!/usr/bin/env bash
# Wrapper for /opt/whatsapp-electron/whatsapp.
# Electron detects Wayland through WAYLAND_DISPLAY/XDG_SESSION_TYPE, so no
# backend is forced here.
exec /opt/whatsapp-electron/whatsapp "$@"
