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
    def __init__(self, prefix=""):
        super().__init__()
        self.links = []
        self.prefix = prefix
    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, val in attrs:
                if name == "href" and not val.startswith("http") and not val.startswith("https"):
                    full = val.rstrip("/")
                    self.links.append(full)


VEHICLE_TO_FRAME = {
    "Copter": "Quad",
    "Plane": "Plane",
    "Rover": "Rover",
    "Sub": "Sub",
    "AntennaTracker": "Tracker",
    "Blimp": "Blimp",
    "Helicopter": "Helicopter",
}

FRAME_TO_VEHICLE = {
    "Quad": "Copter",
    "Hexa": "Copter",
    "Octa": "Copter",
    "Tri": "Copter",
    "Y6": "Copter",
    "X8": "Copter",
    "Helicopter": "Copter",
    "Plane": "Plane",
    "Rover": "Rover",
    "Sub": "Sub",
    "Tracker": "AntennaTracker",
    "Blimp": "Blimp",
    "Custom": "Copter",
}

FIRMWARE_CARDS = [
    {"id": "rover", "name": "Rover", "icon": "🚜", "category": "Rover"},
    {"id": "plane", "name": "Plane", "icon": "✈️", "category": "Plane"},
    {"id": "quad", "name": "Quadcopter", "icon": "🚁", "category": "Quad"},
    {"id": "hexa", "name": "Hexacopter", "icon": "🚁", "category": "Hexa"},
    {"id": "octa", "name": "Octocopter", "icon": "🚁", "category": "Octa"},
    {"id": "heli", "name": "Helicopter", "icon": "🚁", "category": "Helicopter"},
    {"id": "tri", "name": "Tricopter", "icon": "🚁", "category": "Tri"},
    {"id": "y6", "name": "Y6", "icon": "🚁", "category": "Y6"},
    {"id": "x8", "name": "X8", "icon": "🚁", "category": "X8"},
    {"id": "custom", "name": "Custom Frame", "icon": "🔧", "category": "Custom"},
    {"id": "sub", "name": "Submarine", "icon": "🤿", "category": "Sub"},
    {"id": "tracker", "name": "Antenna Tracker", "icon": "📡", "category": "Tracker"},
]


def _fetch_url(url, timeout=15):
    try:
        req = Request(url, headers={"User-Agent": "SGC-GCS/1.0"})
        with urlopen(req, timeout=timeout) as resp:
            return resp.read().decode("utf-8", errors="replace")
    except Exception:
        return None


def _parse_directory_listing(url, prefix=""):
    html = _fetch_url(url)
    if not html:
        return []
    parser = FirmwareLinkParser(prefix=prefix)
    parser.feed(html)
    result = []
    for link in parser.links:
        name = link.rstrip("/").split("/")[-1]
        if name and not name.startswith("."):
            result.append(name)
    return result


CATEGORY_MAP = {
    "stable": "stable",
    "beta": "beta",
    "latest": "latest",
    "legacy": "stable-4.5.7",
}


def _fetch_vehicle_releases(vehicle):
    url = f"{FIRMWARE_BASE_URL}/{vehicle}/"
    dirs = _parse_directory_listing(url)
    releases = {}
    for d in dirs:
        if d in ("stable", "beta", "latest") or d.startswith("stable-"):
            releases[d] = f"{url}{d}/"
    return releases


import re as _version_re


def _try_parse_version(api_url, file_name):
    text = _fetch_url(f"{api_url}{file_name}", timeout=5)
    return _extract_version(text)


def _extract_version(text):
    if not text:
        return None
    text = text.strip()
    # Try "vX.Y.Z" or "VX.Y.Z" pattern first
    m = _version_re.search(r"\b([vV]\d+[.]\d+[.]\d+)", text)
    if m:
        return m.group(1).lower()
    # Try "X.Y.Z" without v prefix
    m = _version_re.search(r"(\d+[.]\d+[.]\d+)", text)
    if m:
        return "v" + m.group(1)
    # Return first word as fallback
    parts = text.split()
    return parts[0] if parts else None


