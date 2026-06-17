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

FW_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "firmware_cache")

BOARD_IDS = {
    0: "Pixhawk 1",
    1: "Pixhawk 1 (rev 2)",
    2: "Pixhawk 2 / Cube Black",
    3: "Pixhawk 3 Pro",
    4: "Pixhawk 4",
    5: "Pixhawk 4 Mini",
    6: "Pixhawk 5X",
    7: "Pixhawk 6X",
    8: "Cube Orange",
    9: "Cube Yellow / fmuv3",
    10: "Cube Purple",
    11: "Holybro Pix32 v5",
    12: "Holybro Kakute F7",
    13: "Holybro Durandal",
    14: "Matek H743",
    15: "SpeedyBee F405",
    16: "CUAV V5+",
    17: "CUAV Nora",
    18: "CUAV X7",
    19: "Pixhawk 6C",
    20: "Holybro Pixhawk 6C",
    33: "AUAV X2.1",
    42: "Omnibus F4 SD",
    50: "fmuv5",
    51: "fmuv5X",
    52: "fmuv6",
    53: "fmuv6X",
    64: "TAP v1",
    65: "AeroFC v1",
    66: "TAP v2",
    88: "MindPX v2",
    98: "AeroCore v1",
    99: "Pixhawk Discovery v1",
    120: "Cube Yellow",
    122: "Kakute F4",
    124: "Revolution",
    125: "Matek F405",
    126: "Nucleo F767ZI",
    127: "Matek F405 Wing",
    128: "Airbot F4",
    130: "Sparky v2",
    131: "Omnibus F4 Pro",
    132: "Any FC F7",
    133: "Omnibus Nano v6",
    134: "SpeedyBee F4",
    135: "F35 Lightning",
    136: "mRo X2.1 v2",
    137: "Omnibus F4 v6",
    138: "HelioSpring",
    139: "Durandal",
    140: "Cube Orange",
    141: "mRo Control Zero",
    142: "mRo Control Zero OEM",
    143: "Matek F765 Wing",
    144: "JDMini F405",
    145: "Kakute F7 Mini",
    146: "H757i Eval",
    188: "MazzyStar Drone",
    1003: "Cube Black+",
    1009: "CUAV Nora",
    1010: "CUAV X7 Pro",
    1013: "Matek H743",
    1019: "Mamba F405",
    1020: "H31 PixC4",
    1021: "QioTek Zealot F427",
    1022: "mRo Ctrl Zero Classic",
    1023: "mRo Ctrl Zero H7",
    1024: "mRo Ctrl Zero OEM H7",
    1030: "Kakute F4 Mini",
    1036: "QioTek Zealot H743",
    1038: "Mamba Basic F405",
    1048: "Kakute H7",
    1058: "Kakute H7 Mini",
    1063: "Cube Orange+",
    1066: "QioTek Adept F427",
    1069: "Cube Red (Primary)",
    1070: "Cube Red (Secondary)",
    1079: "CubeNode",
    1083: "PixPilot V6",
    1105: "Kakute H7 Wing",
    1124: "mRo CZOEM rev G",
}


def _ensure_fw_dir():
    os.makedirs(FW_DIR, exist_ok=True)
    return FW_DIR


def download_firmware(fw_info, progress_callback=None):
    url = fw_info.get("url", "")
    name = fw_info.get("name", "firmware")
    version = fw_info.get("version", "0.0.0")
    frame = fw_info.get("frame", "Unknown")

    if not url:
        if progress_callback:
            progress_callback("error", {"message": "No download URL provided"})
        return None

    ext = os.path.splitext(url.split("/")[-1])[1] or ".apj"
    fname = f"{name}_{version}_{frame}{ext}".replace(" ", "_")
    local_path = os.path.join(_ensure_fw_dir(), fname)

    if os.path.exists(local_path):
        if progress_callback:
            progress_callback("download_progress", {"percent": 100, "stage": "cached", "file": fname})
        return {"path": local_path, "name": fname, "version": version, "frame": frame}

    try:
        req = Request(url, headers={"User-Agent": "SGC-GCS/1.0"})
        with urlopen(req, timeout=120) as resp:
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
                        progress_callback("download_progress", {
                            "percent": pct, "bytes": downloaded,
                            "total": total, "stage": "downloading", "file": fname,
                        })

        checksum = sha256.hexdigest()
        if progress_callback:
            progress_callback("download_progress", {
                "percent": 100, "stage": "complete",
                "file": fname, "checksum": checksum,
            })

        return {
            "path": local_path, "name": fname, "version": version,
            "frame": frame, "checksum_sha256": checksum,
            "file_size": os.path.getsize(local_path),
        }
    except URLError as e:
        if progress_callback:
            progress_callback("error", {"message": f"Download failed: {e}"})
        return None


