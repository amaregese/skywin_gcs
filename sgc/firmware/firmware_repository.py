import concurrent.futures
import json
import os
import re
import threading
import time
from html.parser import HTMLParser
from urllib.request import urlopen, Request
from urllib.error import URLError
from urllib.parse import urlparse

FIRMWARE_BASE_URL = "https://firmware.ardupilot.org"
FIRMWARE_CACHE_TTL = 3600

_firmware_cache = {}
_cache_lock = threading.Lock()


class FirmwareLinkParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href":
                    self.links.append(value)


VEHICLE_TO_FRAME = {
    "AntennaTracker": "Tracker",
    "ArduPlane": "Plane",
    "ArduCopter": "Quad",
    "ArduHeli": "Helicopter",
    "ArduSub": "Sub",
    "Rover": "Rover",
    "Blimp": "Blimp",
    "Plane": "Plane",
    "Copter": "Quad",
    "Helicopter": "Helicopter",
    "Sub": "Sub",
}

FRAME_TO_VEHICLE = {v: k for k, v in VEHICLE_TO_FRAME.items()}

FIRMWARE_CARDS = [
    {"id": "rover", "name": "Rover", "icon": "🚙", "vehicles": ["Rover"]},
    {"id": "plane", "name": "Plane", "icon": "✈", "vehicles": ["Plane"]},
    {"id": "quad", "name": "Quad", "icon": "🛩", "vehicles": ["Quad"]},
    {"id": "heli", "name": "Helicopter", "icon": "🚁", "vehicles": ["Helicopter"]},
    {"id": "sub", "name": "Sub", "icon": "🤿", "vehicles": ["Sub"]},
    {"id": "tracker", "name": "Tracker", "icon": "📡", "vehicles": ["Tracker"]},
]

CATEGORY_MAP = {
    "stable": "Stable",
    "beta": "Beta",
    "latest": "Latest",
    "legacy": "Legacy",
}

_version_re = re.compile(r"(\d+\.\d+\.\d+)")
_SKIP_PREFIXES = ["latest", "stable", "beta"]


def _fetch_url(url, timeout=15):
    try:
        req = Request(url, headers={"User-Agent": "SGC-Firmware/1.0"})
        resp = urlopen(req, timeout=timeout)
        return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def _parse_directory_listing(url, prefix=None):
    html = _fetch_url(url)
    if not html:
        return []
    parser = FirmwareLinkParser()
    parser.feed(html)
    
    parsed_url = urlparse(url)
    base_path = parsed_url.path.rstrip("/") + "/"
    
    result = []
    for link in parser.links:
        if prefix is not None and not link.startswith(prefix):
            continue
        name = link.rstrip("/")
        if name.startswith("..") or name.startswith("?"):
            continue
        if name.startswith("/"):
            if name.startswith(base_path):
                name = name[len(base_path):]
            else:
                continue
        if not name:
            continue
        if name.startswith("http://") or name.startswith("https://"):
            continue
        result.append(name)
    return result


def _fetch_vehicle_releases(vehicle):
    url = f"{FIRMWARE_BASE_URL}/{vehicle}/"
    dirs = _parse_directory_listing(url)
    releases = []
    for d in dirs:
        if d in _SKIP_PREFIXES:
            continue
        if d.startswith("."):
            continue
        if d == vehicle:
            continue
        releases.append(d)
    return releases


def _try_parse_version(api_url, file_name):
    text = _fetch_url(api_url)
    if not text:
        return None
    return _extract_version(text)


def _extract_version(text):
    m = _version_re.search(text)
    if m:
        return m.group(1)
    parts = text.split()
    for p in parts:
        m = _version_re.search(p)
        if m:
            return m.group(1)
    return None


def _get_fw_url(board_url, vehicle):
    base = board_url.rstrip("/")
    file_map = {
        "Rover": f"{base}/ardurover.apj",
        "Plane": f"{base}/arduplane.apj",
        "Quad": f"{base}/arducopter.apj",
        "Helicopter": f"{base}/arducopter-heli.apj",
        "Sub": f"{base}/ardusub.apj",
        "Tracker": f"{base}/antennatracker.apj",
    }
    return file_map.get(vehicle)


def _fetch_boards_for_release(vehicle, release_url, category):
    entries = _parse_directory_listing(release_url)
    results = []

    for part in entries:
        if part.startswith("."):
            continue
        if part == "apj":
            continue

        p = part.rstrip("/")
        if p in _SKIP_PREFIXES:
            continue
        if p == "version.txt":
            continue

        board_url = f"{release_url.rstrip('/')}/{p}/"
        version = _extract_version(release_url)

        v = VEHICLE_TO_FRAME.get(vehicle, vehicle)
        board = {"board": p, "name": p, "version": version or "unknown", "vehicle": v, "category": category}

        fw_url = _get_fw_url(board_url, v)
        if fw_url:
            board["fw_url"] = fw_url
            results.append(board)

    return results


def _get_vehicles():
    dirs = _parse_directory_listing(FIRMWARE_BASE_URL, prefix=None)
    valid = []
    for d in dirs:
        if d.startswith("."):
            continue
        if d in _SKIP_PREFIXES:
            continue
        if d in VEHICLE_TO_FRAME:
            valid.append(d)
    return valid


def _fetch_firmware_list(category):
    cached = _firmware_cache.get(category)
    if cached and (time.time() - cached["ts"]) < FIRMWARE_CACHE_TTL:
        return cached["data"]

    actual_dir = category
    if category == "legacy":
        actual_dir = "stable-4.5.7"

    all_results = []
    vehicles = _get_vehicles()

    tasks = []
    for vehicle in vehicles:
        releases = _fetch_vehicle_releases(vehicle)
        if category in ("stable", "beta", "latest"):
            releases.append(category)
        for r in releases:
            full_url = f"{FIRMWARE_BASE_URL}/{vehicle}/{r}/"
            if category == "latest":
                pass
            elif category == "legacy" and "4.5" in full_url:
                pass
            elif category in full_url.lower():
                pass
            elif actual_dir in full_url:
                pass
            else:
                continue
            tasks.append((vehicle, full_url, category))

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futs = [pool.submit(_fetch_boards_for_release, v, u, c) for v, u, c in tasks]
        for fut in concurrent.futures.as_completed(futs):
            try:
                fws = fut.result()
                if fws:
                    all_results.extend(fws)
            except Exception:
                pass

    result = {"category": category, "firmwares": all_results, "count": len(all_results)}
    with _cache_lock:
        _firmware_cache[category] = {"ts": time.time(), "data": result}
    return result


def get_firmware_cards():
    return FIRMWARE_CARDS


def get_stable_firmwares():
    return _fetch_firmware_list("stable")


def get_beta_firmwares():
    return _fetch_firmware_list("beta")


def get_latest_firmwares():
    return _fetch_firmware_list("latest")


def get_legacy_firmwares():
    return _fetch_firmware_list("legacy")


def get_firmware_for_category(frame_category, category):
    all_fw = _fetch_firmware_list(category)
    fw_list = all_fw.get("firmwares", [])
    return [fw for fw in fw_list if fw.get("vehicle", "").lower() == frame_category.lower()]


def refresh_cache():
    with _cache_lock:
        _firmware_cache.clear()
    counts = {}
    for cat in ["stable", "beta", "latest", "legacy"]:
        data = _fetch_firmware_list(cat)
        counts[cat] = data.get("count", 0)
    return {"status": "ok", "counts": counts}
