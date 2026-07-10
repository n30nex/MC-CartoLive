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
	info, err := fs.Stat(sub, "index.html")
	return err == nil && !info.IsDir() && info.Size() > 0
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
	if cacheControl, revalidate := staticCachePolicy(requestPath); cacheControl != "" {
		w.Header().Set("Cache-Control", cacheControl)
		if revalidate {
			w.Header().Set("Expires", "0")
			w.Header().Set("Pragma", "no-cache")
		}
	}
	http.ServeFileFS(w, r, sub, requestPath)
}

func staticCachePolicy(requestPath string) (cacheControl string, revalidate bool) {
	requestPath = strings.ToLower(strings.TrimSpace(requestPath))
	switch requestPath {
	case "sw.js", "service-worker.js", "manifest.webmanifest", "manifest.json", "site.webmanifest":
		return "no-cache, no-store, max-age=0, must-revalidate", true
	case "index.html":
		return "no-store, max-age=0, must-revalidate", true
	}
	if strings.HasPrefix(requestPath, "assets/") {
		return "public, max-age=31536000, immutable", false
	}
	return "", false
}