def verify_checksum(file_path, expected_sha256):
    if not expected_sha256:
        return True
    try:
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            while True:
                chunk = f.read(65536)
                if not chunk:
                    break
                sha256.update(chunk)
        return sha256.hexdigest().lower() == expected_sha256.lower()
    except Exception:
        return False


def parse_apj(file_path):
    with open(file_path, "rb") as f:
        raw = f.read()
    text = raw.decode("utf-8").strip()
    meta = json.loads(text)
    image_b64 = meta.get("image", "")
    if not image_b64:
        return None
    image = base64.b64decode(image_b64)
    return meta, image


# ── Bootloader detection (used to enter bootloader mode before handing off to uploader) ──

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

PROTO_ESC = 0x1B
PROTO_XOR = 0x20


def _safe_reset_buffer(ser):
    try:
        ser.reset_input_buffer()
    except Exception:
        pass


def _px4_esc_byte(b):
    if b in (PROTO_EOC, PROTO_INSYNC, PROTO_OK, PROTO_FAILED, PROTO_ESC):
        return bytes([PROTO_ESC, b ^ PROTO_XOR])
    return bytes([b])


def _px4_send(ser, buf):
    escaped = b"".join(_px4_esc_byte(b) for b in buf)
    ser.write(escaped + bytes([PROTO_EOC]))


def _try_px4_sync(port_name, baud_rate=115200, timeout=1):
    import serial
    try:
        ser = serial.Serial(port_name, baud_rate, timeout=timeout)
        _safe_reset_buffer(ser)
        _px4_send(ser, bytes([PROTO_GET_SYNC]))
        ser.timeout = timeout
        raw = ser.read(5)
        for i in range(len(raw) - 1):
            if raw[i] == PROTO_INSYNC and raw[i + 1] == PROTO_OK:
                return ser
        ser.close()
    except Exception:
        try:
            ser.close()
        except Exception:
            pass
    return None


def _scan_for_bootloader(timeout=15, progress_callback=None):
    import serial
    deadline = time.time() + timeout
    scan_count = 0
    while time.time() < deadline:
        for i in range(1, 65):
            p = f"COM{i}"
            try:
                ser = serial.Serial(p, 115200, timeout=0.1)
            except Exception:
                continue
            try:
                _safe_reset_buffer(ser)
                _px4_send(ser, bytes([PROTO_GET_SYNC]))
                ser.timeout = 0.08
                raw = ser.read(5)
                for i in range(len(raw) - 1):
                    if raw[i] == PROTO_INSYNC and raw[i + 1] == PROTO_OK:
                        if progress_callback:
                            progress_callback("firmware_log", {
                                "message": f"Bootloader found on {p}!",
                                "level": "success",
                            })
                        return p, ser
            except Exception:
                pass
            ser.close()
        scan_count += 1
        if scan_count % 5 == 0 and progress_callback:
            progress_callback("firmware_log", {
                "message": f"Scanning for bootloader... (attempt {scan_count})",
                "level": "info",
            })
        time.sleep(0.05)
    raise RuntimeError("Bootloader not detected. Use the safety-switch method:\n"
                       "  1. Disconnect USB\n"
                       "  2. Hold SAFETY SWITCH button\n"
                       "  3. Connect USB while holding button\n"
                       "  4. Release after 2 seconds\n"
                       "  5. Then click 'Flash Firmware' again.")


