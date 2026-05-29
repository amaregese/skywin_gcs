import math
import threading
import time
from pymavlink import mavutil

try:
    import serial.tools.list_ports
except ImportError:
    serial = None


FLIGHT_MODES = {
    "STABILIZE": 0, "ACRO": 1, "ALT_HOLD": 2, "AUTO": 3,
    "GUIDED": 4, "LOITER": 5, "RTL": 6, "CIRCLE": 7,
    "LAND": 9, "DRIFT": 11, "SPORT": 13, "FLIP": 14,
    "AUTOTUNE": 15, "POSHOLD": 16, "BRAKE": 17,
    "THROW": 18, "AVOID_ADSB": 19, "GUIDED_NOGPS": 20,
    "SMART_RTL": 21, "FLOWHOLD": 22, "FOLLOW": 23,
    "ZIGZAG": 24, "SYSTEM_ID": 25, "AUTOROTATE": 26, "AUTO_RTL": 27,
}

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
        self.connection_string = connection_string
        self.baud = baud
        self.source_system = source_system
        self.master = None
        self.running = False
        self._thread = None
        self.listeners = []
        self._debug_types = set()

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

    def add_listener(self, callback):
        self.listeners.append(callback)

    def _emit(self, event, data=None):
        for cb in self.listeners:
            try:
                cb(event, data)
            except Exception:
                pass

    def connect(self):
        try:
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

            self.state["sysid"] = self.master.target_system
            self.state["compid"] = self.master.target_component
            self.state["connected"] = True

            self._emit("log", {
                "message": (
                    f"Heartbeat from sys={self.master.target_system} "
                    f"comp={self.master.target_component} | "
                    f"{VEHICLE_TYPES.get(heartbeat.type, f'Type {heartbeat.type}')} | "
                    f"{AUTOPILOTS.get(heartbeat.autopilot, 'Unknown')}"
                ),
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
        if self.master:
            try:
                self.master.close()
            except Exception:
                pass
        self.state["connected"] = False
        self._emit("state_update", self.state)
        self._emit("log", {"message": "Disconnected", "level": "warning"})

    def _read_loop(self):
        last_emit = 0
        last_report = 0
        msg_counts = {}
        while self.running:
            try:
                msg = self.master.recv_match(blocking=True, timeout=0.05)
                if msg:
                    self._process_message(msg)
                    t = msg.get_type()
                    msg_counts[t] = msg_counts.get(t, 0) + 1
            except Exception as e:
                if self.running:
                    self._emit("log", {"message": f"Read error: {e}", "level": "error"})

            now = time.time()
            if now - last_emit >= 0.1:
                self._emit("state_update", dict(self.state))
                last_emit = now

            if now - last_report >= 5.0 and msg_counts:
                total = sum(msg_counts.values())
                types = ", ".join(
                    f"{k}={v}" for k, v in sorted(
                        msg_counts.items(), key=lambda x: -x[1]
                    )[:6]
                )
                self._emit("log", {
                    "message": f"MAVLink: {total} msgs in 5s | {types}",
                    "level": "mavlink",
                })
                msg_counts.clear()
                last_report = now
        self.disconnect()

    def _process_message(self, msg):
        msg_type = msg.get_type()

        if msg_type == "BAD_DATA":
            return

        if msg_type not in self._debug_types:
            self._debug_types.add(msg_type)
            try:
                d = msg.to_dict()
                items = [f"{k}={d[k]}" for k in d if not k.startswith("mavpacket")]
                preview = ", ".join(items)
                if len(preview) > 600:
                    preview = preview[:600] + "..."
                self._emit("log", {
                    "message": f"[MAV] {msg_type}: {preview}",
                    "level": "mavlink",
                })
            except Exception:
                pass

        if msg_type == "HEARTBEAT":
            self.state["mode"] = self._resolve_mode(msg.custom_mode, msg.type)
            self.state["armed"] = bool(
                msg.base_mode & mavutil.mavlink.MAV_MODE_FLAG_SAFETY_ARMED
            )
            self.state["vehicle_type"] = VEHICLE_TYPES.get(msg.type, f"Type {msg.type}")
            self.state["firmware"] = AUTOPILOTS.get(msg.autopilot, "Unknown")

        elif msg_type == "SYS_STATUS":
            if msg.voltage_battery > 0:
                self.state["battery_voltage"] = round(msg.voltage_battery / 1000.0, 2)
            self.state["battery_current"] = round(
                max(0, msg.current_battery / 100.0), 2
            )
            if msg.battery_remaining >= 0:
                self.state["battery_remaining"] = msg.battery_remaining

        elif msg_type == "SCALED_PRESSURE":
            press_abs = getattr(msg, 'press_abs', 1013.25)
            if self._ref_pressure is None:
                self._ref_pressure = press_abs
                self._emit("log", {
                    "message": f"Baro ref set: {press_abs:.2f} hPa",
                    "level": "info",
                })
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
            self._emit("log", {"message": f"[FCU] {getattr(msg, 'text', '')}", "level": severity})

        elif msg_type == "COMMAND_ACK":
            cmd_name = COMMAND_NAMES.get(getattr(msg, 'command', 0), f"CMD_{getattr(msg, 'command', 0)}")
            result = CMD_RESULTS.get(getattr(msg, 'result', 0), f"Code {getattr(msg, 'result', 0)}")
            level = "success" if getattr(msg, 'result', 0) == 0 else "error"
            self._emit("log", {"message": f"{cmd_name}: {result}", "level": level})

        elif msg_type == "PARAM_VALUE":
            name = getattr(msg, 'param_id', '').rstrip("\x00")
            self.params[name] = {
                "value": getattr(msg, 'param_value', 0),
                "type": PARAM_TYPES.get(getattr(msg, 'param_type', 0), f"type_{getattr(msg, 'param_type', 0)}"),
                "index": getattr(msg, 'param_index', 0),
            }
            self._param_count = getattr(msg, 'param_count', 0)

            for cb in self._param_listeners:
                try:
                    cb(name, self.params[name], getattr(msg, 'param_index', 0), getattr(msg, 'param_count', 0))
                except Exception:
                    pass

            if self._requesting_params and getattr(msg, 'param_index', 0) >= getattr(msg, 'param_count', 0) - 1:
                self._requesting_params = False
                self._emit("log", {
                    "message": f"Loaded {getattr(msg, 'param_count', 0)} parameters",
                    "level": "success",
                })

        elif msg_type == "RC_CHANNELS":
            pass

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
                     param4=0, param5=0, param6=0, param7=0):
        if not self.master or not self.running:
            return False
        try:
            self.master.mav.command_long_send(
                self.master.target_system,
                self.master.target_component,
                command_id, 0,
                param1, param2, param3, param4,
                param5, param6, param7,
            )
            return True
        except Exception as e:
            self._emit("log", {"message": f"Command send failed: {e}", "level": "error"})
            return False

    def set_mode(self, mode_name):
        mode_id = FLIGHT_MODES.get(mode_name.upper())
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

    def rtl(self):
        self.state["mode"] = "RTL"
        return self.send_command(mavutil.mavlink.MAV_CMD_NAV_RETURN_TO_LAUNCH)

    def land(self):
        self.state["mode"] = "LAND"
        return self.send_command(mavutil.mavlink.MAV_CMD_NAV_LAND)

    def takeoff(self, altitude=10):
        return self.send_command(mavutil.mavlink.MAV_CMD_NAV_TAKEOFF, 0, 0, 0, 0, 0, 0, altitude)

    def request_params(self, callback=None):
        if not self.master or not self.running:
            return
        self.params.clear()
        self._requesting_params = True
        if callback:
            self._param_listeners.append(callback)
        self._emit("log", {"message": "Requesting parameter list...", "level": "info"})
        self.master.mav.param_request_list_send(
            self.master.target_system, self.master.target_component
        )

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
        self._emit("log", {"message": "Data streams requested (10Hz)", "level": "info"})

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
