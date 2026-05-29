import tkinter as tk
from sgc.gui import theme


class StatusBar(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=theme.BG_SURFACE, bd=0, highlightthickness=0, height=28)
        self.pack_propagate(False)

        self.message_label = tk.Label(self, text="Ready", bg=theme.BG_SURFACE,
                                      fg=theme.TEXT_MUTED, font=("Segoe UI", 10),
                                      anchor=tk.W, padx=12)
        self.message_label.pack(side=tk.LEFT, fill=tk.X, expand=True)

        right_frame = tk.Frame(self, bg=theme.BG_SURFACE)
        right_frame.pack(side=tk.RIGHT)

        self.indicators = {}
        indicators = [
            ("connection", "\u25cf Disconnected", "#ef4444"),
            ("gps", "\u25cf GPS: No Fix", "#eab308"),
            ("sats", "\u25cf Sats: 0", "#94a3b8"),
            ("mode", "\u25cf Mode: ---", "#94a3b8"),
            ("armed", "\u25cf Disarmed", "#94a3b8"),
        ]

        for i, (key, text, color) in enumerate(indicators):
            if i > 0:
                sep = tk.Frame(right_frame, bg=theme.BORDER, width=1, bd=0)
                sep.pack(side=tk.LEFT, fill=tk.Y, padx=4)
            lbl = tk.Label(right_frame, text=text, bg=theme.BG_SURFACE, fg=color,
                           font=("Segoe UI", 10))
            lbl.pack(side=tk.LEFT, padx=(0, 8))
            self.indicators[key] = lbl

    def show_message(self, message, timeout=0):
        self.message_label.config(text=message)

    def update_status(self, data: dict):
        if data.get("connected", False):
            self.indicators["connection"].config(text="\u25cf Connected", fg="#22c55e")
        else:
            self.indicators["connection"].config(text="\u25cf Disconnected", fg="#ef4444")

        fix_type = data.get("fix_type", 0)
        if fix_type >= 3:
            self.indicators["gps"].config(text="\u25cf GPS: 3D Fix", fg="#22c55e")
        elif fix_type == 2:
            self.indicators["gps"].config(text="\u25cf GPS: 2D Fix", fg="#eab308")
        else:
            self.indicators["gps"].config(text="\u25cf GPS: No Fix", fg="#ef4444")

        sats = data.get("satellites", 0)
        self.indicators["sats"].config(text=f"\u25cf Sats: {sats}", fg="#94a3b8")
        self.indicators["mode"].config(text=f"\u25cf Mode: {data.get('mode', '---')}",
                                       fg="#0ea5e9")

        if data.get("armed", False):
            self.indicators["armed"].config(text="\u25cf Armed", fg="#ef4444")
        else:
            self.indicators["armed"].config(text="\u25cf Disarmed", fg="#94a3b8")