def _reboot_via_mavlink(port, baud=115200, progress_callback=None):
    try:
        from pymavlink import mavutil
        mav = mavutil.mavlink_connection(port, baud=baud, source_system=255, source_component=1)
        hb = mav.wait_heartbeat(blocking=True, timeout=5)
        if hb is None:
            if progress_callback:
                progress_callback("firmware_log", {
                    "message": "No heartbeat from board on " + port,
                    "level": "error",
                })
            return False

        ts = hb.get_srcSystem()
        tc = hb.get_srcComponent()
        if progress_callback:
            progress_callback("firmware_log", {
                "message": f"Sending reboot-to-bootloader command (sys={ts}, comp={tc})",
                "level": "info",
            })

        mav.mav.command_long_send(
            ts, tc,
            mavutil.mavlink.MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN,
            0, 3, 0, 0, 0, 0, 0, 0
        )

        time.sleep(1)
        while True:
            msg = mav.recv_match(blocking=False)
            if msg is None:
                break
            if msg.get_type() == "COMMAND_ACK":
                if progress_callback:
                    progress_callback("firmware_log", {
                        "message": f"MAVLink ACK: cmd={msg.command} result={msg.result}",
                        "level": "info",
                    })
                if msg.result not in (0, 5):
                    if progress_callback:
                        progress_callback("firmware_log", {
                            "message": "Reboot command rejected by board. Manual bootloader entry required.",
                            "level": "warning",
                        })
                    mav.close()
                    return False
        mav.close()
        return True
    except Exception as e:
        if progress_callback:
            progress_callback("firmware_log", {
                "message": f"MAVLink reboot error: {e}",
                "level": "error",
            })
        return False


def _wait_for_bootloader_reconnect(progress_callback=None, timeout=45):
    import serial.tools.list_ports
    import serial

    before = {p.device for p in serial.tools.list_ports.comports()}

    # Quick check: is a port already in bootloader mode?
    if progress_callback:
        progress_callback("firmware_log", {
            "message": "Checking for bootloader on connected ports...",
            "level": "info",
        })
    for port in before:
        result = _try_px4_sync(port, 115200, timeout=0.08)
        if result:
            if progress_callback:
                progress_callback("firmware_log", {
                    "message": f"Bootloader already active on {port}!",
                    "level": "success",
                })
            return port, result

    if progress_callback:
        progress_callback("firmware_log", {
            "message": "Step 1: Rebooting FCU into bootloader mode via MAVLink...",
            "level": "info",
        })

    any_reboot_ok = False
    for port in list(before):
        if _reboot_via_mavlink(port, 115200, progress_callback=progress_callback):
            any_reboot_ok = True

    if any_reboot_ok:
        if progress_callback:
            progress_callback("firmware_log", {
                "message": "Step 2: Waiting for bootloader port to appear...",
                "level": "info",
            })
            progress_callback("flash_progress", {"percent": 5, "stage": "detecting bootloader"})

        deadline = time.time() + 15
        while time.time() < deadline:
            current = {p.device for p in serial.tools.list_ports.comports()}
            new_ports = current - before
            all_ports = current | before
            for p in all_ports:
                result = _try_px4_sync(p, 115200, timeout=0.08)
                if result:
                    if progress_callback:
                        progress_callback("firmware_log", {
                            "message": f"Bootloader detected on {p}!",
                            "level": "success",
                        })
                    return p, result
            time.sleep(0.5)

    if progress_callback:
        progress_callback("firmware_log", {
            "message": "MAVLink reboot did not work. Manual method needed:",
            "level": "warning",
        })
        progress_callback("firmware_log", {
            "message": "Step 3: DISCONNECT your flight controller from USB",
            "level": "info",
        })
        progress_callback("flash_progress", {"percent": 5, "stage": "disconnect board"})

    wait_start = time.time()
    while time.time() - wait_start < 15:
        current = {p.device for p in serial.tools.list_ports.comports()}
        if not current:
            break
        time.sleep(0.5)

    if progress_callback:
        progress_callback("firmware_log", {
            "message": "Step 4: RECONNECT your flight controller to USB",
            "level": "info",
        })
        progress_callback("flash_progress", {"percent": 7, "stage": "reconnect board"})

    remaining = max(timeout - 20, 10)
    try:
        return _scan_for_bootloader(timeout=remaining, progress_callback=progress_callback)
    except RuntimeError:
        if progress_callback:
            progress_callback("firmware_log", {
                "message": "Still not found. Use SAFETY SWITCH method:",
                "level": "warning",
            })
            progress_callback("firmware_log", {
                "message": "1. Disconnect USB  2. Hold SAFETY button  3. Connect USB "
                           "while holding  4. Release after 2s",
                "level": "info",
            })
        return _scan_for_bootloader(timeout=30, progress_callback=progress_callback)


