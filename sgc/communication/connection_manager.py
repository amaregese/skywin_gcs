import math
import os
import socket
import threading
import time
from pymavlink import mavutil

try:
    import serial.tools.list_ports
except ImportError:
    serial = None


FLIGHT_MODES = {
    0: "STABILIZE", 1: "ACRO", 2: "ALT_HOLD", 3: "AUTO",
    4: "GUIDED", 5: "LOITER", 6: "RTL", 7: "CIRCLE",
    9: "LAND", 11: "DRIFT", 13: "SPORT", 14: "FLIP",
    15: "AUTOTUNE", 16: "POSHOLD", 17: "BRAKE",
    18: "THROW", 19: "AVOID_ADSB", 20: "GUIDED_NOGPS",
    21: "SMART_RTL", 22: "FLOWHOLD", 23: "FOLLOW",
    24: "ZIGZAG", 25: "SYSTEM_ID", 26: "AUTOROTATE", 27: "AUTO_RTL",
}

FLIGHT_MODES_NAME_TO_ID = {v: k for k, v in FLIGHT_MODES.items()}

VEHICLE_TYPES = {
    mavutil.mavlink.MAV_TYPE_QUADROTOR: "QuadCopter",
    mavutil.mavlink.MAV_TYPE_HEXAROTOR: "HexaCopter",
    mavutil.mavlink.MAV_TYPE_OCTOROTOR: "OctoCopter",
    mavutil.mavlink.MAV_TYPE_TRICOPTER: "TriCopter",
    mavutil.mavlink.MAV_TYPE_FIXED_WING: "Plane",
    mavutil.mavlink.MAV_TYPE_GROUND_ROVER: "Rover",
    mavutil.mavlink.MAV_TYPE_SURFACE_BOAT: "Boat",
    mavutil.mavlink.MAV_TYPE_SUBMARINE: "Submarine",
    mavutil.mavlink.MAV_TYPE_HELICOPTER: "Helicopter",
    mavutil.mavlink.MAV_TYPE_VTOL_DUOROTOR: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_QUADROTOR: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_TILTROTOR: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_RESERVED2: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_RESERVED3: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_RESERVED4: "VTOL",
    mavutil.mavlink.MAV_TYPE_VTOL_RESERVED5: "VTOL",
}

AUTOPILOTS = {
    mavutil.mavlink.MAV_AUTOPILOT_ARDUPILOTMEGA: "ArduPilot",
    mavutil.mavlink.MAV_AUTOPILOT_PX4: "PX4 Pro",
}

FIX_TYPES = {0: "No Fix", 1: "No Fix", 2: "2D", 3: "3D",
             4: "DGPS", 5: "RTK Float", 6: "RTK Fixed"}

COMMAND_NAMES = {
    mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM: "ARM/DISARM",
    mavutil.mavlink.MAV_CMD_DO_SET_MODE: "SET_MODE",
    mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH: "RTL",
    mavutil.mavlink.MAV_CMD_NAV_LAND: "LAND",
    mavutil.mavlink.MAV_CMD_NAV_TAKEOFF: "TAKEOFF",
    mavutil.mavlink.MAV_CMD_MISSION_START: "START_MISSION",
    mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION: "CALIBRATION",
    mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN: "REBOOT",
    mavutil.mavlink.MAV_CMD_ACCELCAL_VEHICLE_POS: "ACCELCAL_VEHICLE_POS",
    mavutil.mavlink.MAV_CMD_DO_MOTOR_TEST: "DO_MOTOR_TEST",
}

CMD_RESULTS = {0: "Accepted", 1: "Temp Reject", 2: "Denied", 3: "Unsupported",
               4: "Failed", 5: "In Progress", 6: "Cancelled"}

STATUSTEXT_SEVERITY = {0: "emergency", 1: "alert", 2: "critical", 3: "error",
                       4: "warning", 5: "notice", 6: "info", 7: "debug"}

PARAM_TYPES = {
    mavutil.mavlink.MAV_PARAM_TYPE_UINT8: "uint8",
    mavutil.mavlink.MAV_PARAM_TYPE_INT8: "int8",
    mavutil.mavlink.MAV_PARAM_TYPE_UINT16: "uint16",
    mavutil.mavlink.MAV_PARAM_TYPE_INT16: "int16",
    mavutil.mavlink.MAV_PARAM_TYPE_UINT32: "uint32",
    mavutil.mavlink.MAV_PARAM_TYPE_INT32: "int32",
    mavutil.mavlink.MAV_PARAM_TYPE_REAL32: "float",
    mavutil.mavlink.MAV_PARAM_TYPE_REAL64: "double",
}


