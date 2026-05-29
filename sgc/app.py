import tkinter as tk


class App:
    def __init__(self):
        self.connected = False
        self.vehicle_data = {
            "lat": 37.7749295,
            "lon": -122.4194155,
            "alt": 45.67,
            "ground_speed": 12.34,
            "air_speed": 13.50,
            "battery_voltage": 12.45,
            "battery_current": 3.21,
            "battery_remaining": 78,
            "roll": 1.23,
            "pitch": -0.56,
            "yaw": 45.78,
            "mode": "GUIDED",
            "armed": False,
            "satellites": 14,
            "hdop": 0.65,
            "fix_type": 3,
            "heading": 45.78,
            "throttle": 30,
            "altitude_relative": 42.0,
            "connected": True,
            "sysid": 1,
            "compid": 1,
            "vehicle_type": "QuadCopter",
            "firmware": "ArduCopter 4.5.0",
        }

    def emit_log(self, message, level="info"):
        pass