# ── Flash via official uploader (subprocess) ──

def _uploader_script_path():
    return os.path.join(os.path.dirname(__file__), "uploader.py")


def _run_official_uploader(fw_path, port, progress_callback=None):
    import queue as _queue
    import re as _re
    import threading as _threading

    uploader_py = _uploader_script_path()
    cmd = [sys.executable, "-u", uploader_py]

    if port:
        cmd.extend(["--port", port])

    cmd.append(fw_path)

    if progress_callback:
        progress_callback("firmware_log", {
            "message": "Launching official ArduPilot uploader...",
            "level": "info",
        })

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        bufsize=0,
    )

    lines_queue = _queue.Queue()
    reader_stop = _threading.Event()

    def _reader():
        try:
            for raw_line in iter(proc.stdout.readline, b''):
                if reader_stop.is_set():
                    break
                lines_queue.put(raw_line)
        except Exception:
            pass
        finally:
            lines_queue.put(None)

    reader_thread = _threading.Thread(target=_reader, daemon=True)
    reader_thread.start()

    stage_map = {
        "Erase": ("erasing", 15, 30),
        "Program": ("programming", 30, 80),
        "Verify": ("verifying", 80, 95),
    }

    program_ok = False
    uploader_deadline = time.time() + 120

    while time.time() < uploader_deadline:
        try:
            raw = lines_queue.get(timeout=5)
        except _queue.Empty:
            if proc.poll() is not None:
                break
            if progress_callback:
                progress_callback("firmware_log", {
                    "message": "Waiting for uploader response...",
                    "level": "info",
                })
            continue

        if raw is None:
            break

        line = raw.decode('utf-8', errors='replace').strip()
        if not line:
            continue

        if "Program" in line and "100.0%" in line:
            program_ok = True

        pct = None
        stage = None
        stage_min = None
        stage_max = None

        for key, (s, lo, hi) in stage_map.items():
            if key in line and "%" in line:
                stage, stage_min, stage_max = s, lo, hi
                try:
                    after_pct = line.split("%")[0]
                    num_str = after_pct.split()[-1]
                    pct = float(num_str)
                except (ValueError, IndexError):
                    pct = 50
                break

        if pct is not None and stage is not None:
            overall = stage_min + int(pct * (stage_max - stage_min) / 100)
            if progress_callback:
                progress_callback("flash_progress", {"percent": min(overall, stage_max), "stage": stage})
        elif "Found board" in line:
            if progress_callback:
                progress_callback("flash_progress", {"percent": 12, "stage": "bootloader identified"})
        elif "Rebooting" in line:
            if progress_callback:
                progress_callback("flash_progress", {"percent": 97, "stage": "booting"})

        level = "error" if "ERROR" in line or "Error:" in line else "info"
        if progress_callback:
            progress_callback("firmware_log", {"message": line, "level": level})

    reader_stop.set()
    reader_thread.join(timeout=2)

    while True:
        try:
            raw = lines_queue.get_nowait()
            if raw is None:
                break
            line = raw.decode('utf-8', errors='replace').strip()
            if line and progress_callback:
                progress_callback("firmware_log", {"message": line, "level": "info"})
        except _queue.Empty:
            break

    rc = proc.poll()
    if rc is None:
        proc.kill()
        proc.wait()
        raise RuntimeError("Uploader timed out (120s) — the board may not be responding or the firmware is incompatible")

    if rc != 0 and program_ok:
        if progress_callback:
            progress_callback("firmware_log", {
                "message": "CRC check failed (non-fatal — firmware was programmed successfully). Rebooting...",
                "level": "warning",
            })
            progress_callback("flash_progress", {"percent": 95, "stage": "booting"})
        import serial
        for attempt in range(10):
            try:
                s = serial.Serial(port, 115200, timeout=1)
                s.write(b'\x30\x20')
                s.flush()
                time.sleep(0.2)
                s.close()
                break
            except Exception:
                time.sleep(0.5)
    elif rc != 0:
        raise RuntimeError(f"Uploader exited with code {rc}")


