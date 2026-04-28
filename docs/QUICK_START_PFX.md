# Quick Start: PFx on Raspberry Pi (Single Video + Audio Output)

This guide brings up PFx on one screen/audio output with minimal configuration.

## 1) Prerequisites

Install required packages:

```bash
sudo apt update
sudo apt install -y nodejs npm mosquitto mosquitto-clients mpv xdotool x11-xserver-utils
```

If your install uses Chromium browser overlays, also install Chromium:

```bash
sudo apt install -y chromium-browser || sudo apt install -y chromium
```

## 2) Install dependencies

From the PFx repo root:

```bash
npm install
```

## 3) Create a minimal config

Create a `pfx.ini` in the PFx root with one screen zone and one light zone (optional light zone shown below can be removed):

```ini
[global]
heartbeat_topic = paradox/devices
heartbeat_interval = 5000

[mqtt]
broker = localhost
port = 1883

[screen:main]
type = screen
topic = paradox/demo/screen
media_dir = /opt/paradox/media/test/defaults
display = :0
target_monitor = 0
audio_device = hdmi
volume = 80
```

Notes:
- `media_dir` should point to real media files on your Pi.
- `audio_device = hdmi` works on most Pi HDMI setups.
- If HDMI audio does not route correctly, run [../scripts/pi-audio-discovery.sh](../scripts/pi-audio-discovery.sh) and update device mapping accordingly.

## 4) Start mosquitto and PFx

```bash
sudo systemctl enable --now mosquitto
npm start
```

## 5) Send a test command

In another terminal:

```bash
mosquitto_pub -h localhost -t "paradox/demo/screen/commands" -m '{"command":"setImage","image":"default.png"}'
```

Then test video:

```bash
mosquitto_pub -h localhost -t "paradox/demo/screen/commands" -m '{"command":"playVideo","video":"default.mp4"}'
```

## 6) Optional: install as systemd service

PFx includes a sample service file at [../config/pfx.service](../config/pfx.service).

```bash
sudo cp config/pfx.service /etc/systemd/system/pfx.service
sudo chown root:root /etc/systemd/system/pfx.service
sudo chmod 644 /etc/systemd/system/pfx.service
sudo systemctl daemon-reload
sudo systemctl enable --now pfx.service
```

Treat this unit as a template: review user, paths, and hardening settings for your environment.

## 7) Useful commands

```bash
# Watch PFx logs (if configured to /opt/paradox/logs)
./scripts/watch-logs.sh

# Check service status
sudo systemctl status pfx.service

# Tail service logs
journalctl -u pfx.service -f
```

## Next steps

- Expand INI options: [CONFIG_INI.md](CONFIG_INI.md)
- MQTT command surface: [MQTT_API.md](MQTT_API.md)
- Full specification: [SPEC.md](SPEC.md)
- Script tooling: [../scripts/README.md](../scripts/README.md)
