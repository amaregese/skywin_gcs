import tkinter as tk
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
INFO = "#0ea5e9"


FLIGHT_MODES = [
    "STABILIZE", "ACRO", "ALT_HOLD", "AUTO", "GUIDED",
    "LOITER", "RTL", "CIRCLE", "LAND", "DRIFT",
    "SPORT", "FLIP", "AUTOTUNE", "POSHOLD", "BRAKE",
    "THROW", "AVOID_ADSB", "GUIDED_NOGPS", "SMART_RTL",
    "FLOWHOLD", "FOLLOW", "ZIGZAG", "SYSTEM_ID",
    "AUTOROTATE", "AUTO_RTL",
]


class FlightModePanel(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=BG_SURFACE, bd=0, highlightthickness=0)

        header = tk.Frame(self, bg=BG_DARK, height=28)
        header.pack(fill=tk.X)
        header.pack_propagate(False)
        tk.Label(header, text="  ACTIONS", bg=BG_DARK, fg=ACCENT,
                 font=("Segoe UI", 9, "bold")).pack(anchor=tk.W)

        content = tk.Frame(self, bg=BG_SURFACE)
        content.pack(fill=tk.BOTH, expand=True, padx=6, pady=6)

        self._build_mode_section(content)
        self._build_control_section(content)
        self._build_info_section(content)

    def _make_group(self, parent, title):
        frame = tk.Frame(parent, bg=BG_DARK, bd=0, highlightthickness=0)
        frame.pack(fill=tk.X, pady=(0, 8))

        inner = tk.Frame(frame, bg=BG_DARK, bd=0)
        inner.pack(fill=tk.X, padx=8, pady=8)

        tk.Label(inner, text=title, bg=BG_DARK, fg=TEXT_MUTED,
                 font=("Segoe UI", 9, "bold")).pack(anchor=tk.W, pady=(0, 6))
        return inner

    def _build_mode_section(self, parent):
        group = self._make_group(parent, "FLIGHT MODE")

        self.mode_var = tk.StringVar(value="GUIDED")
        self.mode_menu = tk.OptionMenu(group, self.mode_var, *FLIGHT_MODES)
        self.mode_menu.config(bg=BG_DARK, fg=TEXT, activebackground=BORDER,
                              activeforeground=TEXT, bd=0, highlightthickness=0,
                              font=("Segoe UI", 10, "bold"), indicatoron=0,
                              relief=tk.FLAT, padx=8, pady=4)
        self.mode_menu.pack(fill=tk.X)

        menu = self.mode_menu["menu"]
        menu.config(bg=BG_DARK, fg=TEXT, activebackground=ACCENT,
                    activeforeground="white", bd=0, font=("Segoe UI", 10))

        self._styled_btn(group, "SET MODE", ACCENT, self._on_set_mode)

    def _build_control_section(self, parent):
        group = self._make_group(parent, "VEHICLE CONTROL")

        row1 = tk.Frame(group, bg=BG_DARK)
        row1.pack(fill=tk.X)
        self._styled_btn(row1, "ARM", SUCCESS, self._on_arm).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(0, 3))
        self._styled_btn(row1, "DISARM", DANGER, self._on_disarm).pack(
            side=tk.LEFT, fill=tk.X, expand=True, padx=(3, 0))

        for label, color in [("RTL", WARNING), ("LAND", WARNING), ("TAKEOFF", ACCENT)]:
            self._styled_btn(group, label, color, lambda l=label: None).pack(
                fill=tk.X, pady=(0, 4))

    def _build_info_section(self, parent):
        group = self._make_group(parent, "VEHICLE INFO")

        self.info_labels = {}
        for key in ["SysID", "CompID", "Type", "Firmware"]:
            row = tk.Frame(group, bg=BG_DARK)
            row.pack(fill=tk.X, pady=1)
            tk.Label(row, text=f"{key}:", bg=BG_DARK, fg=TEXT_MUTED,
                     font=("Segoe UI", 10), width=8, anchor=tk.W).pack(side=tk.LEFT)
            lbl = tk.Label(row, text="---", bg=BG_DARK, fg=TEXT,
                           font=("Segoe UI", 10), anchor=tk.W)
            lbl.pack(side=tk.LEFT, fill=tk.X, expand=True)
            self.info_labels[key] = lbl

    def _styled_btn(self, parent, text, color, command):
        return tk.Button(parent, text=text, command=command,
                         bg=color, fg="white" if color != WARNING else "#0f172a",
                         font=("Segoe UI", 9, "bold"), relief=tk.FLAT,
                         padx=8, pady=4, cursor="hand2",
                         activebackground=color, activeforeground="white",
                         bd=0, highlightthickness=0)

    def _on_set_mode(self):
        mode = self.mode_var.get()
        from sgc.gui.main_window import INFO
        pass

    def _on_arm(self):
        pass

    def _on_disarm(self):
        pass

    def update_info(self, data: dict):
        mappings = {
            "SysID": data.get("sysid", "---"),
            "CompID": data.get("compid", "---"),
            "Type": data.get("vehicle_type", "---"),
            "Firmware": data.get("firmware", "---"),
        }
        for key, value in mappings.items():
            if key in self.info_labels:
                self.info_labels[key].config(text=str(value))