def _wait_for_mavlink_boot(old_port, timeout=30, progress_callback=None):
    """After firmware flash, wait for board to boot and emit MAVLink heartbeat."""
    import serial.tools.list_ports
    deadline = time.time() + timeout

    # Wait for the old bootloader port to disappear
    while time.time() < deadline:
        current = {p.device for p in serial.tools.list_ports.comports()}
        if old_port not in current:
            break
        time.sleep(0.3)

    waited = time.time() - (deadline - timeout)
    if progress_callback:
        progress_callback("firmware_log", {
            "message": f"Bootloader port {old_port} gone after {waited:.1f}s, scanning for MAVLink...",
            "level": "info",
        })

    # Scan all ports for MAVLink heartbeat
    from pymavlink import mavutil
    scan_deadline = time.time() + 25
    while time.time() < scan_deadline:
        for p in serial.tools.list_ports.comports():
            port = p.device
            if port == old_port:
                continue
            try:
                mav = mavutil.mavlink_connection(port, baud=115200, source_system=255, source_component=1)
                mav.timeout = 2
                hb = mav.wait_heartbeat(blocking=True, timeout=2)
                mav.close()
                if hb is not None:
                    if progress_callback:
                        progress_callback("firmware_log", {
                            "message": f"Board booted! MAVLink heartbeat on {port} "
                                       f"(sys={hb.get_srcSystem()}, comp={hb.get_srcComponent()})",
                            "level": "success",
                        })
                    return True
            except Exception:
                try:
                    mav.close()
                except Exception:
                    pass
        time.sleep(0.5)
        elapsed = time.time() - (deadline - timeout)
        if int(elapsed) % 5 == 0 and progress_callback:
            progress_callback("firmware_log", {
                "message": f"Waiting for MAVLink heartbeat... ({int(elapsed)}s)",
                "level": "info",
            })

    if progress_callback:
        progress_callback("firmware_log", {
            "message": "No MAVLink heartbeat detected within timeout. Board may not have booted.",
            "level": "error",
        })
    return False


# ── Public API ──

