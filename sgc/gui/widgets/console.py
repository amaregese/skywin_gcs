import tkinter as tk
from tkinter import ttk
from sgc.gui import theme

LEVEL_COLORS = {
    "info": "#94a3b8",
    "success": "#22c55e",
    "warning": "#eab308",
    "error": "#ef4444",
    "debug": "#64748b",
    "mavlink": "#0ea5e9",
    "system": "#7c3aed",
}


class ConsoleWidget(tk.Frame):
    def __init__(self, parent):
        super().__init__(parent, bg=theme.BG_SURFACE, bd=0, highlightthickness=0)

        header = tk.Frame(self, bg=theme.BG_DARK, height=28)
        header.pack(fill=tk.X)
        header.pack_propagate(False)
        tk.Label(header, text="  CONSOLE", bg=theme.BG_DARK, fg=theme.ACCENT,
                 font=("Segoe UI", 9, "bold")).pack(anchor=tk.W)

        text_frame = tk.Frame(self, bg=theme.BG_DARK)
        text_frame.pack(fill=tk.BOTH, expand=True)

        self.text = tk.Text(text_frame, bg=theme.BG_DARK, fg=theme.TEXT_MUTED,
                            font=("JetBrains Mono", 11), bd=0, padx=8, pady=4,
                            highlightthickness=0, wrap=tk.WORD,
                            state=tk.DISABLED, spacing1=1, spacing2=0, spacing3=1)
        self.text.pack(side=tk.LEFT, fill=tk.BOTH, expand=True)

        scrollbar = tk.Scrollbar(text_frame, command=self.text.yview,
                                 bg=theme.BG_SURFACE, troughcolor=theme.BG_DARK,
                                 bd=0, activebackground=theme.BORDER, elementborderwidth=0)
        scrollbar.pack(side=tk.RIGHT, fill=tk.Y)
        self.text.configure(yscrollcommand=scrollbar.set)

        self.text.tag_configure("info", foreground="#94a3b8")
        self.text.tag_configure("success", foreground="#22c55e")
        self.text.tag_configure("warning", foreground="#eab308")
        self.text.tag_configure("error", foreground="#ef4444")
        self.text.tag_configure("debug", foreground="#64748b")
        self.text.tag_configure("mavlink", foreground="#0ea5e9")
        self.text.tag_configure("system", foreground="#7c3aed", font=("Segoe UI", 11, "bold"))

    def log(self, message, level="info"):
        tag = level if level in LEVEL_COLORS else "info"
        self.text.configure(state=tk.NORMAL)
        self.text.insert(tk.END, message + "\n", tag)
        self.text.see(tk.END)
        self.text.configure(state=tk.DISABLED)

    def clear(self):
        self.text.configure(state=tk.NORMAL)
        self.text.delete("1.0", tk.END)
        self.text.configure(state=tk.DISABLED)
