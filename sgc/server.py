import math
import threading
import time
from flask import Flask, render_template, request, jsonify
from flask_socketio import SocketIO, emit

try:
    import serial.tools.list_ports
except ImportError:
    serial = None

from sgc.communication.connection_manager import MAVLinkConnection, FLIGHT_MODES

app = Flask(__name__, static_folder="gui/static", template_folder="gui/templates")
app.config["SECRET_KEY"] = "sgc-secret"
socketio = SocketIO(app, cors_allowed_origins="*")

_connection = None
_connection_lock = threading.Lock()


def _broadcast(event, data):
    socketio.emit(event, data)


def _build_connection_string(conn_type, port, host, port_num):
    if conn_type in ("tcp_client",):
        host = host or "127.0.0.1"
        port_num = port_num or 5760
        return f"tcp:{host}:{port_num}"
    elif conn_type in ("tcp_server",):
        port_num = port_num or 5760
        return f"tcpin:0.0.0.0:{port_num}"
    elif conn_type in ("udp",):
        host = host or "0.0.0.0"
        port_num = port_num or 14550
        return f"udp:{host}:{port_num}"
    else:
        return port or "/dev/ttyACM0"


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/params")
def params_page():
    return render_template("params.html")


@app.route("/api/ports")
def list_ports():
    ports = []
    if serial:
        for p in serial.tools.list_ports.comports():
            ports.append({"device": p.device, "description": p.description})
    return jsonify(ports)


@app.route("/api/auto_scan")
def auto_scan():
    baud = request.args.get("baud", 57600, type=int)
    timeout = request.args.get("timeout", 2, type=int)

    def _scan():
        results = MAVLinkConnection.detect_ports(baud=baud, timeout=timeout)
        return jsonify({"found": results})

    thread = threading.Thread(target=lambda: None)
    results = MAVLinkConnection.detect_ports(baud=baud, timeout=timeout)
    return jsonify({"found": results})


@app.route("/api/state")
def get_state():
    if _connection:
        return _connection.state
    return {"connected": False}


@socketio.on("connect")
def on_connect():
    emit("log", {"message": "Connected to SGC server", "level": "system"})
    emit("log", {"message": "SGC - Skywin Ground Control Station v0.1.0", "level": "system"})
    emit("log", {"message": "Select port and click CONNECT to link with your flight controller.", "level": "info"})
    if _connection and _connection.running:
        emit("state_update", _connection.state)


@socketio.on("connect_vehicle")
def handle_connect(data):
    global _connection

    with _connection_lock:
        if _connection and _connection.running:
            emit("log", {"message": "Already connected. Disconnect first.", "level": "warning"})
            return

        conn_type = data.get("type", "serial")
        port = data.get("port", "/dev/ttyACM0")
        baud = int(data.get("baud", 57600))
        host = data.get("host", "")
        port_num = data.get("port_num", 0)

        conn_str = _build_connection_string(conn_type, port, host, port_num)

        def _connect_and_stream():
            global _connection
            conn = MAVLinkConnection(conn_str, baud=baud)
            conn.add_listener(_on_mavlink_event)

            with _connection_lock:
                _connection = conn

            if conn.connect():
                emit("log", {"message": "Real-time telemetry streaming active", "level": "system"})
            else:
                with _connection_lock:
                    _connection = None

        thread = threading.Thread(target=_connect_and_stream, daemon=True)
        thread.start()


@socketio.on("disconnect_vehicle")
def handle_disconnect():
    global _connection
    with _connection_lock:
        if _connection:
            _connection.disconnect()
            _connection = None


@socketio.on("set_mode")
def handle_set_mode(data):
    with _connection_lock:
        if _connection and _connection.running:
            _connection.set_mode(data.get("mode", "GUIDED"))


@socketio.on("arm")
def handle_arm():
    with _connection_lock:
        if _connection and _connection.running:
            _connection.arm()


@socketio.on("disarm")
def handle_disarm():
    with _connection_lock:
        if _connection and _connection.running:
            _connection.disarm()


@socketio.on("command")
def handle_command(data):
    cmd = data.get("command", "")
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return

        if cmd == "RTL":
            _connection.rtl()
        elif cmd == "LAND":
            _connection.land()
        elif cmd == "TAKEOFF":
            alt = data.get("altitude", 10)
            _connection.takeoff(alt)


@socketio.on("param_request")
def handle_param_request():
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return

        sid = request.sid

        def on_param(name, info, idx, count):
            payload = {
                "name": name,
                "value": info["value"],
                "type": info["type"],
                "index": idx,
                "count": count,
            }
            socketio.emit("param_value", payload, to=sid)

        _connection.request_params(callback=on_param)


@socketio.on("param_set")
def handle_param_set(data):
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        name = data.get("name", "")
        value = data.get("value", 0)
        _connection.set_param(name, value)


def _on_mavlink_event(event, data):
    if event == "log":
        _broadcast("log", data)
    elif event == "state_update":
        _broadcast("state_update", data)
