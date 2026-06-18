import base64
import hashlib
import json
import os
import subprocess
import sys
import threading
import time
from urllib.request import urlopen, Request
from urllib.error import URLError

FW_DIR = None


def _ensure_fw_dir():
    global FW_DIR
    if FW_DIR is None:
        FW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "firmware_cache")
    os.makedirs(FW_DIR, exist_ok=True)
    return FW_DIR


def download_firmware(fw_info, progress_callback=None):
    url = fw_info.get("url") or fw_info.get("fw_url")
    name = fw_info.get("name", "firmware")
    version = fw_info.get("version", "unknown")
    frame = fw_info.get("frame", "unknown")

    if not url:
        return None

    ext = ".apj" if ".apj" in url else ".bin"
    fname = f"{name.replace('/', '_')}_{version}_{frame}{ext}"
    local_path = os.path.join(_ensure_fw_dir(), fname)

    try:
        req = Request(url, headers={"User-Agent": "SGC-Firmware/1.0"})
        resp = urlopen(req, timeout=60)
        total = int(resp.headers.get("Content-Length", 0))
        downloaded = 0
        sha256 = hashlib.sha256()

        with open(local_path, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
                sha256.update(chunk)
                downloaded += len(chunk)
                if total > 0 and progress_callback:
                    pct = int(downloaded * 100 / total)
                    progress_callback("download_progress", {"percent": pct, "stage": "downloading"})

        checksum = sha256.hexdigest()
        if progress_callback:
            progress_callback("download_progress", {"percent": 100, "stage": "complete", "checksum": checksum})

        return {
            "path": local_path,
            "checksum_sha256": checksum,
            "file_size": downloaded,
            "name": name,
            "version": version,
        }
    except Exception as e:
        if progress_callback:
            progress_callback("download_progress", {"percent": 0, "stage": "failed", "error": str(e)})
        return None


def verify_checksum(file_path, expected_sha256):
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            sha256.update(chunk)
    return sha256.hexdigest() == expected_sha256


def parse_apj(file_path):
    with open(file_path, "r") as f:
        raw = f.read()
    text = raw.strip()
    meta = json.loads(text)
    image_b64 = meta.get("image", "")
    image = base64.b64decode(image_b64)
    return meta, image


PROTO_OK = 0x10
PROTO_FAILED = 0x11
PROTO_INSYNC = 0x12
PROTO_INVALID = 0x13
PROTO_EOC = 0x20
PROTO_GET_SYNC = 0x21
PROTO_GET_DEVICE = 0x22
PROTO_GET_CRC = 0x29
PROTO_GET_CHIP_DES = 0x2e
PROTO_BOOT = 0x30
PROTO_ESC = 0x55
PROTO_XOR = 0x00


def _safe_reset_buffer(ser):
    try:
        ser.reset_output_buffer()
        ser.reset_input_buffer()
    except Exception:
        pass


def _px4_esc_byte(b):
    if isinstance(b, str):
        b = ord(b)
    return b


def _px4_send(ser, buf):
    escaped = bytearray()
    escaped.append(PROTO_ESC)
    xor = PROTO_XOR
    for b in buf:
        bv = b if isinstance(b, int) else ord(b)
        xor ^= bv
        if bv == PROTO_ESC or bv == PROTO_EOC:
            escaped.append(PROTO_ESC)
        escaped.append(bv)
    escaped.append(xor)
    escaped.append(PROTO_EOC)
    ser.write(escaped)


def _try_px4_sync(port_name, baud_rate=115200, timeout=2):
    import serial
    ser = serial.Serial(port_name, baud_rate, timeout=timeout, write_timeout=timeout)
    try:
        _safe_reset_buffer(ser)
        ser.write(b"\x00" * 50)
        time.sleep(0.1)
        raw = ser.read(200)
        if len(raw) > 4:
            return raw
        ser.write(b"\x00" * 20)
        time.sleep(0.05)
        raw = ser.read(200)
        if len(raw) > 4:
            return raw
    finally:
        try:
            ser.close()
        except Exception:
            pass
    return None


def _scan_for_bootloader(timeout=10, progress_callback=None):
    import serial
    import serial.tools.list_ports as list_ports

    deadline = time.time() + timeout
    scan_count = 0
    while time.time() < deadline:
        scan_count += 1
        for i, p in enumerate(list_ports.comports()):
            try:
                ser = serial.Serial(p.device, 115200, timeout=0.5, write_timeout=0.5)
                raw = ser.read(100)
                ser.close()
                if len(raw) > 4:
                    return p.device
            except Exception:
                pass
        if progress_callback:
            progress_callback("scan_progress", {"percent": min(99, scan_count * 10), "stage": "scanning"})
        time.sleep(0.5)
    return None


def _reboot_via_mavlink(port, baud, progress_callback=None):
    try:
        from pymavlink import mavutil
        mav = mavutil.mavlink_connection(port, baud=baud)
        hb = mav.wait_heartbeat(timeout=5)
        if hb:
            ts = hb.get_srcSystem()
            tc = hb.get_srcComponent()
            mav.mav.command_long_send(
                ts, tc,
                mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
                1, 3, 0, 0, 0, 0, 0, 0
            )
            if progress_callback:
                progress_callback("flash_log", {"message": "Reboot to bootloader sent", "level": "info"})
            return True
    except Exception as e:
        if progress_callback:
            progress_callback("flash_log", {"message": f"MAVLink reboot failed: {e}", "level": "warning"})
    return False


def _wait_for_bootloader_reconnect(progress_callback=None, timeout=30):
    import serial
    import serial.tools.list_ports as list_ports

    before = {p.device for p in list_ports.comports()}

    port = None
    result = {"found": False, "port": None, "any_reboot_ok": True}

    deadline = time.time() + timeout
    while time.time() < deadline:
        current = list_ports.comports()
        new_ports = [p.device for p in current if p.device not in before or True]
        for p in current:
            try:
                ser = serial.Serial(p.device, 115200, timeout=1, write_timeout=1)
                raw = ser.read(50)
                ser.close()
                if len(raw) > 4:
                    result["found"] = True
                    result["port"] = p.device
                    return result
            except Exception:
                pass

        wait_start = time.time()
        remaining = max(0, deadline - time.time())
        if progress_callback:
            progress_callback("flash_log", {
                "message": f"Waiting for bootloader... ({remaining:.0f}s left)",
                "level": "info"
            })
        time.sleep(0.5)

    return result


def _uploader_script_path():
    return os.path.join(os.path.dirname(__file__), "uploader.py")


def _run_official_uploader(fw_path, port, progress_callback=None):
    import queue as _queue
    import re as _re
    import threading as _threading

    uploader_py = _uploader_script_path()
    cmd = [sys.executable, "-u", uploader_py, "--port", port, "--baud-bootloader", "115200", fw_path]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, bufsize=1, text=True)

    def _reader():
        for line in proc.stdout:
            try:
                _queue.put(line)
            except Exception:
                pass

    reader_thread = _threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    uploader_deadline = time.time() + 120
    program_ok = False

    stage_map = {
        "erase": (0, 30),
        "program": (30, 80),
        "verify": (80, 95),
    }

    while time.time() < uploader_deadline:
        try:
            raw = _queue.get(timeout=0.5)
        except Exception:
            if proc.poll() is not None:
                break
            continue

        line = raw.strip()
        if not line:
            continue

        pct = None
        stage = None
        stage_min = 0
        stage_max = 100

        for key, (lo, hi) in stage_map.items():
            if key in line.lower():
                stage = key
                stage_min = lo
                stage_max = hi
                break

        m = _re.search(r"(\d+(?:\.\d+)?)%", line)
        if m:
            num_str = m.group(1)
            if stage:
                after_pct = float(num_str)
                overall = stage_min + (after_pct / 100.0) * (stage_max - stage_min)
                pct = int(overall)
            else:
                pct = int(float(num_str))

        if pct is not None and progress_callback:
            progress_callback("flash_progress", {"percent": pct, "stage": stage or "unknown", "message": line})

        if "rebooting" in line.lower():
            program_ok = True
        if "failed" in line.lower() or "error:" in line.lower() or "traceback" in line.lower():
            if progress_callback:
                progress_callback("flash_log", {"message": line, "level": "error"})

    proc.wait(timeout=5)
    if program_ok and progress_callback:
        progress_callback("flash_progress", {"percent": 100, "stage": "reboot", "message": "Rebooting..."})

    return program_ok


