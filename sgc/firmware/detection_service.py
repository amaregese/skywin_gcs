import threading
import time
import os
from flask_socketio import SocketIO

BOARD_SIGNATURES = {
    0x00: "Pixhawk 1",
    0x01: "Pixhawk 2 / Cube Black",
    0x02: "Pixhawk 3",
    0x04: "Pixhawk 4",
    0x0C: "Cube Orange",
    0x0D: "Cube Yellow",
    0x0E: "Cube Purple",
    0x10: "Holybro Pix32 v5",
    0x11: "Holybro Kakute F7",
    0x12: "Holybro Durandal",
    0x14: "Matek H743",
    0x16: "SpeedyBee F405",
    0x18: "CUAV V5+",
    0x19: "CUAV Nora",
    0x1A: "CUAV X7",
    0x1C: "Pixhawk 5X",
    0x1D: "Pixhawk 6X",
    0x1E: "Holybro Pixhawk 6C",
}

BOARD_NAMES = {
    "Pixhawk 1": "Pixhawk 1",
    "Pixhawk 2 / Cube Black": "Cube Black",
    "Cube Orange": "Cube Orange",
    "Cube Purple": "Cube Purple",
    "Holybro Pix32 v5": "Holybro",
    "Holybro Kakute F7": "Holybro",
    "Holybro Durandal": "Holybro",
    "Matek H743": "Matek",
    "SpeedyBee F405": "SpeedyBee",
    "CUAV V5+": "CUAV",
    "CUAV Nora": "CUAV",
    "CUAV X7": "CUAV",
    "Pixhawk 5X": "Holybro",
    "Pixhawk 6X": "Holybro",
    "Holybro Pixhawk 6C": "Holybro",
}


def detect_boards(emit_callback=None):
    results = []
    try:
        import serial.tools.list_ports
        ports = serial.tools.list_ports.comports()
        for p in ports:
            info = _probe_port(p.device)
            if info:
                results.append(info)
                if emit_callback:
                    emit_callback("board_detected", info)
    except ImportError:
        pass
    if emit_callback:
        emit_callback("detection_complete", {"count": len(results)})
    return results


def _probe_port(port_name):
    try:
        import serial
        ser = serial.Serial(port_name, 115200, timeout=0.15)

        try:
            # Retry PX4 sync multiple times to catch boot-looping boards
            # (bootloader active for only milliseconds before jumping to bad firmware)
            for attempt in range(5):
                if _try_px4_sync(ser):
                    return {
                        "port": port_name,
                        "board": "PX4 Bootloader",
                        "bootloader": True,
                        "vid_pid": _get_vid_pid(port_name),
                    }

            # No bootloader response — try text-based identification
            ser.timeout = 0.5
            data = ser.read(200)
            board = _identify_board_via_serial(data)
            in_bootloader = _check_bootloader(data)

            return {
                "port": port_name,
                "board": board or "Unknown",
                "bootloader": in_bootloader,
                "vid_pid": _get_vid_pid(port_name),
            }
        finally:
            ser.close()
    except Exception:
        return None


def _try_px4_sync(ser):
    """Send PX4 GET_SYNC to check if port is in bootloader mode."""
    try:
        _px4_send(ser, bytes([0x21]))
        ser.timeout = 0.15
        raw = ser.read(5)
        for i in range(len(raw) - 1):
            if raw[i] == 0x12 and raw[i + 1] == 0x10:
                return True
    except Exception:
        pass
    return False


def _px4_send(ser, buf):
    """Send a PX4 protocol command with escaping."""
    esc = 0x1B
    xor = 0x20
    eoc = 0x20
    escaped = b""
    for b in buf:
        if b in (0x20, 0x12, 0x10, 0x11, 0x1B):
            escaped += bytes([esc, b ^ xor])
        else:
            escaped += bytes([b])
    escaped += bytes([eoc])
    try:
        ser.reset_input_buffer()
    except Exception:
        pass
    ser.write(escaped)


def _get_vid_pid(port_name):
    try:
        import serial.tools.list_ports
        for p in serial.tools.list_ports.comports():
            if p.device == port_name:
                return f"{p.vid:04x}:{p.pid:04x}" if p.vid and p.pid else "unknown"
    except Exception:
        pass
    return "unknown"


def _identify_board_via_serial(data):
    if not data:
        return None
    hex_data = data.hex().lower()
    for sig, name in BOARD_SIGNATURES.items():
        sig_str = f"{sig:02x}"
        if sig_str in hex_data:
            return name
    if b"PX4" in data or b"px4" in data:
        return "PX4 Flight Stack"
    if b"ArduPilot" in data or b"ardupilot" in data:
        return "ArduPilot Flight Stack"
    return None


def _check_bootloader(data):
    if not data:
        return False
    markers = [b"boot", b"Boot", b"BOOT", b"BL", b"system_boot"]
    return any(m in data for m in markers)


def force_bootloader_mode(port_name, socketio=None):
    def _force():
        try:
            import serial.tools.list_ports
            before = {p.device for p in serial.tools.list_ports.comports()}
            if socketio:
                socketio.emit("firmware_log", {
                    "message": "Disconnect your flight controller from USB, then reconnect it",
                    "level": "info",
                })
            # Wait for port to disappear then reappear
            disconnected = False
            wait_start = time.time()
            while time.time() - wait_start < 15:
                current = {p.device for p in serial.tools.list_ports.comports()}
                if not disconnected:
                    if not current.intersection(before):
                        disconnected = True
                else:
                    if current:
                        if socketio:
                            socketio.emit("firmware_log", {
                                "message": f"Board reconnected. Checking for bootloader...",
                                "level": "info",
                            })
                        return True
                time.sleep(0.5)
            if socketio:
                socketio.emit("firmware_log", {
                    "message": "Could not detect board reconnection. Try holding the safety button while plugging in.",
                    "level": "warning",
                })
        except Exception as e:
            if socketio:
                socketio.emit("firmware_log", {
                    "message": f"Force bootloader error: {e}",
                    "level": "error",
                })

    threading.Thread(target=_force, daemon=True).start()
    return True
