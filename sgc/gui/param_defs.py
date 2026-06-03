import os
import time
import xml.etree.ElementTree as ET
from urllib.request import urlopen

CACHE_FILE = os.path.join(os.path.dirname(__file__), ".param_cache.xml")
CACHE_TTL = 86400  # 24 hours

_PARAM_DOCS = {}
_LOADED = False


def _download_xml():
    url = "https://autotest.ardupilot.org/Parameters/ArduCopter/apm.pdef.xml"
    try:
        resp = urlopen(url, timeout=15)
        data = resp.read()
        with open(CACHE_FILE, "wb") as f:
            f.write(data)
        return data
    except Exception:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE, "rb") as f:
                return f.read()
        return None


def _load():
    global _PARAM_DOCS, _LOADED
    if _LOADED:
        return

    data = None
    if os.path.exists(CACHE_FILE):
        age = time.time() - os.path.getmtime(CACHE_FILE)
        if age < CACHE_TTL:
            with open(CACHE_FILE, "rb") as f:
                data = f.read()

    if data is None:
        data = _download_xml()

    if data is None:
        _LOADED = True
        return

    try:
        root = ET.fromstring(data)
        for section in ("vehicles", "libraries"):
            for container in root.iter(section):
                for params in container.iter("parameters"):
                    for param in params.iter("param"):
                        raw_name = param.get("name", "")
                        param_name = raw_name.split(":", 1)[1] if ":" in raw_name else raw_name
                        if param_name in _PARAM_DOCS:
                            continue
                        doc = param.get("documentation", "")
                        human = param.get("humanName", "")
                        user = param.get("user", "")
                        units = ""
                        _range = ""
                        reboot = ""
                        values = {}
                        bitmask = {}
                        for child in param:
                            tag = child.tag
                            if tag == "field":
                                fname = child.get("name", "")
                                ftext = child.text or ""
                                if fname == "Units":
                                    units = ftext.strip()
                                elif fname == "Range":
                                    _range = ftext.strip()
                                elif fname == "RebootRequired":
                                    reboot = ftext.strip()
                            elif tag == "values":
                                for val in child.iter("value"):
                                    code = val.get("code", "")
                                    vtext = val.text or ""
                                    values[code] = vtext.strip()
                            elif tag == "bitmask":
                                for bit in child.iter("bit"):
                                    code = bit.get("code", "")
                                    btext = bit.text or ""
                                    bitmask[code] = btext.strip()

                        _PARAM_DOCS[param_name] = {
                            "description": doc,
                            "human_name": human,
                            "user": user,
                            "units": units,
                            "range": _range,
                            "reboot": reboot == "True",
                            "values": values,
                            "bitmask": bitmask,
                        }
    except Exception:
        pass

    _LOADED = True


def get_description(param_name):
    _load()
    entry = _PARAM_DOCS.get(param_name)
    if entry:
        return entry["description"]
    return ""


def get_metadata(param_name):
    _load()
    return _PARAM_DOCS.get(param_name, {})
