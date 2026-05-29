import tkinter as tk
from tkinter import ttk

BG_DARK = "#0f172a"
BG_SURFACE = "#1e293b"
BG_INPUT = "#0f172a"
BORDER = "#334155"
ACCENT = "#7c3aed"
ACCENT_HOVER = "#6d28d9"
TEXT = "#e2e8f0"
TEXT_MUTED = "#94a3b8"
SUCCESS = "#22c55e"
DANGER = "#ef4444"
WARNING = "#eab308"
INFO = "#0ea5e9"


def apply_dark_theme(root):
    style = ttk.Style(root)
    style.theme_use("clam")

    style.configure(".",
        background=BG_DARK,
        foreground=TEXT,
        fieldbackground=BG_INPUT,
        troughcolor=BG_SURFACE,
        selectbackground=ACCENT,
        selectforeground="white",
        borderwidth=0,
        focuscolor="none",
        font=("Segoe UI", 11),
    )

    style.configure("TFrame", background=BG_DARK)
    style.configure("TLabel", background=BG_DARK, foreground=TEXT, font=("Segoe UI", 11))
    style.configure("TLabelframe", background=BG_DARK, foreground=TEXT, bordercolor=BORDER,
                    borderwidth=1, relief="solid")
    style.configure("TLabelframe.Label", background=BG_DARK, foreground=ACCENT,
                    font=("Segoe UI", 9, "bold"))

    style.configure("TCombobox",
        background=BG_INPUT,
        foreground=TEXT,
        fieldbackground=BG_INPUT,
        arrowcolor=TEXT_MUTED,
        borderwidth=0,
        focuscolor="none",
    )
    style.map("TCombobox",
        fieldbackground=[("readonly", BG_INPUT)],
        foreground=[("readonly", TEXT)],
    )

    style.configure("Vertical.TScrollbar",
        background=BG_SURFACE,
        bordercolor=BG_DARK,
        arrowcolor=TEXT_MUTED,
        troughcolor=BG_DARK,
    )


def style_combobox(widget):
    widget.configure(style="TCombobox")
    widget.master.configure(bg=BG_SURFACE)
    try:
        widget.tk.eval(f"""
            ttk::style layout TCombobox {{
                Combobox.field -sticky nswe -children {{
                    Combobox.downarrow -side right -sticky ns
                    Combobox.padding -sticky nswe -children {{
                        Combobox.textarea -sticky nswe
                    }}
                }}
            }}
        """)
    except tk.TclError:
        pass
