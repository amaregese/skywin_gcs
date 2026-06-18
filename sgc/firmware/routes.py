import os
import threading
from flask import Blueprint, render_template, request, jsonify, send_file
from flask_socketio import emit

from sgc.firmware.database import init_db, cache_firmware, get_cached_firmware, record_installation, get_installation_history, get_known_boards, record_board
from sgc.firmware.detection_service import detect_boards, force_bootloader_mode
from sgc.firmware.firmware_repository import get_firmware_cards, get_stable_firmwares, get_beta_firmwares, get_legacy_firmwares, get_latest_firmwares, refresh_cache
from sgc.firmware.flash_service import download_firmware, verify_checksum, flash_firmware

firmware_bp = Blueprint('firmware', __name__)
_socketio = None


def init_firmware_module(socketio_instance=None, db_path=None):
    global _socketio
    _socketio = socketio_instance
    init_db(db_path)
    threading.Thread(target=refresh_cache, daemon=True).start()


def _broadcast(event, data):
    if _socketio:
        _socketio.emit(event, data)


def _progress_callback(event, data):
    _broadcast(event, data)


@firmware_bp.route('/firmware')
def firmware_page():
    return render_template('firmware.html')


@firmware_bp.route('/api/firmware/cards')
def api_firmware_cards():
    return jsonify(get_firmware_cards())


@firmware_bp.route('/api/firmware/list/<category>')
def api_firmware_list(category):
    if category == 'stable':
        data = get_stable_firmwares()
    elif category == 'beta':
        data = get_beta_firmwares()
    elif category == 'legacy':
        data = get_legacy_firmwares()
    else:
        data = get_latest_firmwares()
    return jsonify(data)


@firmware_bp.route('/api/firmware/detect')
def api_detect_boards():
    detected = detect_boards(emit_callback=_broadcast)
    return jsonify(detected)


@firmware_bp.route('/api/firmware/history')
def api_firmware_history():
    return jsonify(get_installation_history(100))


@firmware_bp.route('/api/firmware/known-boards')
def api_known_boards():
    return jsonify(get_known_boards())


@firmware_bp.route('/api/firmware/refresh-cache')
def api_refresh_cache():
    result = refresh_cache()
    return jsonify(result)


@firmware_bp.route('/api/firmware/download', methods=['POST'])
def api_download_firmware():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    result = download_firmware(data, progress_callback=_progress_callback)
    if result:
        cache_firmware(
            data.get('name', ''),
            data.get('version', ''),
            data.get('frame', ''),
            data.get('category', 'stable'),
            data.get('url', ''),
            result.get('checksum_sha256', ''),
            result.get('file_size', 0),
            result.get('path', ''),
        )
        return jsonify(result)
    return jsonify({"error": "Download failed"}), 500


@firmware_bp.route('/api/firmware/verify', methods=['POST'])
def api_verify_firmware():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    file_path = data.get('file_path', '')
    expected = data.get('checksum_sha256', '')

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    ok = verify_checksum(file_path, expected)
    _broadcast('verification_progress', {
        'percent': 100 if ok else 0,
        'stage': 'complete' if ok else 'failed',
        'valid': ok,
    })
    return jsonify({"valid": ok})


@firmware_bp.route('/api/firmware/flash', methods=['POST'])
def api_flash_firmware():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    file_path = data.get('file_path', '')
    port = data.get('port', '')
    baud = data.get('baud', 115200)
    board_name = data.get('board_name', 'Unknown')
    fw_name = data.get('fw_name', 'Unknown')
    fw_version = data.get('fw_version', '0.0.0')

    if not os.path.exists(file_path):
        return jsonify({"error": "Firmware file not found"}), 404

    if not port:
        return jsonify({"error": "No port specified"}), 400

    ok = flash_firmware(
        file_path,
        port,
        baud,
        progress_callback=_progress_callback,
        socketio=_socketio,
    )

    if ok:
        record_installation(board_name, fw_name, fw_version)

    return jsonify({"started": ok})


@firmware_bp.route('/api/firmware/force-bootloader', methods=['POST'])
def api_force_bootloader():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data"}), 400

    port = data.get('port', '')
    ok = force_bootloader_mode(port, socketio=_socketio)
    return jsonify({"started": ok})


@firmware_bp.route('/api/firmware/upload-custom', methods=['POST'])
def api_upload_custom():
    if 'file' not in request.files:
        return jsonify({"error": "No file"}), 400

    file = request.files['file']
    if not file:
        return jsonify({"error": "Empty file"}), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ('.apj', '.hex', '.bin', '.px4'):
        return jsonify({"error": f"Unsupported file type: {ext}. Allowed: .apj, .hex, .bin, .px4"}), 400

    fw_dir = os.path.join(os.path.dirname(__file__), '..', '..', 'firmware_cache', 'custom')
    os.makedirs(fw_dir, exist_ok=True)
    save_path = os.path.join(fw_dir, file.filename)
    file.save(save_path)

    import hashlib
    sha256 = hashlib.sha256()
    with open(save_path, 'rb') as f:
        while True:
            chunk = f.read(65536)
            if not chunk:
                break
            sha256.update(chunk)
    checksum = sha256.hexdigest()

    _broadcast('firmware_log', {
        'message': f'Custom firmware uploaded: {file.filename}',
        'level': 'success',
    })

    return jsonify({
        'path': save_path,
        'name': file.filename,
        'file_size': os.path.getsize(save_path),
        'checksum_sha256': checksum,
    })
