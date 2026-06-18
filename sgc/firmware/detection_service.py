import threading
import time
import os

BOARD_SIGNATURES = {
    b"ArduPilot": "ArduPilot",
    b"PX4": "PX4",
    b"ArduPlane": "ArduPilot (Plane)",
    b"ArduCopter": "ArduPilot (Copter)",
    b"APM": "ArduPilot",
    b"PARROT": "Parrot",
}

BOARD_NAMES = {
    "fmuv3": "Pixhawk1 / fmuv3",
    "fmuv5": "Pixhawk5 / fmuv5",
    "mRoX21": "mRo X21",
    "CubeBlack": "Cube Black",
    "CubeOrange": "Cube Orange",
    "CubePurple": "Cube Purple",
    "CubeYellow": "Cube Yellow",
}


def detect_boards(emit_callback=None):
    results = []
    try:
        import serial
        import serial.tools.list_ports as list_ports
    except ImportError:
        return results

    ports = list_ports.comports()
    for p in ports:
        info = _probe_port(p.device)
        if info:
            results.append(info)
        if emit_callback:
            emit_callback("fw_board_detect_progress", {"port": p.device, "found": bool(info)})

    return results


def _probe_port(port_name):
    try:
        import serial
        ser = serial.Serial(port_name, 115200, timeout=0.5, write_timeout=0.5, exclusive=True)
    except Exception:
        return None

    board = None
    in_bootloader = False

    for attempt in range(5):
        data = _try_px4_sync(ser)
        if data:
            in_bootloader = True
            board = _identify_board_via_serial(data)
            break
        time.sleep(0.1)

    try:
        ser.close()
    except Exception:
        pass

    if board or in_bootloader:
        vid_pid = _get_vid_pid(port_name)
        return {
            "port": port_name,
            "board_name": board or "Unknown",
            "in_bootloader": in_bootloader,
            "vid_pid": vid_pid,
            "type": board,
        }

    return None


def _try_px4_sync(ser):
    try:
        ser.timeout = 0.2
        ser.write(b"\x00" * 40)
        time.sleep(0.05)
        raw = ser.read(200)
        if len(raw) > 4:
            return raw
        ser.write(b"\x00" * 20)
        time.sleep(0.05)
        raw = ser.read(200)
        if len(raw) > 4:
            return raw
    except Exception:
        pass
    return None


def _px4_send(ser, buf):
    esc = 0x55
    xor = 0x00
    eoc = 0x20
    escaped = bytearray()
    escaped.append(esc)
    for b in buf:
        if isinstance(b, str):
            b = ord(b)
        xor ^= b
        if b == esc or b == eoc:
            escaped.append(esc)
        escaped.append(b)
    escaped.append(xor)
    escaped.append(eoc)
    ser.write(escaped)


def _get_vid_pid(port_name):
    try:
        import serial.tools.list_ports as list_ports
        for p in list_ports.comports():
            if p.device == port_name:
                if p.vid and p.pid:
                    return f"{p.vid:04x}:{p.pid:04x}"
                return None
    except Exception:
        pass
    return None


def _identify_board_via_serial(data):
    hex_data = data.hex()
    for sig, name in BOARD_SIGNATURES.items():
        sig_str = sig.hex() if isinstance(sig, bytes) else sig
        if isinstance(sig_str, str) and sig_str in hex_data:
            return name
    if _check_bootloader(data):
        return "Bootloader"
    return None


def _check_bootloader(data):
    markers = [b"PX4", b"BL", b"bootloader", b"_bootloader"]
    for m in markers:
        if m in data:
            return True
    return False


def force_bootloader_mode(port_name, socketio=None):
    _force = False
    try:
        import serial
        ser = serial.Serial(port_name, 57600, timeout=2, write_timeout=2)
        try:
            from pymavlink import mavutil
            mav = mavutil.mavlink_connection(port_name, baud=57600)
            msg = None
            for _ in range(20):
                msg = mav.recv_match(type='HEARTBEAT', blocking=True, timeout=1)
                if msg:
                    break
            if msg:
                ts = msg.get_srcSystem()
                tc = msg.get_srcComponent()
                mav.mav.command_long_send(
                    ts, tc,
                    mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
                    1, 3, 0, 0, 0, 0, 0, 0
                )
                _force = True
        except ImportError:
            pass
        ser.close()
    except Exception:
        pass
    return _force