class MAVLinkConnection:
    def __init__(self, connection_string, baud=57600, source_system=255):
        # Normalize Windows COM ports (COM10+ need \\.\ prefix for os.path.exists and pymavlink)
        if os.name == "nt" and connection_string.startswith("COM") and not connection_string.startswith("\\\\.\\"):
            connection_string = "\\\\.\\" + connection_string
        self.connection_string = connection_string
        self.baud = baud
        self.source_system = source_system
        self.master = None
        self.running = False
        self._thread = None
        self.listeners = []

        self.state = {
            "connected": False,
            "lat": 0.0, "lon": 0.0, "alt": 0.0,
            "relative_alt": 0.0,
            "ground_speed": 0.0, "air_speed": 0.0,
            "heading": 0.0,
            "battery_voltage": 0.0, "battery_current": 0.0,
            "battery_remaining": -1,
            "roll": 0.0, "pitch": 0.0, "yaw": 0.0,
            "mode": "---", "armed": False,
            "satellites": 0, "hdop": 99.99, "fix_type": 0,
            "throttle": 0,
            "sysid": 0, "compid": 0,
            "vehicle_type": "---", "firmware": "---",
        }

        self.params = {}
        self._param_count = 0
        self._param_listeners = []
        self._requesting_params = False
        self._ref_pressure = None

        self._mission_state = None
        self._mission_listeners = []
        self._mission_upload_phase = 0  # 0=idle, 1=clearing, 2=uploading, 3=done

        self._tlog_file = None
        self._inspector_active = False

        self.fence_points = []  # list of (lat, lon)
        self._fence_count = 0
        self._fence_download_seq = None

        self.rally_points = []  # list of (lat, lon, alt)
        self._rally_count = 0
        self._rally_download_seq = None

        # Calibration advance tracking (server-side, cache-independent)
        self._cal_pending_advance = False
        self._cal_advance_type = None

    def add_listener(self, callback):
        self.listeners.append(callback)

    def _emit(self, event, data=None):
        for cb in self.listeners:
            try:
                cb(event, data)
            except Exception:
                pass

    def _probe(self):
        cs = self.connection_string

        if cs.startswith("udpout:"):
            rest = cs[len("udpout:"):]
            host, _, port = rest.partition(":")
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.settimeout(2)
            try:
                s.connect((host, int(port)))
                s.send(b"\x00")
                s.recv(1)
                self._emit("log", {"message": f"Probe: {host}:{port} responded", "level": "info"})
            except socket.timeout:
                self._emit("log", {"message": f"Probe: {host}:{port} reachable (no data)", "level": "info"})
            except ConnectionRefusedError:
                self._emit("log", {"message": f"Probe: {host}:{port} — nothing listening", "level": "warning"})
            except Exception as e:
                self._emit("log", {"message": f"Probe: {host}:{port} — {e}", "level": "warning"})
            finally:
                s.close()

        elif cs.startswith("/dev/") or cs.startswith("COM") or cs.startswith("\\\\.\\"):
            probe_path = ("\\\\.\\" + cs) if (cs.startswith("COM") and os.name == "nt") else cs
            if not os.path.exists(probe_path):
                self._emit("log", {"message": f"Probe: serial device {cs} not found", "level": "error"})
                return False
            self._emit("log", {"message": f"Probe: serial device {cs} exists", "level": "info"})

        return True

    def connect(self):
        try:
            if not self._probe():
                return False
            self.master = mavutil.mavlink_connection(
                self.connection_string,
                baud=self.baud,
                source_system=self.source_system,
                dialect="ardupilotmega",
            )
            self._emit("log", {
                "message": f"Waiting for heartbeat on {self.connection_string}...",
                "level": "info",
            })

            heartbeat = self.master.wait_heartbeat(timeout=10)
            if heartbeat is None:
                self._emit("log", {"message": "No heartbeat received (timeout)", "level": "error"})
                return False

            # Explicitly set target from heartbeat
            src_sys = heartbeat.get_srcSystem()
            src_comp = heartbeat.get_srcComponent()
            self._emit("log", {"message": f"Heartbeat from sys={src_sys} comp={src_comp} type={getattr(heartbeat, 'type', '?')}", "level": "info"})
            self.master.target_system = src_sys
            # Force target_component to MAV_COMP_ID_AUTOPILOT1 (1) if the
            # heartbeat reports MAV_COMP_ID_ALL (0), since commands addressed
            # to component 0 may not be routed to the autopilot properly
            if src_comp == 0:
                self.master.target_component = 1
            else:
                self.master.target_component = src_comp
            self.state["sysid"] = self.master.target_system
            self.state["compid"] = self.master.target_component
            self.state["connected"] = True

            self._emit("log", {
                "message": f"online system {self.master.target_system}",
                "level": "success",
            })

            self.running = True
            self._ref_pressure = None
            self._thread = threading.Thread(target=self._read_loop, daemon=True)
            self._thread.start()
            self._request_streams()
            self._emit("state_update", self.state)
            return True

        except Exception as e:
            self._emit("log", {"message": f"Connection failed: {e}", "level": "error"})
            return False

    def disconnect(self):
        self.running = False
        self.stop_tlog()
        if self.master:
            try:
                self.master.close()
            except Exception:
                pass
        self.state["connected"] = False
        self._emit("state_update", self.state)
        self._emit("log", {"message": "Disconnected", "level": "warning"})

    def start_tlog(self, path):
        try:
            self._tlog_file = open(path, "w")
            self._emit("log", {"message": f"TLOG started: {path}", "level": "success"})
            return True
        except Exception as e:
            self._emit("log", {"message": f"TLOG start failed: {e}", "level": "error"})
            return False

    def stop_tlog(self):
        if self._tlog_file:
            try:
                self._tlog_file.close()
            except Exception:
                pass
        self._tlog_file = None
        self._emit("log", {"message": "TLOG stopped", "level": "info"})

    def _write_tlog(self, msg):
        if self._tlog_file is None:
            return
        try:
            msg_type = msg.get_type()
            if msg_type == "BAD_DATA":
                return
            from datetime import datetime
            ts = datetime.now().strftime('%H:%M:%S.%f')[:-3]
            parts = []
            for k, v in sorted(msg.__dict__.items()):
                if k.startswith('_'):
                    continue
                if isinstance(v, float):
                    parts.append(f"{k}={v:.4f}")
                else:
                    parts.append(f"{k}={v}")
            line = f"[{ts}] {msg_type} " + " ".join(parts) + "\n"
            self._tlog_file.write(line)
        except Exception:
            pass

    def download_fence(self):
        try:
            self.fence_points = []
            self._fence_count = 0
            self._fence_download_seq = 0
            self.master.mav.fence_fetch_point_send(
                self.master.target_system, self.master.target_component, 0
            )
            self._emit("log", {"message": "Downloading fence...", "level": "info"})
        except Exception as e:
            self._emit("log", {"message": f"Fence download failed: {e}", "level": "error"})

    def upload_fence(self, points):
        try:
            count = len(points)
            self.set_param("FENCE_TOTAL", count)
            for idx, (lat, lon) in enumerate(points):
                lat_e7 = int(lat * 1e7)
                lon_e7 = int(lon * 1e7)
                self._emit("log", {"message": f"FENCE_POINT[{idx}]: lat={lat:.7f} lon={lon:.7f}  (degE7: {lat_e7}, {lon_e7})", "level": "info"})
                self.master.mav.fence_point_send(
                    self.master.target_system, self.master.target_component,
                    idx, count, lat_e7, lon_e7,
                )
            self.fence_points = points[:]
            self._emit("log", {"message": f"Uploaded {count} fence points", "level": "success"})
            self._emit("fence_data", {"points": points, "count": count})
            self._emit("fence_upload_complete", {"count": count, "success": True})
        except Exception as e:
            self._emit("log", {"message": f"Fence upload failed: {e}", "level": "error"})
            self._emit("fence_upload_complete", {"count": 0, "success": False})

    def clear_fence(self):
        self.fence_points = []
        self._fence_count = 0
        self._fence_download_seq = None
        self.set_param("FENCE_TOTAL", 0)
        self._emit("log", {"message": "Fence cleared (FENCE_TOTAL=0)", "level": "info"})

    def download_rally(self):
        try:
            self.rally_points = []
            self._rally_count = 0
            self._rally_download_seq = 0
            self.master.mav.rally_fetch_point_send(
                self.master.target_system, self.master.target_component, 0
            )
            self._emit("log", {"message": "Downloading rally points...", "level": "info"})
        except Exception as e:
            self._emit("log", {"message": f"Rally download failed: {e}", "level": "error"})

    def upload_rally(self, points):
        try:
            count = len(points)
            self.set_param("RALLY_TOTAL", count)
            for idx, (lat, lon, alt) in enumerate(points):
                lat_e7 = int(lat * 1e7)
                lon_e7 = int(lon * 1e7)
                self.master.mav.rally_point_send(
                    self.master.target_system, self.master.target_component,
                    idx, count, lat_e7, lon_e7, int(alt), 0, 0, 0,
                )
            self.rally_points = [(lat, lon, alt) for lat, lon, alt in points]
            self._emit("log", {"message": f"Uploaded {count} rally points", "level": "success"})
            self._emit("rally_data", {"points": [(lat, lon, alt) for lat, lon, alt in points], "count": count})
            self._emit("rally_upload_complete", {"count": count, "success": True})
        except Exception as e:
            self._emit("log", {"message": f"Rally upload failed: {e}", "level": "error"})
            self._emit("rally_upload_complete", {"count": 0, "success": False})

    def clear_rally(self):
        self.rally_points = []
        self._rally_count = 0
        self._rally_download_seq = None
        self.set_param("RALLY_TOTAL", 0)
        self._emit("log", {"message": "Rally points cleared (RALLY_TOTAL=0)", "level": "info"})

    def _emit_mavlink_inspector(self, msg):
        try:
            msg_type = msg.get_type()
            if msg_type == "BAD_DATA":
                return
            fields = {}
            for k, v in msg.__dict__.items():
                if k.startswith('_'):
                    continue
                if isinstance(v, bytes):
                    fields[k] = v.hex()
                elif isinstance(v, float):
                    fields[k] = round(v, 6)
                else:
                    fields[k] = v
            self._emit("mavlink_raw", {
                "type": msg_type,
                "time": time.strftime('%H:%M:%S.') + f"{int(time.time() * 1000) % 1000:03d}",
                "fields": fields,
            })
        except Exception:
            pass

    def _read_loop(self):
        last_emit = 0
        while self.running:
            try:
                msg = self.master.recv_match(blocking=True, timeout=0.05)
                if msg:
                    self._write_tlog(msg)
                    if self._inspector_active:
                        self._emit_mavlink_inspector(msg)
                    self._process_message(msg)
            except Exception as e:
                err_str = str(e)
                is_disconnect = (
                    (isinstance(e, OSError) and e.errno == 6) or
                    "Device not configured" in err_str or
                    "device disconnected" in err_str.lower() or
                    "ClearCommError" in err_str or
                    (isinstance(e, PermissionError) and e.errno == 13)
                )
                if is_disconnect:
                    self._emit("log", {"message": "Device disconnected (USB unplugged/reboot)", "level": "warning"})
                    self.running = False
                    break
                if self.running:
                    self._emit("log", {"message": f"Read error: {e}", "level": "error"})

            now = time.time()
            if now - last_emit >= 0.1:
                self._emit("state_update", dict(self.state))
                last_emit = now

        self.disconnect()

    def _process_message(self, msg):
        msg_type = msg.get_type()

        if msg_type == "BAD_DATA":
            return

        if msg_type == "HEARTBEAT":
            new_mode = self._resolve_mode(msg.custom_mode, msg.type)
            new_armed = bool(
                msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
            )
            self.state["vehicle_type"] = VEHICLE_TYPES.get(msg.type, f"Type {msg.type}")
            self.state["firmware"] = AUTOPILOTS.get(msg.autopilot, "Unknown")

            if "mode" in self.state and self.state["mode"] != new_mode:
                self._emit("log", {"message": f"Mode {new_mode}", "level": "info"})
            self.state["mode"] = new_mode

            if "armed" in self.state and self.state["armed"] != new_armed:
                self._emit("log", {"message": "ARMED" if new_armed else "DISARMED", "level": "warning" if new_armed else "info"})
            self.state["armed"] = new_armed

        elif msg_type == "SYS_STATUS":
            if msg.voltage_battery > 0:
                self.state["battery_voltage"] = round(msg.voltage_battery / 1000.0, 2)
            self.state["battery_current"] = round(
                max(0, msg.current_battery / 100.0), 2
            )
            if msg.battery_remaining >= 0:
                self.state["battery_remaining"] = msg.battery_remaining
            self.state["sensor_health"] = getattr(msg, 'onboard_control_sensors_health', 0)
            self.state["sensor_enabled"] = getattr(msg, 'onboard_control_sensors_enabled', 0)
            self.state["sensor_present"] = getattr(msg, 'onboard_control_sensors_present', 0)
            self.state["cpu_load"] = round(getattr(msg, 'load', 0) / 10.0, 1)

        elif msg_type == "SCALED_PRESSURE":
            press_abs = getattr(msg, 'press_abs', 1013.25)
            if self._ref_pressure is None:
                self._ref_pressure = press_abs
            rel_alt_m = 44330.0 * (1.0 - (press_abs / self._ref_pressure) ** (1.0 / 5.255))
            self.state["alt"] = round(rel_alt_m, 2)

        elif msg_type == "GPS_RAW_INT":
            fix_type = getattr(msg, 'fix_type', 0)
            if fix_type >= 2:
                self.state["lat"] = getattr(msg, 'lat', 0) / 1e7
                self.state["lon"] = getattr(msg, 'lon', 0) / 1e7
                eph = getattr(msg, 'eph', 9999)
                self.state["hdop"] = round(eph / 100.0, 2) if eph < 10000 else 99.99
            self.state["fix_type"] = fix_type
            self.state["satellites"] = getattr(msg, 'satellites_visible', 0)

        elif msg_type == "GLOBAL_POSITION_INT":
            self.state["lat"] = getattr(msg, 'lat', 0) / 1e7
            self.state["lon"] = getattr(msg, 'lon', 0) / 1e7
            self.state["relative_alt"] = getattr(msg, 'relative_alt', 0) / 1000.0
            self.state["msl_alt"] = getattr(msg, 'alt', 0) / 1000.0
            hdg = getattr(msg, 'hdg', 0)
            if hdg != 0:
                self.state["heading"] = hdg / 100.0

        elif msg_type == "ATTITUDE":
            self.state["roll"] = round(math.degrees(getattr(msg, 'roll', 0)), 2)
            self.state["pitch"] = round(math.degrees(getattr(msg, 'pitch', 0)), 2)
            self.state["yaw"] = round(math.degrees(getattr(msg, 'yaw', 0)), 2)

        elif msg_type == "VFR_HUD":
            self.state["air_speed"] = round(getattr(msg, 'airspeed', 0), 2)
            self.state["ground_speed"] = round(getattr(msg, 'groundspeed', 0), 2)
            self.state["heading"] = getattr(msg, 'heading', 0)
            self.state["throttle"] = getattr(msg, 'throttle', 0)

        elif msg_type == "EKF_STATUS_REPORT":
            self.state["ekf_flags"] = getattr(msg, 'flags', 0)
            self.state["ekf_pos_horiz_variance"] = round(getattr(msg, 'pos_horiz_variance', 0), 4)
            self.state["ekf_pos_vert_variance"] = round(getattr(msg, 'pos_vert_variance', 0), 4)
            self.state["ekf_compass_variance"] = round(getattr(msg, 'compass_variance', 0), 4)
            self.state["ekf_vel_variance"] = round(getattr(msg, 'velocity_variance', 0), 4)
            self.state["ekf_terrain_variance"] = round(getattr(msg, 'terrain_alt_variance', 0), 4)
            self.state["ekf_airspeed_variance"] = round(getattr(msg, 'airspeed_variance', 0), 4)

        elif msg_type == "BATTERY_STATUS":
            voltages = [v for v in getattr(msg, 'voltages', []) if v > 0]
            if voltages:
                self.state["battery_voltage"] = round(max(voltages) / 1000.0, 2)
            self.state["battery_current"] = round(
                max(0, getattr(msg, 'current_battery', 0) / 100.0), 2
            )
            batt_rem = getattr(msg, 'battery_remaining', -1)
            if batt_rem >= 0:
                self.state["battery_remaining"] = batt_rem

        elif msg_type == "STATUSTEXT":
            severity = STATUSTEXT_SEVERITY.get(getattr(msg, 'severity', 6), "info")
            text = getattr(msg, 'text', '')
            # Log all FCU messages transparently for calibration debugging
            if self._cal_pending_advance and text.strip():
                self._emit("log", {"message": f"[FCU] {text}", "level": severity})
            else:
                self._emit("log", {"message": f"{text}", "level": severity})

        elif msg_type == "MAG_CAL_PROGRESS":
            self._emit("mag_cal_progress", {
                "compass_id": getattr(msg, 'compass_id', 0),
                "cal_mask": getattr(msg, 'cal_mask', 0),
                "completion_pct": getattr(msg, 'completion_pct', 0),
                "direction_x": getattr(msg, 'direction_x', 0),
                "direction_y": getattr(msg, 'direction_y', 0),
                "direction_z": getattr(msg, 'direction_z', 0),
            })

        elif msg_type == "MAG_CAL_REPORT":
            status_map = {0: "NEW", 1: "ONGOING", 2: "IN_PROGRESS", 3: "FAILED",
                          4: "COMPLETED", 5: "BAD_ORIENTATION", 6: "BAD_RADIUS"}
            cal_status = getattr(msg, 'cal_status', 0)
            self._emit("mag_cal_report", {
                "compass_id": getattr(msg, 'compass_id', 0),
                "cal_status": cal_status,
                "status_text": status_map.get(cal_status, f"UNKNOWN_{cal_status}"),
                "autosaved": getattr(msg, 'autosaved', 0),
                "confidence": round(getattr(msg, 'confidence', 0), 1),
                "ofs_x": round(getattr(msg, 'ofs_x', 0), 1),
                "ofs_y": round(getattr(msg, 'ofs_y', 0), 1),
                "ofs_z": round(getattr(msg, 'ofs_z', 0), 1),
            })
            if cal_status in (3, 4, 5, 6):
                self._emit("log", {"message": f"Mag cal compass#{getattr(msg, 'compass_id', 0)}: {status_map.get(cal_status, 'UNKNOWN')} (confidence={getattr(msg, 'confidence', 0):.1f})", "level": "success" if cal_status == 4 else "error"})

        elif msg_type == "COMMAND_ACK":
            cmd_name = COMMAND_NAMES.get(getattr(msg, 'command', 0), f"CMD_{getattr(msg, 'command', 0)}")
            result_code = getattr(msg, 'result', 0)
            result = CMD_RESULTS.get(result_code, f"Code {result_code}")
            level = "success" if result_code == 0 else "error"
            msg_text = f"Got COMMAND_ACK: {cmd_name}: {result}"
            # Provide helpful tips for calibration commands
            if cmd_name == "CALIBRATION" and result_code == 3:
                msg_text += " - Check that compass(s) are enabled (COMPASS_ENABLE=1) and the firmware supports onboard calibration (ArduPilot 4.0+)"
            self._emit("log", {"message": msg_text, "level": level})

        elif msg_type == "PARAM_VALUE":
            name = getattr(msg, 'param_id', '').rstrip("\x00")
            param_index = getattr(msg, 'param_index', 0)
            param_count = getattr(msg, 'param_count', 0)
            # FCU sends 65535 sentinel after PARAM_SET — preserve original index
            if param_index == 65535 and name in self.params:
                param_index = self.params[name]["index"]
            self.params[name] = {
                "value": getattr(msg, 'param_value', 0),
                "type": PARAM_TYPES.get(getattr(msg, 'param_type', 0), f"type_{getattr(msg, 'param_type', 0)}"),
                "index": param_index,
            }
            self._param_count = param_count

            for cb in self._param_listeners:
                try:
                    cb(name, self.params[name], param_index, param_count)
                except Exception:
                    pass

            if self._requesting_params and param_index != 65535 and param_index >= param_count - 1:
                self._requesting_params = False
                self._emit("log", {
                    "message": f"Loaded {getattr(msg, 'param_count', 0)} parameters",
                    "level": "success",
                })

        elif msg_type == "RC_CHANNELS":
            pass

        elif msg_type == "MISSION_REQUEST_INT":
            seq = getattr(msg, 'seq', 0)
            self._handle_mission_request(seq)

        elif msg_type == "MISSION_REQUEST":
            seq = getattr(msg, 'seq', 0)
            self._handle_mission_request(seq)

        elif msg_type == "MISSION_ACK":
            mtype = getattr(msg, 'type', 255)
            mission_type_names = {0: "ACCEPTED", 1: "ERROR", 2: "UNKNOWN_FRAME",
                                  3: "UNKNOWN_CMD", 4: "NO_SPACE", 5: "TIMEOUT",
                                  6: "INVALID_PARAM", 7: "INVALID_SEQUENCE",
                                  8: "INVALID_INT", 9: "TOO_MANY", 10: "INVALID",
                                  14: "DENIED", 15: "OPERATION_CANCELLED"}
            result = mission_type_names.get(mtype, f"Code {mtype}")
            if self._mission_upload_phase == 1:
                # ACK from CLEAR_ALL — proceed to send count
                self._mission_upload_phase = 2
                count = len(self._mission_state) + 1 if self._mission_state else 1
                self.master.mav.mission_count_send(
                    self.master.target_system, self.master.target_component,
                    count,
                )
            elif self._mission_upload_phase == 2:
                # Final ACK after all items sent
                self._emit("log", {"message": f"Got MISSION_ACK: {result}", "level": "success" if mtype == 0 else "error"})
                if mtype == 0:
                    wps = self._mission_state or []
                    self._emit("mission_data", {"waypoints": wps, "count": len(wps)})
                self._emit("mission_upload_complete", {"result": result, "success": mtype == 0})
                self._mission_state = None
                self._mission_upload_phase = 0

        elif msg_type == "MISSION_COUNT":
            count = getattr(msg, 'count', 0)
            if hasattr(self, '_mission_download_seq') and self._mission_download_seq is not None:
                self._mission_download_count = count
                self._emit("log", {"message": f"Downloading {count} mission items...", "level": "info"})
                if count == 0:
                    self._mission_download_seq = None
                    self._emit("log", {"message": "Mission is empty", "level": "info"})
                    for cb in self._mission_listeners:
                        try: cb([])
                        except: pass
                else:
                    self._request_mission_item(self._mission_download_seq)

        elif msg_type == "MISSION_ITEM_INT":
            if hasattr(self, '_mission_download_seq') and self._mission_download_seq is not None:
                seq = getattr(msg, 'seq', 0)
                current = getattr(msg, 'current', 0)
                frame = getattr(msg, 'frame', 0)
                command = getattr(msg, 'command', 0)
                x = getattr(msg, 'x', 0)  # lat * 1e7
                y = getattr(msg, 'y', 0)  # lon * 1e7
                z = getattr(msg, 'z', 0)  # alt
                param1 = getattr(msg, 'param1', 0)
                param2 = getattr(msg, 'param2', 0)
                param3 = getattr(msg, 'param3', 0)
                param4 = getattr(msg, 'param4', 0)
                wp = {
                    'seq': seq, 'current': current, 'frame': frame,
                    'command': command, 'param1': param1, 'param2': param2,
                    'param3': param3, 'param4': param4,
                    'x': x / 1e7, 'y': y / 1e7, 'z': z,
                }
                self._mission_download_wps.append(wp)
                self._mission_download_seq = seq + 1
                if self._mission_download_seq < self._mission_download_count:
                    self._request_mission_item(self._mission_download_seq)
                else:
                    self._emit("log", {"message": f"Downloaded {len(self._mission_download_wps)} waypoints", "level": "success"})
                    for cb in self._mission_listeners:
                        try: cb(self._mission_download_wps)
                        except: pass
                    self._mission_download_seq = None
                    self._mission_download_wps = []
                    self._mission_download_count = 0

        elif msg_type == "FENCE_STATUS":
            breach_type = getattr(msg, 'breach_type', 0)
            breach_count = getattr(msg, 'breach_count', 0)
            if breach_type != 0 or breach_count != 0:
                breach_names = {1: "BOUNDARY", 2: "MAXALT", 3: "MINALT"}
                bname = breach_names.get(breach_type, f"UNKNOWN({breach_type})")
                self._emit("log", {"message": f"FENCE_BREACH: {bname} count={breach_count}", "level": "warning"})
            else:
                self._emit("fence_breach_status", {"breach_type": 0, "breach_count": 0})

        elif msg_type == "MISSION_CURRENT":
            seq = getattr(msg, 'seq', -1)
            if seq != getattr(self, '_last_mission_seq', -1):
                self._last_mission_seq = seq
                self._emit("log", {"message": f"MISSION_CURRENT: seq={seq}", "level": "info"})

        elif msg_type == "FENCE_POINT":
            if self._fence_download_seq is not None:
                idx = getattr(msg, 'idx', 0)
                count = getattr(msg, 'count', 0)
                lat = getattr(msg, 'lat', 0) / 1e7
                lng = getattr(msg, 'lng', 0) / 1e7
                if idx < len(self.fence_points):
                    self.fence_points[idx] = (lat, lng)
                else:
                    self.fence_points.append((lat, lng))
                self._fence_count = count
                if idx + 1 < count:
                    self._fence_download_seq = idx + 1
                    self.master.mav.fence_fetch_point_send(
                        self.master.target_system, self.master.target_component,
                        idx + 1,
                    )
                else:
                    self._fence_download_seq = None
                    self._emit("log", {"message": f"Downloaded {count} fence points", "level": "success"})
                    self._emit("fence_data", {"points": self.fence_points, "count": count})

        elif msg_type == "RALLY_POINT":
            if self._rally_download_seq is not None:
                idx = getattr(msg, 'idx', 0)
                count = getattr(msg, 'count', 0)
                lat = getattr(msg, 'lat', 0) / 1e7
                lng = getattr(msg, 'lng', 0) / 1e7
                alt = getattr(msg, 'alt', 0)
                if idx < len(self.rally_points):
                    self.rally_points[idx] = (lat, lng, alt)
                else:
                    self.rally_points.append((lat, lng, alt))
                self._rally_count = count
                if idx + 1 < count:
                    self._rally_download_seq = idx + 1
                    self.master.mav.rally_fetch_point_send(
                        self.master.target_system, self.master.target_component,
                        idx + 1,
                    )
                else:
                    self._rally_download_seq = None
                    self._emit("log", {"message": f"Downloaded {count} rally points", "level": "success"})
                    self._emit("rally_data", {"points": self.rally_points, "count": count})

        else:
            pass

    def _resolve_mode(self, custom_mode, vehicle_type):
        if vehicle_type in (
            mavutil.mavlink.MAV_TYPE_QUADROTOR,
            mavutil.mavlink.MAV_TYPE_HEXAROTOR,
            mavutil.mavlink.MAV_TYPE_OCTOROTOR,
            mavutil.mavlink.MAV_TYPE_TRICOPTER,
            mavutil.mavlink.MAV_TYPE_HELICOPTER,
        ):
            return FLIGHT_MODES.get(custom_mode, f"Mode {custom_mode}")

        elif vehicle_type in (
            mavutil.mavlink.MAV_TYPE_FIXED_WING,
            mavutil.mavlink.MAV_TYPE_VTOL_DUOROTOR,
            mavutil.mavlink.MAV_TYPE_VTOL_QUADROTOR,
            mavutil.mavlink.MAV_TYPE_VTOL_TILTROTOR,
        ):
            plane_modes = {
                0: "MANUAL", 1: "CIRCLE", 2: "STABILIZE", 3: "TRAINING",
                4: "ACRO", 5: "FBWA", 6: "FBWB", 7: "CRUISE",
                8: "AUTOTUNE", 10: "AUTO", 11: "RTL", 12: "LOITER",
                13: "TAKEOFF", 14: "AVOID_ADSB", 15: "GUIDED",
                16: "INITIALISING", 17: "QSTABILIZE", 18: "QHOVER",
                19: "QLOITER", 20: "QLAND", 21: "QRTL",
                22: "QAUTOTUNE", 23: "QACRO", 24: "THERMAL",
            }
            return plane_modes.get(custom_mode, f"Mode {custom_mode}")

        elif vehicle_type in (
            mavutil.mavlink.MAV_TYPE_GROUND_ROVER,
            mavutil.mavlink.MAV_TYPE_SURFACE_BOAT,
        ):
            rover_modes = {
                0: "MANUAL", 2: "STABILIZE", 3: "TRAINING", 4: "ACRO",
                5: "STEERING", 6: "HOLD", 10: "AUTO", 11: "RTL",
                12: "LOITER", 15: "GUIDED", 16: "INITIALISING",
            }
            return rover_modes.get(custom_mode, f"Mode {custom_mode}")

        return f"Mode {custom_mode}"

    def send_command(self, command_id, param1=0, param2=0, param3=0,
                     param4=0, param5=0, param6=0, param7=0, confirmation=0,
                     use_command_int=False):
        if not self.master or not self.running:
            return False
        # Debug: log raw command details
        cmd_name = COMMAND_NAMES.get(command_id, f"CMD_{command_id}")
        if command_id == mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION:
            self._emit("log", {"message": f"[RAW] sending {cmd_name} conf={confirmation} p5={param5} to sys={self.master.target_system} comp={self.master.target_component}", "level": "info"})
        elif command_id == mavutil.mavlink.MAV_CMD_ACCELCAL_VEHICLE_POS:
            self._emit("log", {"message": f"[RAW] sending {cmd_name} param1={param1} (position) to sys={self.master.target_system} comp={self.master.target_component} as {'COMMAND_INT' if use_command_int else 'COMMAND_LONG'}", "level": "info"})
        try:
            if use_command_int:
                # Use COMMAND_INT for commands handled only in handle_command_int_packet
                # NOTE: x,y are int32, z is float (unlike COMMAND_LONG's float param5-7)
                self.master.mav.command_int_send(
                    self.master.target_system,
                    self.master.target_component,
                    mavutil.mavlink.MAV_FRAME_GLOBAL,
                    command_id,
                    0,  # current
                    0,  # autocontinue
                    param1, param2, param3, param4,
                    int(param5), int(param6), float(param7),
                )
            else:
                self.master.mav.command_long_send(
                    self.master.target_system,
                    self.master.target_component,
                    command_id, confirmation,
                    param1, param2, param3, param4,
                    param5, param6, param7,
                )
            if hasattr(self.master, 'flush'):
                self.master.flush()
            return True
        except Exception as e:
            self._emit("log", {"message": f"Command send failed: {e}", "level": "error"})
            return False

    def set_mode(self, mode_name):
        mode_id = FLIGHT_MODES_NAME_TO_ID.get(mode_name.upper())
        if mode_id is None:
            self._emit("log", {"message": f"Unknown mode: {mode_name}", "level": "error"})
            return False
        return self.send_command(
            mavutil.mavlink.MAV_CMD_DO_SET_MODE,
            1,  # MAV_MODE_FLAG_CUSTOM_MODE_ENABLED
            mode_id,
        )

    def arm(self):
        return self.send_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 1)

    def disarm(self):
        return self.send_command(mavutil.mavlink.MAV_CMD_COMPONENT_ARM_DISARM, 0)

    def motor_test(self, motor, test_type=0, throttle=0, timeout=3):
        if not self.master or not self.running:
            return False
        try:
            from pymavlink.dialects.v20.ardupilotmega import MAV_CMD_DO_MOTOR_TEST
            result = self.send_command(
                MAV_CMD_DO_MOTOR_TEST,
                param1=max(1, motor),
                param2=test_type,
                param3=max(0, min(100, throttle)),
                param4=max(0, timeout),
            )
            if result:
                self._emit("log", {
                    "message": f"Motor test: motor={motor} type={test_type} thr={throttle}% time={timeout}s",
                    "level": "info",
                })
            return result
        except Exception as e:
            self._emit("log", {"message": f"Motor test failed: {e}", "level": "error"})
            return False

    def rc_override(self, channels):
        if not self.master or not self.running:
            return False
        try:
            if not isinstance(channels, dict):
                self._emit("log", {"message": "RC override: invalid channels data", "level": "error"})
                return False
            ch = [0] * 18
            for i in range(1, 19):
                val = channels.get(f"ch{i}")
                if val is None:
                    ch[i - 1] = 0
                else:
                    ch[i - 1] = max(0, min(2100, int(val)))
            self.master.mav.rc_channels_override_send(
                self.master.target_system,
                self.master.target_component,
                *ch[:8]
            )
            self._emit("log", {
                "message": f"RC override: ch1={ch[0]} ch2={ch[1]} ch3={ch[2]} ch4={ch[3]} ch5={ch[4]} ch6={ch[5]} ch7={ch[6]} ch8={ch[7]}",
                "level": "info",
            })
            return True
        except Exception as e:
            self._emit("log", {"message": f"RC override failed: {e}", "level": "error"})
            return False

    def rtl(self):
        result = self.set_mode("RTL")
        self._emit("log", {"message": f"RTL set_mode returned {result}", "level": "info"})

    def land(self):
        result = self.set_mode("LAND")
        self._emit("log", {"message": f"LAND set_mode returned {result}", "level": "info"})

    def takeoff(self, altitude=10):
        self.send_command(
            mavutil.mavlink.MAV_CMD_NAV_TAKEOFF,
            0, 0, 0, 0, 0, 0, altitude,
        )

    def reboot(self, autopilot_only=True):
        return self.send_command(
            mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
            1,  # reboot autopilot
            0,  # do not reboot companion
            0,  # action on next reboots
        )

    def calibrate(self, cal_type, confirm=False, position=0):
        params = {
            'gyro':       (1, 0, 0, 0, 0, 0, 0),
            'mag':        (0, 1, 0, 0, 0, 0, 0),
            'pressure':   (0, 0, 1, 0, 0, 0, 0),
            'radio':      (0, 0, 0, 1, 0, 0, 0),
            'accel':      (0, 0, 0, 0, 1, 0, 0),
            'accel_simple': (0, 0, 0, 0, 2, 0, 0),
            'compass_mot':(0, 0, 0, 0, 0, 1, 0),
            'level':      (0, 0, 0, 0, 0, 0, 1),
        }
        if cal_type == 'cancel':
            self._cal_pending_advance = False
            self._cal_advance_type = None
            return self.cancel_calibration()
        p = params.get(cal_type)
        if not p:
            self._emit("log", {"message": f"Unknown calibration type: {cal_type}", "level": "error"})
            return False
        # Server-side tracking for accel calibration advance.
        # The first call (from startCalibration) sends confirm=False (start).
        # Subsequent calls (from continueCalibration) should use the
        # MAV_CMD_ACCELCAL_VEHICLE_POS command for advance on newer ArduPilot.
        cal_reset = cal_type in ('accel', 'accel_simple') and self._cal_advance_type != cal_type
        if cal_reset:
            self._cal_pending_advance = False
            self._cal_advance_type = None
        if self._cal_pending_advance and cal_type in ('accel', 'accel_simple'):
            confirm = True
        elif cal_type in ('accel', 'accel_simple'):
            self._cal_pending_advance = True
            self._cal_advance_type = cal_type

        if confirm and cal_type == 'accel':
            # MAV_CMD_ACCELCAL_VEHICLE_POS not supported on this FCU (returned FAILED).
            # Fallback to MAV_CMD_PREFLIGHT_CALIBRATION with all-zero params + confirmation=1
            # (MAVProxy style). Key difference from our earlier attempt: param5=0 (not 1),
            # so the FCU checks confirmation>0 instead of matching param5==1 start path first.
            self._emit("log", {"message": f"Sending advance for accel cal position {position} via PREFLIGHT_CALIBRATION conf=1 (MAVProxy style)...", "level": "info"})
            return self.send_command(mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION, confirmation=1)
        elif confirm and cal_type == 'accel_simple':
            # Simple accel doesn't use position-based advance; use old confirmation method
            self._emit("log", {"message": "Sending advance for simple accel calibration (confirm=1)...", "level": "info"})
            return self.send_command(mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION, *p, confirmation=1)

        # Start command
        label = "advance" if confirm else "start"
        self._emit("log", {"message": f"Sending {label} command for {cal_type} calibration...", "level": "info"})
        return self.send_command(mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION, *p)

    def cancel_calibration(self):
        self._emit("log", {"message": "Cancelling calibration...", "level": "warning"})
        return self.send_command(mavutil.mavlink.MAV_CMD_PREFLIGHT_CALIBRATION, 0, 0, 0, 0, 0, 0, 0)

    def request_params(self, callback=None):
        if not self.master or not self.running:
            return
        self.params.clear()
        self._param_listeners.clear()
        self._requesting_params = True
        if callback:
            self._param_listeners.append(callback)
        self._emit("log", {"message": "Requesting parameter list...", "level": "info"})
        self.master.mav.param_request_list_send(
            self.master.target_system, self.master.target_component
        )

    def _handle_mission_request(self, seq):
        if not self._mission_state or seq > len(self._mission_state):
            self._emit("log", {"message": f"MISSION_REQUEST for seq {seq} out of range (state={self._mission_state})", "level": "error"})
            return
        if seq == 0:
            lat = self.state.get("lat", 0)
            lon = self.state.get("lon", 0)
            self._emit("log", {"message": f"Sending HOME ({lat:.4f}, {lon:.4f}) at seq 0", "level": "info"})
            try:
                from pymavlink.dialects.v20.ardupilotmega import MAV_FRAME_GLOBAL
                self.master.mav.mission_item_int_send(
                    self.master.target_system, self.master.target_component,
                    0, MAV_FRAME_GLOBAL, 16, 0, 1,
                    0, 0, 0, 0,
                    int(lat * 1e7), int(lon * 1e7), 0,
                )
            except Exception as e:
                self._emit("log", {"message": f"HOME send failed: {e}", "level": "error"})
            return
        idx = seq - 1
        if idx >= len(self._mission_state):
            return
        wp = self._mission_state[idx]
        try:
            from pymavlink.dialects.v20.ardupilotmega import MAV_FRAME_GLOBAL_RELATIVE_ALT_INT
            self.master.mav.mission_item_int_send(
                self.master.target_system, self.master.target_component,
                seq, MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                wp.get('command', 16), 0, 1,
                wp.get('param1', 0), wp.get('param2', 0),
                wp.get('param3', 0), wp.get('param4', 0),
                int(wp.get('x', 0) * 1e7),
                int(wp.get('y', 0) * 1e7),
                wp.get('z', 50),
            )
        except Exception as e:
            self._emit("log", {"message": f"Mission item {seq} send failed: {e}", "level": "error"})

    def _request_mission_item(self, seq):
        if not self.master:
            return
        try:
            self.master.mav.mission_request_int_send(
                self.master.target_system,
                self.master.target_component,
                seq,
            )
        except Exception:
            pass

    def upload_mission(self, waypoints):
        """Upload mission waypoints. waypoints = list of dicts with x, y, z, command, param1-4."""
        if not self.master or not self.running:
            self._emit("log", {"message": "Not connected", "level": "warning"})
            return
        self._mission_state = waypoints
        self._mission_upload_phase = 1
        self._emit("log", {"message": f"Uploading {len(waypoints)} waypoints + HOME ({len(waypoints) + 1} total)", "level": "info"})
        self.master.mav.mission_clear_all_send(
            self.master.target_system, self.master.target_component
        )

    def download_mission(self, callback=None):
        """Download mission from FCU. Result passed to callback."""
        if not self.master or not self.running:
            self._emit("log", {"message": "Not connected", "level": "warning"})
            if callback: callback([])
            return
        self._mission_listeners = [callback] if callback else []
        self._mission_download_wps = []
        self._mission_download_seq = 0
        self._mission_download_count = 0
        self.master.mav.mission_request_list_send(
            self.master.target_system, self.master.target_component
        )

    def goto_position(self, lat, lon, alt=50):
        """Send SET_POSITION_TARGET_GLOBAL_INT for guided waypoint."""
        if not self.master or not self.running:
            return False
        try:
            from pymavlink.dialects.v20.ardupilotmega import (
                MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                POSITION_TARGET_TYPEMASK_VX_IGNORE,
                POSITION_TARGET_TYPEMASK_VY_IGNORE,
                POSITION_TARGET_TYPEMASK_VZ_IGNORE,
                POSITION_TARGET_TYPEMASK_AX_IGNORE,
                POSITION_TARGET_TYPEMASK_AY_IGNORE,
                POSITION_TARGET_TYPEMASK_AZ_IGNORE,
                POSITION_TARGET_TYPEMASK_YAW_IGNORE,
                POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE,
            )
            mask = (
                POSITION_TARGET_TYPEMASK_VX_IGNORE |
                POSITION_TARGET_TYPEMASK_VY_IGNORE |
                POSITION_TARGET_TYPEMASK_VZ_IGNORE |
                POSITION_TARGET_TYPEMASK_AX_IGNORE |
                POSITION_TARGET_TYPEMASK_AY_IGNORE |
                POSITION_TARGET_TYPEMASK_AZ_IGNORE |
                POSITION_TARGET_TYPEMASK_YAW_IGNORE |
                POSITION_TARGET_TYPEMASK_YAW_RATE_IGNORE
            )
            self.master.mav.set_position_target_global_int_send(
                0,  # time_boot_ms
                self.master.target_system,
                self.master.target_component,
                MAV_FRAME_GLOBAL_RELATIVE_ALT_INT,
                mask,
                int(lat * 1e7), int(lon * 1e7), alt,
                0, 0, 0,  # vx, vy, vz
                0, 0, 0,  # ax, ay, az
                0, 0,     # yaw, yaw_rate
            )
            self._emit("log", {
                "message": f"Guided goto: {lat:.6f}, {lon:.6f} @ {alt}m",
                "level": "info",
            })
            return True
        except Exception as e:
            self._emit("log", {"message": f"Guided goto failed: {e}", "level": "error"})
            return False

    def set_param(self, name, value):
        if not self.master or not self.running:
            return False
        try:
            param_type = mavutil.mavlink.MAV_PARAM_TYPE_REAL32
            if name in self.params:
                type_name = self.params[name]["type"]
                type_map = {
                    "uint8": mavutil.mavlink.MAV_PARAM_TYPE_UINT8,
                    "int8": mavutil.mavlink.MAV_PARAM_TYPE_INT8,
                    "uint16": mavutil.mavlink.MAV_PARAM_TYPE_UINT16,
                    "int16": mavutil.mavlink.MAV_PARAM_TYPE_INT16,
                    "uint32": mavutil.mavlink.MAV_PARAM_TYPE_UINT32,
                    "int32": mavutil.mavlink.MAV_PARAM_TYPE_INT32,
                    "float": mavutil.mavlink.MAV_PARAM_TYPE_REAL32,
                    "double": mavutil.mavlink.MAV_PARAM_TYPE_REAL64,
                }
                param_type = type_map.get(type_name, mavutil.mavlink.MAV_PARAM_TYPE_REAL32)

            self.master.mav.param_set_send(
                self.master.target_system,
                self.master.target_component,
                name.encode()[:16],
                float(value),
                param_type,
            )
            self._emit("log", {"message": f"Set {name} = {value}", "level": "info"})
            return True
        except Exception as e:
            self._emit("log", {"message": f"Failed to set {name}: {e}", "level": "error"})
            return False

    def _request_streams(self):
        if not self.master:
            return
        rates = {
            mavutil.mavlink.MAV_DATA_STREAM_ALL: 10,
            mavutil.mavlink.MAV_DATA_STREAM_RAW_SENSORS: 10,
            mavutil.mavlink.MAV_DATA_STREAM_EXTENDED_STATUS: 5,
            mavutil.mavlink.MAV_DATA_STREAM_RC_CHANNELS: 5,
            mavutil.mavlink.MAV_DATA_STREAM_RAW_CONTROLLER: 3,
            mavutil.mavlink.MAV_DATA_STREAM_POSITION: 10,
            mavutil.mavlink.MAV_DATA_STREAM_EXTRA1: 10,
            mavutil.mavlink.MAV_DATA_STREAM_EXTRA2: 5,
            mavutil.mavlink.MAV_DATA_STREAM_EXTRA3: 3,
        }
        for sid, rate in rates.items():
            try:
                self.master.mav.request_data_stream_send(
                    self.master.target_system,
                    self.master.target_component,
                    sid, rate, 1,
                )
            except Exception:
                pass

    @staticmethod
    def detect_ports(baud=57600, timeout=2):
        found = []
        if not serial:
            return found
        for p in serial.tools.list_ports.comports():
            try:
                test = mavutil.mavlink_connection(
                    p.device, baud=baud, source_system=255,
                    dialect="ardupilotmega",
                )
                hb = test.wait_heartbeat(timeout=timeout)
                if hb is not None:
                    test.close()
                    found.append({
                        "device": p.device,
                        "description": p.description,
                        "sysid": test.target_system,
                        "compid": test.target_component,
                    })
                else:
                    test.close()
            except Exception:
                try:
                    test.close()
                except Exception:
                    pass
        return found
