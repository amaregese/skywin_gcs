import math
import os
import threading
import time
from flask import Flask, render_template, request, jsonify, send_from_directory
from flask_socketio import SocketIO, emit

from sgc.communication.connection_manager import MAVLinkConnection
from sgc.gui.param_defs import get_metadata
from sgc.firmware.routes import firmware_bp, init_firmware_module

app = Flask(__name__, static_folder="gui/static", template_folder="gui/templates")
app.config["SECRET_KEY"] = "sgc-secret"
socketio = SocketIO(app, cors_allowed_origins="*")

_connection = None
_connection_lock = threading.Lock()
_pending_reboot_conn = None  # (conn_str, baud) saved before reboot
_last_mission = None  # last downloaded mission data
_last_fence = None    # last downloaded fence data
_last_rally = None    # last downloaded rally data
_log_buffer = []  # last 200 log messages
_startup_done = False

# Register firmware blueprint
app.register_blueprint(firmware_bp)
init_firmware_module(socketio)


def _broadcast(event, data):
    if event == "log":
        _log_buffer.append(data)
        if len(_log_buffer) > 200:
            _log_buffer[:] = _log_buffer[-200:]
    socketio.emit(event, data)


@app.route("/logo.png")
def logo():
    return send_from_directory(
        os.path.join(app.root_path, "..", "resources", "logo"), "swl.png"
    )

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/plan")
def plan_page():
    return render_template("plan.html")


@app.route("/params")
def params_page():
    return render_template("params.html")


@app.route("/tuning")
def tuning_page():
    return render_template("tuning.html")

@app.route("/fence")
def fence_page():
    return render_template("fence.html")

@app.route("/rally")
def rally_page():
    return render_template("rally.html")


@app.route("/motor_test")
def motor_test_page():
    return render_template("motor_test.html")


@app.route("/rc_override")
def rc_override_page():
    return render_template("rc_override.html")


@app.route("/survey")
def survey_page():
    return render_template("survey.html")


@app.route("/config")
def config_page():
    return render_template("config.html")


@app.route("/api/params/snapshot")
def params_snapshot():
    if not _connection or not _connection.running:
        return jsonify({"params": [], "count": 0})
    items = []
    for name, info in _connection.params.items():
        meta = get_metadata(name)
        items.append({
            "name": name,
            "value": info["value"],
            "type": info["type"],
            "index": info.get("index", 0),
            "count": len(_connection.params),
            "description": meta.get("description", ""),
            "human_name": meta.get("human_name", ""),
            "units": meta.get("units", ""),
            "range": meta.get("range", ""),
            "reboot": meta.get("reboot", False),
            "values": meta.get("values", {}),
        })
    items.sort(key=lambda p: p["index"])
    max_count = max((info.get("count", 0) for info in _connection.params.values()), default=0)
    return jsonify({"params": items, "count": max_count or len(items)})


@app.route("/api/params/download")
def download_params():
    if not _connection or not _connection.running:
        return "Not connected", 400
    lines = []
    for name, info in sorted(_connection.params.items(), key=lambda x: x[1].get("index", 9999)):
        val = info["value"]
        if isinstance(val, float):
            val_str = f"{val:.6f}"
        else:
            val_str = str(val)
        lines.append(f"{name}\t{val_str}")
    content = "# SGC parameter export\n" + "\n".join(lines)
    from flask import Response
    return Response(
        content,
        mimetype="text/plain",
        headers={"Content-Disposition": "attachment; filename=params.param"},
    )


@app.route("/api/params/upload", methods=["POST"])
def upload_params():
    if not _connection or not _connection.running:
        return jsonify({"error": "Not connected"}), 400
    if "file" not in request.files:
        return jsonify({"error": "No file"}), 400
    file = request.files["file"]
    if not file:
        return jsonify({"error": "Empty file"}), 400
    try:
        text = file.read().decode("utf-8")
    except Exception:
        return jsonify({"error": "Cannot read file"}), 400

    count = 0
    errors = []
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or line.startswith("//"):
            continue
        parts = line.replace("\t", " ").split(None, 1)
        if len(parts) != 2:
            continue
        name, val_str = parts
        try:
            val = float(val_str)
            _connection.set_param(name, val)
            count += 1
        except Exception as e:
            errors.append(f"{name}: {e}")
    return jsonify({"loaded": count, "errors": errors, "total": count + len(errors)})


@app.route("/api/param_set", methods=["POST"])
def api_param_set():
    if not _connection or not _connection.running:
        return jsonify({"error": "Not connected"}), 400
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400
    name = data.get("name", "")
    value = data.get("value", 0)
    try:
        _connection.set_param(name, value)
        return jsonify({"ok": True, "name": name, "value": value})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/state")
def get_state():
    if _connection:
        return _connection.state
    return {"connected": False}


