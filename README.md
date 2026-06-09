# Skywin Ground Control Station (SGC)

A dual-interface (Web + Desktop) ground control station for UAVs/drones using the **MAVLink** protocol. Compatible with flight controllers running **ArduPilot** or **PX4** autopilots.

## Features

- **Real-time telemetry** — GPS, battery, altitude, speed, attitude, EKF status, sensor health
- **Interactive map** — Leaflet-based with vehicle tracking, trail, mission/fence overlay (OSM/Satellite/Topo/Dark tiles)
- **Mission planning** — Waypoint add/edit/drag/reverse, upload/download/save/load mission files
- **Parameter management** — Browse, search, filter, edit, save/load `.param` files with metadata from ArduPilot
- **Geo-fence editor** — Create/edit/upload/download fence polygons
- **PID tuning** — Sliders for rate/stabilize/altitude/loiter gains with batch update
- **Sensor calibration** — Gyro, accelerometer, compass, level, radio, pressure
- **Flight mode control** — Mode switching, ARM/DISARM, RTL, LAND, TAKEOFF
- **MAVLink inspector** — Raw message stream with filtering
- **Telemetry logging (TLOG)** — Timestamped log files of all MAVLink traffic
- **Real-time charts** — Altitude, speed, battery voltage/current
- **Desktop GUI** — Tkinter-based companion interface
- **Auto-detect** — Scans serial ports to find connected flight controllers

## Requirements

- Python 3.10+
- Works on Windows, Linux, macOS

## Quick Start

```bash
# Install dependencies
pip install -r requirements.txt

# Run the application
python -m sgc.main
```

Opens at [http://127.0.0.1:5050](http://127.0.0.1:5050).

## Project Structure

```
sgc/                        # Main source package
├── main.py                 # Entry point
├── server.py               # Flask web server, REST API, SocketIO events
├── app.py                  # Core shared state
├── communication/          # MAVLink connection handling
├── gui/
│   ├── main_window.py      # Tkinter desktop GUI
│   ├── param_defs.py       # ArduPilot parameter metadata
│   ├── theme.py            # Tkinter dark theme
│   ├── templates/          # HTML pages (dashboard, plan, params, tuning, fence, config)
│   ├── static/
│   │   ├── css/style.css   # Dark-themed stylesheet
│   │   └── js/             # JavaScript modules
│   └── widgets/            # Tkinter UI widgets
├── mission/                # Mission planner (stubs)
├── data/                   # Data handling (stubs)
├── utils/                  # Utility functions (stubs)
├── vehicles/               # Vehicle abstractions (stubs)
└── config/                 # Configuration (stubs)
```

## Pages

| Route | Page |
|-------|------|
| `/` | Dashboard — telemetry, map, action panel, console, charts |
| `/plan` | Mission planner — waypoints, upload/download |
| `/params` | Parameter browser — search, edit, save/load |
| `/tuning` | PID tuning — gain sliders |
| `/fence` | Geo-fence editor — polygon creation |
| `/config` | Sensor calibration |

## Connections

Supports **Serial**, **TCP Client**, **TCP Server**, and **UDP** connections. Quick-connect to SITL at `udp:127.0.0.1:14550`.
