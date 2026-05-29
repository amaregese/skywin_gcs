import tkinter as tk
from tkinter import ttk, Menu, filedialog, messagebox

from sgc.gui.widgets.telemetry_panel import TelemetryPanel
from sgc.gui.widgets.map_widget import MapWidget
from sgc.gui.widgets.flight_mode_panel import FlightModePanel
from sgc.gui.widgets.console import ConsoleWidget
from sgc.gui.widgets.status_bar import StatusBar
from sgc.gui import theme

BG_DARK = "#0f172a"
BG_SURFACE = "#1e293b"
BG_INPUT = "#0f172a"
BORDER = "#334155"
ACCENT = "#7c3aed"
TEXT = "#e2e8f0"
TEXT_MUTED = "#94a3b8"
SUCCESS = "#22c55e"
DANGER = "#ef4444"
WARNING = "#eab308"
INFO = "#0ea5e9"


class MainWindow:
    def __init__(self, root, app):
        self.root = root
        self.app = app
        self.console_visible = False

        root.title("SGC - Skywin Ground Control Station")
        root.configure(bg=BG_DARK)
        root.minsize(1200, 800)
        root.geometry("1600x1000")

        theme.apply_dark_theme(root)
        self._build_menu_bar()
        self._build_toolbar()
        self._build_central_area()
        self._build_console()
        self._build_status_bar()
        self._connect_signals()
        self._init_demo()

    def _build_menu_bar(self):
        menubar = Menu(self.root, bg=BG_SURFACE, fg=TEXT, activebackground=ACCENT,
                       activeforeground="white", border=0, font=("Segoe UI", 11))
        self.root.config(menu=menubar)

        file_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                         activebackground=ACCENT, activeforeground="white",
                         borderwidth=0, font=("Segoe UI", 11))
        file_menu.add_command(label="New Mission", command=self._on_new_mission)
        file_menu.add_command(label="Open Mission...", command=self._on_open_mission)
        file_menu.add_command(label="Save Mission", command=self._on_save_mission)
        file_menu.add_command(label="Save Mission As...", command=self._on_save_mission_as)
        file_menu.add_separator()
        file_menu.add_command(label="Export Log...", command=self._on_export_log)
        file_menu.add_separator()
        file_menu.add_command(label="Exit", command=self.root.quit)
        menubar.add_cascade(label="File", menu=file_menu)

        conn_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                         activebackground=ACCENT, activeforeground="white",
                         borderwidth=0, font=("Segoe UI", 11))
        conn_menu.add_command(label="Serial Port...", command=self._on_serial_connect)
        conn_menu.add_command(label="TCP Client...", command=self._on_tcp_connect)
        conn_menu.add_command(label="TCP Server...", command=self._on_tcp_server)
        conn_menu.add_command(label="UDP...", command=self._on_udp_connect)
        conn_menu.add_separator()
        conn_menu.add_command(label="Disconnect", command=self._on_disconnect)
        menubar.add_cascade(label="Connect", menu=conn_menu)

        flight_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                           activebackground=ACCENT, activeforeground="white",
                           borderwidth=0, font=("Segoe UI", 11))
        flight_menu.add_command(label="Mission Planner", command=self._on_mission_planner)
        flight_menu.add_command(label="Geo-Fence Editor", command=self._on_geo_fence)
        flight_menu.add_command(label="Rally Points", command=self._on_rally_points)
        menubar.add_cascade(label="Flight Plan", menu=flight_menu)

        config_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                           activebackground=ACCENT, activeforeground="white",
                           borderwidth=0, font=("Segoe UI", 11))
        config_menu.add_command(label="Vehicle Setup", command=self._on_vehicle_setup)
        config_menu.add_command(label="Parameter Editor", command=self._on_param_editor)
        config_menu.add_command(label="Full Parameter List", command=self._on_full_params)
        config_menu.add_separator()
        config_menu.add_command(label="App Settings...", command=self._on_settings)
        menubar.add_cascade(label="Config", menu=config_menu)

        logs_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                         activebackground=ACCENT, activeforeground="white",
                         borderwidth=0, font=("Segoe UI", 11))
        logs_menu.add_command(label="Telemetry Logs", command=self._on_telemetry_logs)
        logs_menu.add_command(label="DataFlash Logs", command=self._on_dataflash_logs)
        logs_menu.add_separator()
        logs_menu.add_command(label="Console", command=self._toggle_console)
        menubar.add_cascade(label="Logs", menu=logs_menu)

        help_menu = Menu(menubar, tearoff=0, bg=BG_SURFACE, fg=TEXT,
                         activebackground=ACCENT, activeforeground="white",
                         borderwidth=0, font=("Segoe UI", 11))
        help_menu.add_command(label="About SGC", command=self._on_about)
        menubar.add_cascade(label="Help", menu=help_menu)

    def _build_toolbar(self):
        toolbar = tk.Frame(self.root, bg=BG_SURFACE, height=44)
        toolbar.pack(fill=tk.X, padx=0, pady=0)
        toolbar.pack_propagate(False)

        tk.Label(toolbar, text="  Port:", bg=BG_SURFACE, fg=TEXT_MUTED,
                 font=("Segoe UI", 11)).pack(side=tk.LEFT, padx=(12, 4))

        self.port_var = tk.StringVar(value="Auto")
        port_menu = ttk.Combobox(toolbar, textvariable=self.port_var, width=14,
                                 font=("Segoe UI", 11), state="readonly")
        port_menu["values"] = ["Auto", "/dev/ttyACM0", "/dev/ttyUSB0", "COM1", "COM3", "COM5"]
        port_menu.pack(side=tk.LEFT, padx=4)
        theme.style_combobox(port_menu)

        tk.Label(toolbar, text="  Baud:", bg=BG_SURFACE, fg=TEXT_MUTED,
                 font=("Segoe UI", 11)).pack(side=tk.LEFT, padx=(8, 4))

        self.baud_var = tk.StringVar(value="57600")
        baud_menu = ttk.Combobox(toolbar, textvariable=self.baud_var, width=8,
                                 font=("Segoe UI", 11), state="readonly")
        baud_menu["values"] = ["9600", "19200", "38400", "57600", "115200", "921600"]
        baud_menu.pack(side=tk.LEFT, padx=4)
        theme.style_combobox(baud_menu)

        self.connect_btn = tk.Button(toolbar, text="CONNECT", command=self._toggle_connection,
                                     bg=ACCENT, fg="white", font=("Segoe UI", 10, "bold"),
                                     relief=tk.FLAT, padx=20, pady=4, cursor="hand2",
                                     activebackground="#6d28d9", activeforeground="white")
        self.connect_btn.pack(side=tk.LEFT, padx=12)

        tk.Frame(toolbar, width=1, bg=BORDER).pack(side=tk.LEFT, fill=tk.Y, padx=8)

        self.hb_label = tk.Label(toolbar, text="\u25cf Heartbeat: --", bg=BG_SURFACE,
                                 fg=TEXT_MUTED, font=("Segoe UI", 11))
        self.hb_label.pack(side=tk.LEFT, padx=8)

        self.sysid_label = tk.Label(toolbar, text="SysID: --", bg=BG_SURFACE,
                                    fg=TEXT_MUTED, font=("Segoe UI", 11))
        self.sysid_label.pack(side=tk.LEFT, padx=8)

    def _build_central_area(self):
        paned = tk.PanedWindow(self.root, bg=BG_DARK, sashwidth=1, sashrelief=tk.FLAT,
                               sashpad=0, orient=tk.HORIZONTAL)
        paned.pack(fill=tk.BOTH, expand=True)

        self.telemetry = TelemetryPanel(paned)
        paned.add(self.telemetry, width=270, minsize=200)

        center_frame = tk.Frame(paned, bg=BG_DARK)
        self.map_widget = MapWidget(center_frame)
        self.map_widget.pack(fill=tk.BOTH, expand=True)
        paned.add(center_frame, width=900, minsize=400)

        self.flight_actions = FlightModePanel(paned)
        paned.add(self.flight_actions, width=200, minsize=160)

        self._paned = paned

    def _build_console(self):
        self.console = ConsoleWidget(self.root)
        self.console.pack_forget()

    def _build_status_bar(self):
        self.status_bar = StatusBar(self.root)
        self.status_bar.pack(fill=tk.X, side=tk.BOTTOM)

    def _connect_signals(self):
        pass

    def _init_demo(self):
        self.console.log("SGC - Skywin Ground Control Station v0.1.0", "system")
        self.console.log("Ready. Connect to a vehicle to begin.", "info")
        self.console.log("Tip: Use File > Open Mission to load existing missions.", "info")
        self.status_bar.show_message("Ready - connect to a vehicle to begin")

    def _toggle_connection(self):
        if self.app.connected:
            self._on_disconnect()
        else:
            self._on_serial_connect()

    def _on_serial_connect(self):
        port = self.port_var.get()
        baud = self.baud_var.get()
        self.console.log(f"Connecting to {port} at {baud} baud...", "info")
        self.connect_btn.config(state=tk.DISABLED, text="CONNECTING...")
        self.root.after(1500, self._simulate_connect)

    def _simulate_connect(self):
        port = self.port_var.get()
        baud = self.baud_var.get()
        self.app.connected = True
        self.console.log(f"Connected to vehicle on {port} at {baud} baud", "success")
        self.console.log("MAVLink protocol v2.0 | System ID: 1 | Component ID: 1", "mavlink")
        self.console.log("Heartbeat received", "success")

        self.connect_btn.config(text="DISCONNECT", bg=DANGER, activebackground="#dc2626",
                                state=tk.NORMAL)
        self.hb_label.config(text="\u25cf Heartbeat: OK (1 Hz)", fg=SUCCESS)
        self.sysid_label.config(text="SysID: 1 | CompID: 1")
        self._update_all_telemetry()
        self.status_bar.update_status(self.app.vehicle_data)
        self.status_bar.show_message("Connected")

    def _on_disconnect(self):
        if not self.app.connected:
            return
        self.app.connected = False
        self.console.log("Disconnected from vehicle", "warning")
        self.connect_btn.config(text="CONNECT", bg=ACCENT, activebackground="#6d28d9")
        self.hb_label.config(text="\u25cf Heartbeat: --", fg=TEXT_MUTED)
        self.sysid_label.config(text="SysID: --")
        self.status_bar.update_status({"connected": False})
        self.status_bar.show_message("Disconnected")

    def _update_all_telemetry(self):
        self.telemetry.update_data(self.app.vehicle_data)
        self.map_widget.set_vehicle_position(
            self.app.vehicle_data["lat"],
            self.app.vehicle_data["lon"],
            self.app.vehicle_data["heading"],
        )
        self.flight_actions.update_info(self.app.vehicle_data)
        self.status_bar.update_status(self.app.vehicle_data)

    def _on_new_mission(self):
        self.console.log("New mission created", "info")

    def _on_open_mission(self):
        path = filedialog.askopenfilename(title="Open Mission")
        if path:
            self.console.log(f"Loading mission from: {path}", "info")

    def _on_save_mission(self):
        self.console.log("Mission saved", "success")

    def _on_save_mission_as(self):
        path = filedialog.asksaveasfilename(title="Save Mission As")
        if path:
            self.console.log(f"Mission saved to: {path}", "success")

    def _on_export_log(self):
        path = filedialog.asksaveasfilename(title="Export Log")
        if path:
            self.console.log(f"Log exported to: {path}", "success")

    def _on_tcp_connect(self):
        self._show_connection_dialog("TCP Client")

    def _on_tcp_server(self):
        self._show_connection_dialog("TCP Server")

    def _on_udp_connect(self):
        self._show_connection_dialog("UDP")

    def _show_connection_dialog(self, conn_type):
        dialog = tk.Toplevel(self.root)
        dialog.title(f"{conn_type} Connection")
        dialog.configure(bg=BG_SURFACE)
        dialog.geometry("380x220")
        dialog.resizable(False, False)
        dialog.transient(self.root)
        dialog.grab_set()

        frame = tk.Frame(dialog, bg=BG_SURFACE, padx=20, pady=20)
        frame.pack(fill=tk.BOTH, expand=True)

        entries = {}
        row = 0
        if conn_type == "TCP Client":
            for label in ("Address:", "Port:"):
                tk.Label(frame, text=label, bg=BG_SURFACE, fg=TEXT_MUTED,
                         font=("Segoe UI", 11)).grid(row=row, column=0, sticky=tk.W, pady=6)
                e = tk.Entry(frame, bg=BG_INPUT, fg=TEXT, insertbackground=TEXT,
                             relief=tk.FLAT, font=("Segoe UI", 11), bd=8)
                e.grid(row=row, column=1, sticky=tk.EW, pady=6, padx=(8, 0))
                entries[label] = e
                row += 1
            entries["Address:"].insert(0, "127.0.0.1")
            entries["Port:"].insert(0, "5760")
        elif conn_type == "TCP Server":
            tk.Label(frame, text="Port:", bg=BG_SURFACE, fg=TEXT_MUTED,
                     font=("Segoe UI", 11)).grid(row=0, column=0, sticky=tk.W, pady=6)
            e = tk.Entry(frame, bg=BG_INPUT, fg=TEXT, insertbackground=TEXT,
                         relief=tk.FLAT, font=("Segoe UI", 11), bd=8)
            e.grid(row=0, column=1, sticky=tk.EW, pady=6, padx=(8, 0))
            e.insert(0, "5760")
        elif conn_type == "UDP":
            for label in ("Local Port:", "Target IP:", "Target Port:"):
                tk.Label(frame, text=label, bg=BG_SURFACE, fg=TEXT_MUTED,
                         font=("Segoe UI", 11)).grid(row=row, column=0, sticky=tk.W, pady=6)
                e = tk.Entry(frame, bg=BG_INPUT, fg=TEXT, insertbackground=TEXT,
                             relief=tk.FLAT, font=("Segoe UI", 11), bd=8)
                e.grid(row=row, column=1, sticky=tk.EW, pady=6, padx=(8, 0))
                entries[label] = e
                row += 1
            entries["Local Port:"].insert(0, "14550")
            entries["Target IP:"].insert(0, "127.0.0.1")
            entries["Target Port:"].insert(0, "14550")

        frame.columnconfigure(1, weight=1)

        btn_frame = tk.Frame(dialog, bg=BG_SURFACE)
        btn_frame.pack(fill=tk.X, padx=20, pady=(0, 20))

        def on_connect():
            self.console.log(f"{conn_type} connection initiated...", "info")
            dialog.destroy()

        tk.Button(btn_frame, text="Connect", command=on_connect,
                  bg=ACCENT, fg="white", font=("Segoe UI", 10, "bold"),
                  relief=tk.FLAT, padx=20, pady=4, cursor="hand2").pack(side=tk.RIGHT)
        tk.Button(btn_frame, text="Cancel", command=dialog.destroy,
                  bg=BORDER, fg=TEXT, font=("Segoe UI", 10),
                  relief=tk.FLAT, padx=20, pady=4, cursor="hand2").pack(side=tk.RIGHT, padx=(0, 8))

    def _on_mission_planner(self):
        self.console.log("Mission Planner opened", "info")

    def _on_geo_fence(self):
        self.console.log("Geo-Fence Editor opened", "info")

    def _on_rally_points(self):
        self.console.log("Rally Points editor opened", "info")

    def _on_vehicle_setup(self):
        self.console.log("Vehicle Setup opened", "info")

    def _on_param_editor(self):
        self.console.log("Parameter Editor opened", "info")

    def _on_full_params(self):
        self.console.log("Full Parameter List opened", "info")

    def _on_settings(self):
        self.console.log("Settings dialog opened", "info")

    def _on_telemetry_logs(self):
        self.console.log("Telemetry Logs browser opened", "info")

    def _on_dataflash_logs(self):
        self.console.log("DataFlash Logs browser opened", "info")

    def _toggle_console(self):
        self.console_visible = not self.console_visible
        if self.console_visible:
            self.console.pack(fill=tk.BOTH, before=self.status_bar)
        else:
            self.console.pack_forget()

    def _on_about(self):
        messagebox.showinfo("About SGC",
            "SGC v0.1.0\n"
            "Skywin Ground Control Station\n\n"
            "A professional MAVLink ground control station\n"
            "built with Python & tkinter.\n\n"
            "Compatible with ArduPilot and PX4 autopilots.")