@app.route("/api/ports")
def list_ports():
    try:
        baud = request.args.get("baud", 57600, type=int)
        timeout = request.args.get("timeout", 2, type=int)
        ports = MAVLinkConnection.detect_ports(baud=baud, timeout=timeout)
        return jsonify(ports)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@socketio.on("connect_request")
def handle_connect_request(data=None):
    global _connection, _startup_done
    if _startup_done:
        emit("log", {"message": "Already attempted connection", "level": "warning"})
        return
    _startup_done = True

    conn_str = data.get("connection", "udpin:0.0.0.0:14550") if data else "udpin:0.0.0.0:14550"
    baud = int(data.get("baud", 57600)) if data else 57600

    emit("log", {"message": f"Connecting to {conn_str} @ {baud} baud...", "level": "info"})

    threading.Thread(target=_do_connect, args=(conn_str, baud), daemon=True).start()

def _do_connect(conn_str, baud):
    global _connection, _startup_done
    try:
        conn = MAVLinkConnection(conn_str, baud=baud)
        conn.add_listener(_on_mavlink_event)
        if conn.connect():
            with _connection_lock:
                _connection = conn
            _broadcast("log", {"message": "Connected to vehicle", "level": "success"})
            return
    except Exception as e:
        _broadcast("log", {"message": f"Connection failed: {e}", "level": "error"})
    _broadcast("log", {"message": "Connection failed — no vehicle detected", "level": "warning"})
    _startup_done = False

@socketio.on("disconnect_request")
def handle_disconnect_request():
    global _connection, _startup_done
    with _connection_lock:
        if _connection:
            _connection.disconnect()
            _connection = None
    _startup_done = False
    _broadcast("log", {"message": "Disconnected from vehicle", "level": "info"})


@socketio.on("connect")
def on_connect():
    if _connection and _connection.running:
        emit("state_update", _connection.state)


@socketio.on("start_tlog")
def handle_start_tlog(data=None):
    conn = _connection
    if not conn or not conn.running:
        emit("log", {"message": "Not connected", "level": "error"})
        return
    logs_dir = os.path.join(app.root_path, "..", "logs")
    os.makedirs(logs_dir, exist_ok=True)
    fname = f"flight_{time.strftime('%Y%m%d_%H%M%S')}.log"
    path = os.path.join(logs_dir, fname)
    ok = conn.start_tlog(path)
    if ok:
        emit("tlog_status", {"active": True, "path": fname})

@socketio.on("stop_tlog")
def handle_stop_tlog():
    conn = _connection
    if conn:
        conn.stop_tlog()
    emit("tlog_status", {"active": False})


@socketio.on("start_inspector")
def handle_start_inspector():
    conn = _connection
    if conn:
        conn._inspector_active = True
    emit("inspector_status", {"active": True})

@socketio.on("stop_inspector")
def handle_stop_inspector():
    conn = _connection
    if conn:
        conn._inspector_active = False
    emit("inspector_status", {"active": False})

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

        try:
            if cmd == "RTL":
                _connection.rtl()
                _broadcast("log", {"message": "RTL command sent", "level": "info"})
            elif cmd == "LAND":
                _connection.land()
                _broadcast("log", {"message": "LAND command sent", "level": "info"})
            elif cmd == "TAKEOFF":
                alt = data.get("altitude", 10)
                _connection.takeoff(alt)
            elif cmd == "GUIDED_GOTO":
                lat = data.get("lat", 0)
                lon = data.get("lon", 0)
                alt = data.get("altitude", 50)
                _connection.set_mode("GUIDED")
                _connection.goto_position(lat, lon, alt)
        except Exception as e:
            _broadcast("log", {"message": f"Command error: {e}", "level": "error"})


@socketio.on("motor_test")
def handle_motor_test(data):
    motor = data.get("motor", 1)
    test_type = data.get("type", 0)
    throttle = data.get("throttle", 0)
    timeout = data.get("timeout", 3)
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        try:
            _connection.motor_test(motor, test_type, throttle, timeout)
        except Exception as e:
            _broadcast("log", {"message": f"Motor test error: {e}", "level": "error"})


@socketio.on("rc_override")
def handle_rc_override(data):
    channels = data.get("channels", {})
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        try:
            _connection.rc_override(channels)
        except Exception as e:
            _broadcast("log", {"message": f"RC override error: {e}", "level": "error"})


@socketio.on("reboot_fcu")
def handle_reboot():
    global _connection, _pending_reboot_conn
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        _pending_reboot_conn = (_connection.connection_string, _connection.baud)
        _connection.reboot()
        emit("log", {"message": "Reboot command sent to FCU — will auto-reconnect when it comes back", "level": "info"})