def flash_firmware(file_path, port=None, baud=115200, progress_callback=None, socketio=None):
    def _do_flash():
        try:
            if progress_callback:
                progress_callback("flash_progress", {"percent": 0, "stage": "starting"})

            if not os.path.exists(file_path):
                if progress_callback:
                    progress_callback("error", {"message": f"Firmware file not found: {file_path}"})
                return False

            ext = os.path.splitext(file_path)[1].lower()
            fw_image = None

            if ext == ".apj":
                if progress_callback:
                    progress_callback("flash_progress", {"percent": 2, "stage": "parsing .apj"})
                result = parse_apj(file_path)
                if result is None:
                    if progress_callback:
                        progress_callback("error", {"message": "Failed to parse .apj file"})
                    return False
                meta, fw_image = result
                if progress_callback:
                    board_id = meta.get("board_id", -1)
                    board_name = BOARD_IDS.get(board_id, "Unknown")
                    fw_version = meta.get("version", "0.0")
                    progress_callback("firmware_log", {
                        "message": f"APJ: board_id={board_id} ({board_name}) apj_ver={fw_version} ({len(fw_image)} bytes)",
                        "level": "info",
                    })
            elif ext in (".px4", ".bin"):
                if progress_callback:
                    progress_callback("flash_progress", {"percent": 2, "stage": "reading firmware"})
                with open(file_path, "rb") as f:
                    fw_image = f.read()
            elif ext == ".hex":
                if progress_callback:
                    progress_callback("error", {"message": ".hex format not yet supported, convert to .apj or .px4"})
                return False
            else:
                if progress_callback:
                    progress_callback("error", {"message": f"Unsupported format: {ext}"})
                return False

            if not fw_image:
                if progress_callback:
                    progress_callback("error", {"message": "Empty firmware image"})
                return False

            # Pre-check: warn about known fmuv3 board_id mismatch
            if ext == ".apj" and meta:
                apj_board_id = meta.get("board_id", -1)
                if apj_board_id != -1:
                    apj_board_name = BOARD_IDS.get(apj_board_id, "Unknown")
                    if progress_callback:
                        progress_callback("firmware_log", {
                            "message": f"NOTE: This firmware targets board_id={apj_board_id} ({apj_board_name}). "
                                       f"Your board's bootloader will be checked for compatibility.",
                            "level": "info",
                        })

            # Enter bootloader mode
            if progress_callback:
                progress_callback("flash_progress", {"percent": 5, "stage": "entering bootloader"})

            try:
                bl_port, ser = _wait_for_bootloader_reconnect(
                    progress_callback=progress_callback, timeout=45
                )
            except Exception as e:
                msg = f"Bootloader detection failed: {e}"
                if progress_callback:
                    progress_callback("error", {"message": msg})
                return False

            # Close our serial connection so uploader.py can open the port (with exclusive=True)
            try:
                ser.close()
            except Exception:
                pass
            time.sleep(1.5)  # Windows needs extra time to release COM port handle

            if progress_callback:
                progress_callback("flash_progress", {"percent": 10, "stage": "launching uploader"})

            # Hand off to official uploader (--force removed — uploader.py will reject incompatible firmware)
            _run_official_uploader(file_path, bl_port, progress_callback=progress_callback)

            # Verify board boots via MAVLink
            if progress_callback:
                progress_callback("firmware_log", {
                    "message": "Post-flash: waiting for board to boot (checking for MAVLink heartbeat)...",
                    "level": "info",
                })
                progress_callback("flash_progress", {"percent": 96, "stage": "waiting for boot"})

            import serial.tools.list_ports
            boot_ok = _wait_for_mavlink_boot(bl_port, timeout=30, progress_callback=progress_callback)

            if boot_ok:
                if progress_callback:
                    progress_callback("flash_progress", {"percent": 100, "stage": "complete"})
                    progress_callback("flash_complete", {
                        "message": "Firmware flashed successfully and board is running!",
                        "file": os.path.basename(file_path),
                    })
            else:
                if progress_callback:
                    progress_callback("flash_progress", {"percent": 100, "stage": "complete"})
                    progress_callback("flash_complete", {
                        "message": "Firmware flashed but board did not respond to MAVLink. "
                                   "The firmware may be incompatible with this board.",
                        "file": os.path.basename(file_path),
                    })

            return True

        except Exception as e:
            err_msg = str(e)
            if progress_callback:
                progress_callback("error", {"message": f"Flash failed: {err_msg}"})
                progress_callback("firmware_log", {"message": f"Flash failed: {err_msg}", "level": "error"})
                if "not suitable" in err_msg.lower() or "board_type" in err_msg.lower():
                    progress_callback("firmware_log", {
                        "message": "The firmware you selected is not compatible with your board. "
                                   "Try a different board name from the list, or use the 'Custom' "
                                   "option to upload firmware specifically built for your hardware.",
                        "level": "warning",
                    })
            return False

    threading.Thread(target=_do_flash, daemon=True).start()
    return True
