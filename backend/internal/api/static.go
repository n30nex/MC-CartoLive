package api

import (
	"embed"
	"io/fs"
	"net/http"
	"path"
	"strings"
)

//go:embed static
var staticFS embed.FS

func StaticReady() bool {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		return false
	}
	if _, err := fs.Stat(sub, "index.html"); err == nil {
		return true
	}
	_, err = fs.Stat(sub, "placeholder.txt")
	return err == nil
}

func StaticWarn() string {
	if StaticReady() {
		return ""
	}
	return "static files unavailable; frontend will not be served"
}

func StaticHandler(w http.ResponseWriter, r *http.Request) {
	sub, err := fs.Sub(staticFS, "static")
	if err != nil {
		http.Error(w, "static files unavailable", http.StatusInternalServerError)
		return
	}
	requestPath := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if strings.HasPrefix(requestPath, "api/") || requestPath == "ws" || strings.HasPrefix(requestPath, "ws/") {
		http.NotFound(w, r)
		return
	}
	if requestPath == "." || requestPath == "" {
		requestPath = "index.html"
	}
	if _, err := fs.Stat(sub, requestPath); err != nil {
		requestPath = "index.html"
	}
	if strings.HasPrefix(requestPath, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	} else if requestPath == "index.html" {
		w.Header().Set("Cache-Control", "no-store, max-age=0")
	}
	http.ServeFileFS(w, r, sub, requestPath)
}
