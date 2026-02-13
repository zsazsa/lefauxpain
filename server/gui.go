//go:build desktop

package main

/*
#cgo linux pkg-config: gtk+-3.0 webkit2gtk-4.1

#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

static gboolean on_permission_request(WebKitWebView* web_view,
	WebKitPermissionRequest* request, gpointer user_data) {
	webkit_permission_request_allow(request);
	return TRUE;
}

static void on_web_process_crashed(WebKitWebView* web_view, gpointer user_data) {
	g_printerr("WebKit web process crashed, reloading...\n");
	webkit_web_view_reload(web_view);
}

static void run_gui(const char* title, const char* url, int width, int height) {
	gtk_init(NULL, NULL);
	GtkWidget* window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
	gtk_window_set_title(GTK_WINDOW(window), title);
	gtk_window_set_default_size(GTK_WINDOW(window), width, height);
	g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

	// Disable web process sandbox to avoid silent crashes
	WebKitWebContext* context = webkit_web_context_get_default();
	webkit_web_context_set_sandbox_enabled(context, FALSE);

	WebKitWebView* webview = WEBKIT_WEB_VIEW(webkit_web_view_new());

	// Enable media device access
	WebKitSettings* settings = webkit_web_view_get_settings(webview);
	webkit_settings_set_enable_media_stream(settings, TRUE);
	webkit_settings_set_enable_mediasource(settings, TRUE);

	// Auto-grant permission requests (microphone, etc.)
	g_signal_connect(webview, "permission-request",
		G_CALLBACK(on_permission_request), NULL);

	// Handle web process crashes
	g_signal_connect(webview, "web-process-crashed",
		G_CALLBACK(on_web_process_crashed), NULL);

	gtk_container_add(GTK_CONTAINER(window), GTK_WIDGET(webview));
	webkit_web_view_load_uri(webview, url);

	gtk_widget_show_all(window);
	gtk_main();
}
*/
import "C"

import "unsafe"

const guiMode = true

func runGUI(addr string) {
	title := C.CString("Le Faux Pain")
	defer C.free(unsafe.Pointer(title))
	url := C.CString("http://localhost" + addr)
	defer C.free(unsafe.Pointer(url))
	C.run_gui(title, url, 1200, 800)
}

func runGUIRemote(remoteURL string) {
	title := C.CString("Le Faux Pain")
	defer C.free(unsafe.Pointer(title))
	url := C.CString(remoteURL)
	defer C.free(unsafe.Pointer(url))
	C.run_gui(title, url, 1200, 800)
}
