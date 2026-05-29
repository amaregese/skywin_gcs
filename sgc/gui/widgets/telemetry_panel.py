import tkinter as tk
from tkinter import ttk
from sgc.gui import theme

BG_DARK = "#0f172a"
BG_SURFACE = "#1e293b"
BORDER = "#334155"
ACCENT = "#7c3aed"
TEXT = "#e2e8f0"
TEXT_MUTED = "#94a3b8"
SUCCESS = "#22c55e"
DANGER = "#ef4444"
WARNING = "#eab308"


class TelemetryPanel(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_SURFACE, bd=0, highlightthickness=0)
        self.configure(relief=tk.FLAT)

        canvas = tk.Canvas(self, bg=BG_SURFACE, highlightthickness=0, bd=0, width=260)
        scrollbar = tk.Scrollbar(self, orient=tk.VERTICAL, command=canvas.yview,
                                 bg=BG_SURFACE, troughcolor=BG_DARK, bd=0,
                                 activebackground=BORDER, elementborderwidth=0)
        self.scroll_frame = tk.Frame(canvas, bg=BG_SURFACE)

        self.scroll_frame.bind("<Configure>",
            lambda e: canvas.configure(scrollregion=canvas.bbox("all")))

        canvas.create_window((0, 0), window=self.scroll_frame, anchor="nw", width=245)
        canvas.configure(yscrollcommand=scrollbar.set)

        canvas.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)

        self._bind_mousewheel(canvas)

        self.groups = {}

        self.gps_group = self._add_group("GPS")
        self._add_row(self.gps_group, "Lat", "0.0000000", "\u00b0")
        self._add_row(self.gps_group, "Lon", "0.0000000", "\u00b0")
        self._add_row(self.gps_group, "Alt", "0.00", "m")
        self._add_row(self.gps_group, "Speed", "0.00", "m/s")
        self._add_row(self.gps_group, "Heading", "0.0", "\u00b0")

        self.battery_group = self._add_group("BATTERY")
        self._add_row(self.battery_group, "Voltage", "0.00", "V")
        self._add_row(self.battery_group, "Current", "0.00", "A")
        self._add_row(self.battery_group, "Remaining", "0", "%")
        self._add_battery_bar(self.battery_group)

        self.attitude_group = self._add_group("ATTITUDE")
        self._add_row(self.attitude_group, "Roll", "0.0", "\u00b0")
        self._add_row(self.attitude_group, "Pitch", "0.0", "\u00b0")
        self._add_row(self.attitude_group, "Yaw", "0.0", "\u00b0")

        from sgc.gui.widgets.map_widget import AttitudeIndicator
        self.attitude_indicator = AttitudeIndicator(self.attitude_group)
        self.attitude_indicator.pack(fill=tk.X, padx=6, pady=(0, 6))
        self._widgets["attitude_indicator"] = self.attitude_indicator

        self.status_group = self._add_group("STATUS")
        self._add_row(self.status_group, "Mode", "---", "")
        self.armed_row = self._add_row(self.status_group, "Armed", "No", "")
        self._add_row(self.status_group, "Sats", "0", "")
        self._add_row(self.status_group, "Fix", "No Fix", "")
        self._add_row(self.status_group, "HDOP", "0.00", "")

    def _bind_mousewheel(self, canvas):
        def _on_mousewheel(event):
            canvas.yview_scroll(int(-1 * (event.delta / 120)), "units")
        canvas.bind_all("<MouseWheel>", _on_mousewheel, add="+")

    def _add_group(self, title):
        frame = tk.Frame(self.scroll_frame, bg=BG_DARK, bd=0, highlightthickness=0)
        frame.pack(fill=tk.X, padx=6, pady=(0, 6))

        header = tk.Frame(frame, bg=BG_DARK, bd=0)
        header.pack(fill=tk.X, padx=8, pady=(8, 4))

        tk.Label(header, text=title, bg=BG_DARK, fg=ACCENT,
                 font=("Segoe UI", 9, "bold")).pack(anchor=tk.W)

        sep = tk.Frame(frame, bg=theme.BORDER, height=1, bd=0)
        sep.pack(fill=tk.X, padx=8)

        content = tk.Frame(frame, bg=BG_DARK, bd=0)
        content.pack(fill=tk.X, padx=8, pady=(4, 8))

        self._widgets = getattr(self, "_widgets", {})
        return content

    def _add_row(self, group, label, value, unit=""):
        row = tk.Frame(group, bg=BG_DARK, bd=0)
        row.pack(fill=tk.X, pady=1)

        lbl = tk.Label(row, text=label, bg=BG_DARK, fg=TEXT_MUTED,
                       font=("Segoe UI", 11), width=8, anchor=tk.W)
        lbl.pack(side=tk.LEFT)

        val = tk.Label(row, text=value, bg=BG_DARK, fg=TEXT,
                       font=("Segoe UI", 11, "bold"), anchor=tk.E)
        val.pack(side=tk.LEFT, fill=tk.X, expand=True)

        if unit:
            u = tk.Label(row, text=unit, bg=BG_DARK, fg=theme.BORDER,
                         font=("Segoe UI", 10), width=3, anchor=tk.W)
            u.pack(side=tk.LEFT)

        self._widgets[label] = val
        return val

    def _add_battery_bar(self, parent):
        bar_frame = tk.Frame(parent, bg=BG_DARK, bd=0)
        bar_frame.pack(fill=tk.X, padx=0, pady=(4, 0))

        self._battery_canvas = tk.Canvas(bar_frame, height=18, bg=BG_DARK,
                                          highlightthickness=0, bd=0)
        self._battery_canvas.pack(fill=tk.X)
        self._battery_value = 0
        self._draw_battery(0)

        self._widgets["battery_bar"] = self._battery_canvas

    def _draw_battery(self, percent):
        canvas = self._battery_canvas
        if not canvas.winfo_exists():
            return
        w = canvas.winfo_width() or 200
        h = 18

        canvas.delete("all")
        canvas.create_rectangle(2, 2, w - 6, h - 2, outline=theme.BORDER,
                                fill=BG_DARK, width=1)

        if percent > 0:
            fill_w = max(4, int((w - 10) * percent / 100))
            if percent > 50:
                color = SUCCESS
            elif percent > 20:
                color = WARNING
            else:
                color = DANGER
            canvas.create_rectangle(4, 4, 4 + fill_w, h - 4, fill=color,
                                    outline="")

        canvas.create_text(w // 2, h // 2, text=f"{percent}%",
                           fill=TEXT, font=("Segoe UI", 9, "bold"))

    def update_data(self, data: dict):
        self._widgets["Lat"].config(text=f"{data.get('lat', 0.0):.7f}")
        self._widgets["Lon"].config(text=f"{data.get('lon', 0.0):.7f}")
        self._widgets["Alt"].config(text=f"{data.get('alt', 0.0):.2f}")
        self._widgets["Speed"].config(text=f"{data.get('ground_speed', 0.0):.2f}")
        self._widgets["Heading"].config(text=f"{data.get('heading', 0.0):.1f}")

        self._widgets["Voltage"].config(text=f"{data.get('battery_voltage', 0.0):.2f}")
        self._widgets["Current"].config(text=f"{data.get('battery_current', 0.0):.2f}")
        self._widgets["Remaining"].config(text=f"{data.get('battery_remaining', 0)}")

        remaining = data.get("battery_remaining", 0)
        self._draw_battery(remaining)

        self._widgets["Roll"].config(text=f"{data.get('roll', 0.0):.1f}")
        self._widgets["Pitch"].config(text=f"{data.get('pitch', 0.0):.1f}")
        self._widgets["Yaw"].config(text=f"{data.get('yaw', 0.0):.1f}")

        if "attitude_indicator" in self._widgets:
            self._widgets["attitude_indicator"].set_attitude(
                data.get("roll", 0.0), data.get("pitch", 0.0))

        mode = data.get("mode", "---")
        armed = "YES" if data.get("armed", False) else "NO"
        self._widgets["Mode"].config(text=mode)
        self.armed_row.config(text=armed,
                              fg=DANGER if data.get("armed") else TEXT_MUTED)
        self._widgets["Sats"].config(text=str(data.get("satellites", 0)))
        self._widgets["HDOP"].config(text=f"{data.get('hdop', 0.0):.2f}")

        fix_types = {0: "No Fix", 2: "2D", 3: "3D", 4: "DGPS",
                     5: "RTK Float", 6: "RTK Fixed"}
        fix = fix_types.get(data.get("fix_type", 0), "Unknown")
        self._widgets["Fix"].config(text=fix)
