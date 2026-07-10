package api

import "testing"

func TestStaticReadyRequiresRealIndex(t *testing.T) {
	if StaticReady() {
		t.Fatal("placeholder-only embedded filesystem must not be production ready")
	}
}
func TestStaticCachePolicyRevalidatesWorkerAndManifest(t *testing.T) {
	for _, name := range []string{"sw.js", "service-worker.js", "manifest.webmanifest", "manifest.json", "brand/world/manifest.json"} {
		control, revalidate := staticCachePolicy(name)
		if control != "no-cache, no-store, max-age=0, must-revalidate" || !revalidate {
			t.Fatalf("staticCachePolicy(%q)=(%q,%v)", name, control, revalidate)
		}
	}
	control, revalidate := staticCachePolicy("assets/app.ABC123.js")
	if control != "public, max-age=31536000, immutable" || revalidate {
		t.Fatalf("asset cache policy=(%q,%v)", control, revalidate)
	}
}
