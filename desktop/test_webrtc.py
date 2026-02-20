#!/usr/bin/env python3
"""Quick test: does webkit2gtk expose RTCPeerConnection when enable-webrtc is set?"""
import gi
gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

win = Gtk.Window(title="WebRTC Test")
win.set_default_size(600, 400)
win.connect("destroy", Gtk.main_quit)

wv = WebKit2.WebView()
settings = wv.get_settings()
settings.set_enable_media_stream(True)
settings.set_enable_webrtc(True)
print(f"[py] enable_webrtc = {settings.get_enable_webrtc()}")

# When the page finishes loading, run a JS check
def on_load(wv, event):
    if event == WebKit2.LoadEvent.FINISHED:
        wv.evaluate_javascript(
            "document.title = typeof RTCPeerConnection",
            -1, None, None, None,
            lambda wv, res: print(f"[py] RTCPeerConnection type: {wv.get_title()}")
        )

wv.connect("load-changed", on_load)
wv.load_html("<html><body><h2>Checking RTCPeerConnection...</h2></body></html>", "https://localhost/")

win.add(wv)
win.show_all()

# Auto-quit after 3 seconds
GLib.timeout_add_seconds(3, Gtk.main_quit)
Gtk.main()