def _wait_for_mavlink_boot(old_port, timeout=60, progress_callback=None):
    import serial
    import serial.tools.list_ports as list_ports

    deadline = time.time() + timeout
    while time.time() < deadline:
        for p in list_ports.comports():
            current = p.device
            if current != old_port:
                continue
            waited = time.time()
            scan_deadline = waited + 10
            while time.time() < scan_deadline:
                try:
                    from pymavlink import mavutil
                    port = current
                    mav = mavutil.mavlink_connection(port, baud=57600)
                    hb = mav.wait_heartbeat(timeout=5)
                    if hb:
                        if progress_callback:
                            progress_callback("flash_log", {
                                "message": f"MAVLink heartbeat received on {port}",
                                "level": "success"
                            })
                        return True
                except Exception:
                    pass
                time.sleep(0.5)

        elapsed = int(time.time() - (deadline - timeout))
        if progress_callback and elapsed % 5 == 0:
            progress_callback("flash_log", {
                "message": f"Waiting for MAVLink boot... ({elapsed}s)",
                "level": "info"
            })
        time.sleep(1)

    return False


def flash_firmware(file_path, port, baud, progress_callback=None, socketio=None):
    def _do_flash():
        if progress_callback:
            progress_callback("flash_log", {"message": f"Starting flash on {port}...", "level": "info"})

        bootloader_found = _wait_for_bootloader_reconnect(progress_callback, timeout=30)
        if bootloader_found.get("found"):
            actual_port = bootloader_found["port"]
        else:
            actual_port = port

        if progress_callback:
            progress_callback("flash_log", {"message": f"Using port {actual_port}", "level": "info"})

        ok = _run_official_uploader(file_path, actual_port, progress_callback)

        if ok:
            if progress_callback:
                progress_callback("flash_log", {"message": "Firmware flashed successfully!", "level": "success"})
            mav_ok = _wait_for_mavlink_boot(actual_port, timeout=60, progress_callback=progress_callback)
            if mav_ok and progress_callback:
                progress_callback("flash_log", {"message": "Vehicle detected after flash", "level": "success"})
            elif progress_callback:
                progress_callback("flash_log", {"message": "Flash complete but no MAVLink heartbeat (board may be in bootloader)", "level": "warning"})
        else:
            if progress_callback:
                progress_callback("flash_log", {"message": "Flash failed!", "level": "error"})

    thread = threading.Thread(target=_do_flash, daemon=True)
    thread.start()
    return True