@socketio.on("calibrate")
def handle_calibrate(data):
    cal_type = data.get("type", "")
    confirm = data.get("confirm", False)
    position = data.get("position", 0)
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        _connection.calibrate(cal_type, confirm=confirm, position=position)


@socketio.on("param_request")
def handle_param_request():
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return

        sid = request.sid

        def on_param(name, info, idx, count):
            meta = get_metadata(name)
            payload = {
                "name": name,
                "value": info["value"],
                "type": info["type"],
                "index": idx,
                "count": count,
                "description": meta.get("description", ""),
                "human_name": meta.get("human_name", ""),
                "units": meta.get("units", ""),
                "range": meta.get("range", ""),
                "reboot": meta.get("reboot", False),
                "values": meta.get("values", {}),
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


@socketio.on("mission_upload")
def handle_mission_upload(data):
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        waypoints = data.get("waypoints", [])
        _connection.upload_mission(waypoints)


@socketio.on("mission_download")
def handle_mission_download():
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return

        def _on_mission(wps):
            global _last_mission
            user_wps = [wp for wp in wps if wp.get('seq', 0) > 0]
            _last_mission = {"waypoints": user_wps, "count": len(user_wps)}
            socketio.emit("mission_data", _last_mission)

        _connection.download_mission(callback=_on_mission)


@socketio.on("fence_download")
def handle_fence_download():
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        _connection.download_fence()

@socketio.on("fence_upload")
def handle_fence_upload(data):
    try:
        print("__FENCE_UPLOAD_HANDLER_START__", flush=True)
        _broadcast("log", {"message": "__FENCE_UPLOAD_HANDLER_START__", "level": "info"})
        from pymavlink.dialects.v20.ardupilotmega import MAV_CMD_DO_FENCE_ENABLE
        with _connection_lock:
            if not (_connection and _connection.running):
                emit("log", {"message": "Not connected", "level": "warning"})
                return
            points = data.get("points", [])
            pts = [(p['lat'], p['lon']) for p in points]
            _connection.upload_fence(pts)
            r1 = _connection.set_param("FENCE_ACTION", 1)
            r2 = _connection.set_param("FENCE_TYPE", 1)
            _broadcast("log", {"message": f"set_param FENCE_ACTION={'OK' if r1 else 'FAIL'}, FENCE_TYPE={'OK' if r2 else 'FAIL'}", "level": "info"})
            _connection.master.mav.command_long_send(
                _connection.master.target_system,
                _connection.master.target_component,
                MAV_CMD_DO_FENCE_ENABLE, 0,
                1, 0, 0, 0, 0, 0, 0,
            )
            _broadcast("log", {"message": "Reading back fence params to verify...", "level": "info"})
            def on_param(name, info, idx, count):
                if name in ("FENCE_ACTION", "FENCE_TYPE", "FENCE_TOTAL", "FENCE_ENABLE"):
                    _broadcast("log", {"message": f"  {name} = {info['value']}", "level": "info"})
                    if name == "FENCE_ENABLE":
                        _connection._param_listeners.remove(on_param)
            _connection._param_listeners.append(on_param)
            _connection.master.mav.param_request_read_send(
                _connection.master.target_system, _connection.master.target_component,
                b'FENCE_ACTION\x00\x00\x00\x00', -1,
            )
            _connection.master.mav.param_request_read_send(
                _connection.master.target_system, _connection.master.target_component,
                b'FENCE_TYPE\x00\x00\x00\x00', -1,
            )
            _connection.master.mav.param_request_read_send(
                _connection.master.target_system, _connection.master.target_component,
                b'FENCE_TOTAL\x00\x00\x00\x00', -1,
            )
            _connection.master.mav.param_request_read_send(
                _connection.master.target_system, _connection.master.target_component,
                b'FENCE_ENABLE\x00\x00\x00\x00', -1,
            )
            # Force FENCE_STATUS message from FCU
            import pymavlink.dialects.v20.ardupilotmega as _mav2
            _connection.master.mav.command_long_send(
                _connection.master.target_system, _connection.master.target_component,
                _mav2.MAV_CMD_REQUEST_MESSAGE, 0,
                157, 0, 0, 0, 0, 0, 0,  # msg 157 = FENCE_STATUS
            )
    except Exception as e:
        _broadcast("log", {"message": f"__FENCE_UPLOAD_CRASHED__: {e}", "level": "error"})

@socketio.on("fence_clear")
def handle_fence_clear():
    with _connection_lock:
        if _connection:
            _connection.clear_fence()
            emit("fence_data", {"points": [], "count": 0})

@socketio.on("fence_enable")
def handle_fence_enable(data):
    from pymavlink.dialects.v20.ardupilotmega import MAV_CMD_DO_FENCE_ENABLE
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        enable = data.get("enable", True)
        if enable:
            r1 = _connection.set_param("FENCE_ACTION", 1)
            r2 = _connection.set_param("FENCE_TYPE", 1)
            _broadcast("log", {"message": f"set_param FENCE_ACTION={'OK' if r1 else 'FAIL'}, FENCE_TYPE={'OK' if r2 else 'FAIL'}", "level": "info"})
            _connection.master.mav.command_long_send(
                _connection.master.target_system,
                _connection.master.target_component,
                MAV_CMD_DO_FENCE_ENABLE, 0,
                1, 0, 0, 0, 0, 0, 0,
            )
            _broadcast("log", {"message": "Fence enabled (params first, then DO_FENCE_ENABLE)", "level": "info"})
        else:
            from pymavlink.dialects.v20.ardupilotmega import MAV_CMD_DO_FENCE_ENABLE
            _connection.master.mav.command_long_send(
                _connection.master.target_system,
                _connection.master.target_component,
                MAV_CMD_DO_FENCE_ENABLE, 0,
                0, 0, 0, 0, 0, 0, 0,
            )
            _broadcast("log", {"message": "Fence disabled", "level": "info"})

@socketio.on("rally_download")
def handle_rally_download():
    with _connection_lock:
        if not (_connection and _connection.running):
            emit("log", {"message": "Not connected", "level": "warning"})
            return
        _connection.download_rally()

@socketio.on("rally_upload")
def handle_rally_upload(data):
    try:
        with _connection_lock:
            if not (_connection and _connection.running):
                emit("log", {"message": "Not connected", "level": "warning"})
                return
            points = data.get("points", [])
            pts = [(p['lat'], p['lon'], p.get('alt', 100)) for p in points]
            _connection.upload_rally(pts)
    except Exception as e:
        _broadcast("log", {"message": f"Rally upload crashed: {e}", "level": "error"})

@socketio.on("rally_clear")
def handle_rally_clear():
    with _connection_lock:
        if _connection:
            _connection.clear_rally()
            emit("rally_data", {"points": [], "count": 0})

def _on_mavlink_event(event, data):
    global _last_mission, _last_fence, _last_rally
    if event == "log":
        _broadcast("log", data)
    elif event == "state_update":
        _broadcast("state_update", data)
        if not data.get("connected", True):
            _last_mission = None
            _last_fence = None
            _last_rally = None
            _broadcast("mission_data", {"waypoints": [], "count": 0})
            _broadcast("fence_data", {"points": [], "count": 0})
            _broadcast("rally_data", {"points": [], "count": 0})
            if _pending_reboot_conn:
                thread = threading.Thread(target=_auto_reconnect, daemon=True)
                thread.start()
    elif event == "mission_data":
        _last_mission = data
        _broadcast("mission_data", data)
    elif event == "mission_upload_complete":
        _broadcast("mission_upload_complete", data)
    elif event == "mavlink_raw":
        _broadcast("mavlink_raw", data)
    elif event == "inspector_status":
        _broadcast("inspector_status", data)
    elif event == "fence_data":
        _last_fence = data
        _broadcast("fence_data", data)
    elif event == "fence_upload_complete":
        _broadcast("fence_upload_complete", data)
    elif event == "rally_data":
        _last_rally = data
        _broadcast("rally_data", data)
    elif event == "rally_upload_complete":
        _broadcast("rally_upload_complete", data)


@socketio.on("request_mission")
def handle_request_mission():
    if _last_mission:
        emit("mission_data", _last_mission)


@socketio.on("request_fence")
def handle_request_fence():
    if _last_fence:
        emit("fence_data", _last_fence)

@socketio.on("request_rally")
def handle_request_rally():
    if _last_rally:
        emit("rally_data", _last_rally)


@socketio.on("request_logs")
def handle_request_logs():
    for msg in _log_buffer:
        emit("log", msg)


def _auto_reconnect():
    global _connection, _pending_reboot_conn
    conn_str, baud = _pending_reboot_conn
    _pending_reboot_conn = None  # only one attempt series

    _broadcast("log", {"message": "FCU disconnected after reboot, waiting for it to come back...", "level": "info"})

    for attempt in range(30):  # retry for ~60s
        time.sleep(2)
        with _connection_lock:
            if _connection and _connection.running:
                return  # already reconnected
        try:
            conn = MAVLinkConnection(conn_str, baud=baud)
            conn.add_listener(_on_mavlink_event)
            if conn.connect():
                with _connection_lock:
                    _connection = conn
                _broadcast("log", {"message": "Auto-reconnected after reboot", "level": "success"})
                return
        except Exception:
            pass
        if (attempt + 1) % 5 == 0:
            _broadcast("log", {"message": f"Waiting for FCU... ({attempt + 1}/30)", "level": "mavlink"})

    _broadcast("log", {"message": "Auto-reconnect timed out — no vehicle detected", "level": "error"})