def _get_fw_url(board_url, vehicle):
    vehicle_lower = vehicle.lower()
    file_map = {
        "copter": "arducopter.apj",
        "plane": "arduplane.apj",
        "rover": "ardurover.apj",
        "sub": "ardusub.apj",
        "antennatracker": "antennatracker.apj",
        "blimp": "ardublimp.apj",
    }
    fname = file_map.get(vehicle_lower, f"{vehicle_lower}.apj")
    return f"{board_url}{fname}"


_SKIP_PREFIXES = ["Parent", "firmware-version", "manifest", "README"]


def _fetch_boards_for_release(vehicle, release_url, category):
    entries = _parse_directory_listing(release_url)
    results = []

    # Build set of parent path components to filter out (e.g. "Rover", "stable" from the URL)
    from urllib.parse import urlparse
    parsed = urlparse(release_url)
    parent_parts = set()
    for part in parsed.path.split("/"):
        p = part.strip()
        if p:
            parent_parts.add(p.lower())

    # Separate heli boards, filter out non-board entries
    heli_boards = []
    normal_boards = []
    seen = set()
    for e in entries:
        # Reject empty, files, and parent-dir references
        if not e or "." in e:
            continue
        name_lower = e.lower()
        # Skip parent path components and known non-board names
        if name_lower in parent_parts:
            continue
        skip = False
        for prefix in _SKIP_PREFIXES:
            if name_lower.startswith(prefix.lower()):
                skip = True
                break
        if skip:
            continue
        if name_lower in seen:
            continue
        seen.add(name_lower)
        if e.endswith("-heli") or e.endswith("-Heli"):
            heli_boards.append(e)
        else:
            normal_boards.append(e)

    # Fetch version from a board that definitely has firmware-version.txt
    version = ""
    for name in normal_boards[:5]:
        v = _try_parse_version(f"{release_url}{name}/", "firmware-version.txt")
        if v:
            version = v
            break
    if not version:
        version = "latest"

    for board in normal_boards:
        board_url = f"{release_url}{board}/"
        fw_url = _get_fw_url(board_url, vehicle)
        results.append({
            "name": f"Ardu{vehicle}",
            "version": version,
            "frame": VEHICLE_TO_FRAME.get(vehicle, "Custom"),
            "url": fw_url,
            "board": board,
            "category": category,
            "checksum_sha256": "",
            "file_size": 0,
            "description": f"{vehicle} firmware for {board}",
        })

    for board in heli_boards:
        board_url = f"{release_url}{board}/"
        fw_url = _get_fw_url(board_url, vehicle)
        results.append({
            "name": f"Ardu{vehicle}",
            "version": version,
            "frame": "Helicopter",
            "url": fw_url,
            "board": board,
            "category": category,
            "checksum_sha256": "",
            "file_size": 0,
            "description": f"{vehicle} Helicopter firmware for {board}",
        })

    return results


def _get_vehicles():
    dirs = _parse_directory_listing(f"{FIRMWARE_BASE_URL}/")
    valid = []
    for d in dirs:
        if d in VEHICLE_TO_FRAME:
            valid.append(d)
    return valid


def _fetch_firmware_list(category="stable"):
    with _cache_lock:
        cached = _firmware_cache.get(category)
        if cached and (time.time() - cached["time"]) < FIRMWARE_CACHE_TTL:
            return cached["data"]

    actual_dir = CATEGORY_MAP.get(category, category)
    all_results = []
    vehicles = _get_vehicles()

    for vehicle in vehicles:
        releases = _fetch_vehicle_releases(vehicle)
        release_url = releases.get(actual_dir) or releases.get("stable")
        if not release_url:
            continue
        try:
            fws = _fetch_boards_for_release(vehicle, release_url, category)
            all_results.extend(fws)
        except Exception:
            pass

    result = all_results

    with _cache_lock:
        _firmware_cache[category] = {"data": result, "time": time.time()}

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


def get_firmware_for_category(frame_category, category="stable"):
    all_fw = _fetch_firmware_list(category)
    return [fw for fw in all_fw if fw.get("frame", "").lower() == frame_category.lower()]


def refresh_cache():
    with _cache_lock:
        _firmware_cache.clear()
    counts = {}
    for cat in ("stable", "beta", "latest", "legacy"):
        counts[cat] = len(_fetch_firmware_list(cat))
    return counts
