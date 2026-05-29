import tkinter as tk
import math
from sgc.gui import theme

BG_DARK = "#0f172a"
BORDER = "#334155"
TEXT = "#e2e8f0"
TEXT_MUTED = "#94a3b8"
ACCENT = "#7c3aed"
SUCCESS = "#22c55e"
WARNING = "#eab308"
INFO = "#0ea5e9"


class MapWidget(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK, bd=0, highlightthickness=0)

        self.canvas = MapCanvas(self)
        self.canvas.pack(fill=tk.BOTH, expand=True)

    def set_vehicle_position(self, lat, lon, heading):
        self.canvas.set_vehicle_position(lat, lon, heading)


class MapCanvas(tk.Canvas):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK, highlightthickness=0, bd=0)
        self._lat = None
        self._lon = None
        self._heading = 0.0
        self._trail = []

        self.bind("<Configure>", self._on_resize)
        self._drawn = False

    def _on_resize(self, event):
        self._drawn = False
        self.after(50, self._redraw)

    def _redraw(self):
        self.delete("all")
        self._draw_grid()
        self._draw_rings()
        self._draw_placeholder()
        self._draw_vehicle()
        self._draw_labels()

    def set_vehicle_position(self, lat, lon, heading):
        self._lat = lat
        self._lon = lon
        self._heading = heading
        if lat and lon:
            self._trail.append((lat, lon))
            if len(self._trail) > 500:
                self._trail.pop(0)
        self._redraw()

    def _draw_grid(self):
        w = self.winfo_width() or 600
        h = self.winfo_height() or 400

        for x in range(0, w, 40):
            self.create_line(x, 0, x, h, fill="#1e293b", width=1)
        for y in range(0, h, 40):
            self.create_line(0, y, w, y, fill="#1e293b", width=1)

    def _draw_rings(self):
        w = self.winfo_width() or 600
        h = self.winfo_height() or 400
        cx, cy = w // 2, h // 2

        for r in (60, 120):
            self.create_oval(cx - r, cy - r, cx + r, cy + r,
                             outline="#334155", width=1, dash=(4, 4))

        self.create_line(cx - 140, cy, cx + 140, cy, fill="#475569", width=1)
        self.create_line(cx, cy - 140, cx, cy + 140, fill="#475569", width=1)

    def _draw_placeholder(self):
        self.create_text(16, 30, text="MAP VIEW", anchor=tk.W,
                         fill=TEXT, font=("Segoe UI", 12, "bold"))
        self.create_text(16, 50, text="Connect to vehicle to enable", anchor=tk.W,
                         fill=TEXT_MUTED, font=("Segoe UI", 10))

        for name, color, dx, dy in [
            ("Home", SUCCESS, -80, -60),
            ("WP 1", WARNING, 100, -80),
            ("WP 2", WARNING, 60, 100),
        ]:
            w = self.winfo_width() or 600
            h = self.winfo_height() or 400
            cx, cy = w // 2, h // 2
            x, y = cx + dx, cy + dy
            self.create_oval(x - 4, y - 4, x + 4, y + 4, fill=color, outline="")
            self.create_text(x + 12, y + 2, text=name, anchor=tk.W,
                             fill=color, font=("Segoe UI", 9))

    def _draw_vehicle(self):
        if self._lat is None:
            return
        w = self.winfo_width() or 600
        h = self.winfo_height() or 400
        cx, cy = w // 2, h // 2

        heading_rad = math.radians(self._heading)

        size = 14
        x1 = cx + size * math.sin(heading_rad)
        y1 = cy - size * math.cos(heading_rad)
        x2 = cx + size * math.sin(heading_rad + 2.5)
        y2 = cy - size * math.cos(heading_rad + 2.5)
        x3 = cx + size * math.sin(heading_rad - 2.5)
        y3 = cy - size * math.cos(heading_rad - 2.5)

        self.create_polygon(x1, y1, x2, y2, x3, y3, fill=INFO, outline="#0284c7", width=2)

        self.create_oval(cx - 5, cy - 5, cx + 5, cy + 5, fill=INFO, outline="")

        heading_line_len = 24
        hx = cx + heading_line_len * math.sin(heading_rad)
        hy = cy - heading_line_len * math.cos(heading_rad)
        self.create_line(cx, cy, hx, hy, fill=TEXT, width=2)

        info_text = f"Lat: {self._lat:.7f}  Lon: {self._lon:.7f}  Hdg: {self._heading:.1f}\u00b0"
        self.create_text(16, h - 16, text=info_text, anchor=tk.W,
                         fill=TEXT_MUTED, font=("Segoe UI", 9))

    def _draw_labels(self):
        pass


class AttitudeIndicator(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_DARK, bd=0, highlightthickness=0, height=60)
        self.pack_propagate(False)
        self._roll = 0.0
        self._pitch = 0.0

        self.canvas = tk.Canvas(self, bg=BG_DARK, highlightthickness=0, bd=0)
        self.canvas.pack(fill=tk.BOTH, expand=True)
        self.bind("<Configure>", lambda e: self._draw())

    def set_attitude(self, roll, pitch):
        self._roll = roll
        self._pitch = pitch
        self._draw()

    def _draw(self):
        self.canvas.delete("all")
        w = self.canvas.winfo_width() or 200
        h = self.canvas.winfo_height() or 60
        cx, cy = w // 2, h // 2
        r = min(w, h) // 2 - 6

        if r < 10:
            return

        self.canvas.create_oval(cx - r, cy - r, cx + r, cy + r,
                                outline="#475569", width=2, fill=BG_DARK)

        pitch_offset = int(self._pitch * 1.5)
        pitch_offset = max(-r + 10, min(r - 10, pitch_offset))

        rad = math.radians(self._roll)
        cos_a, sin_a = math.cos(rad), math.sin(rad)

        lx = cx - (r - 8) * cos_a
        ly = cy - pitch_offset - (r - 8) * sin_a
        rx = cx + (r - 8) * cos_a
        ry = cy - pitch_offset + (r - 8) * sin_a

        self.canvas.create_line(lx, ly, rx, ry, fill=SUCCESS, width=2)

        tick_len = 4
        llx = cx - 4 * cos_a - tick_len * sin_a
        lly = cy - pitch_offset - 4 * sin_a + tick_len * cos_a
        self.canvas.create_line(cx - 2 * cos_a, cy - pitch_offset - 2 * sin_a,
                                llx, lly, fill=TEXT, width=2)

        rrx = cx + 4 * cos_a - tick_len * sin_a
        rry = cy - pitch_offset + 4 * sin_a + tick_len * cos_a
        self.canvas.create_line(cx + 2 * cos_a, cy - pitch_offset + 2 * sin_a,
                                rrx, rry, fill=TEXT, width=2)

        clx = cx - 3 * sin_a
        cly = cy - pitch_offset + 3 * cos_a
        self.canvas.create_line(clx, cly, clx, cly - 8, fill=TEXT, width=2)

        self.canvas.create_oval(cx - 2, cy - 2, cx + 2, cy + 2, fill=ACCENT, outline="")
