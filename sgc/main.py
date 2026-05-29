import webbrowser
import threading
from sgc.server import app, socketio


def main():
    port = 5050
    url = f"http://127.0.0.1:{port}"

    threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    print(f"  SGC - Skywin Ground Control Station")
    print(f"  ─────────────────────────────────────")
    print(f"  Server:  {url}")
    print(f"  Close the terminal or press Ctrl+C to stop.\n")

    socketio.run(app, host="127.0.0.1", port=port, debug=False, allow_unsafe_werkzeug=True)


if __name__ == "__main__":
    main()
