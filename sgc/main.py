import threading
import sys
from sgc.server import app, socketio


def _run_server():
    socketio.run(app, host="127.0.0.1", port=5050, debug=False, allow_unsafe_werkzeug=True)


def main():
    server_thread = threading.Thread(target=_run_server, daemon=True)
    server_thread.start()

    import webview

    window = webview.create_window(
        title="SGC - Skywin Ground Control Station",
        url="http://127.0.0.1:5050",
        width=1400,
        height=900,
        resizable=True,
        min_size=(1024, 600),
        text_select=True,
    )

    webview.start(gui="cef" if sys.platform == "linux" else None)


if __name__ == "__main__":
    main()
