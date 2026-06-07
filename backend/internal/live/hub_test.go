package live

import (
	"net/http/httptest"
	"testing"
)

func TestWebsocketOriginAllowed(t *testing.T) {
	allowedHosts := allowedOriginHosts([]string{"http://routes.canadaverse.org"})

	tests := []struct {
		name   string
		host   string
		origin string
		want   bool
	}{
		{name: "same public host", host: "routes.canadaverse.org", origin: "http://routes.canadaverse.org", want: true},
		{name: "configured public origin through localhost proxy", host: "localhost:39476", origin: "http://routes.canadaverse.org", want: true},
		{name: "same local host", host: "localhost:39476", origin: "http://localhost:39476", want: true},
		{name: "local hostnames may differ", host: "127.0.0.1:39476", origin: "http://localhost:39476", want: true},
		{name: "missing origin", host: "localhost:39476", origin: "", want: false},
		{name: "foreign origin rejected", host: "localhost:39476", origin: "https://example.com", want: false},
		{name: "bad origin rejected", host: "localhost:39476", origin: "://bad", want: false},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			request := httptest.NewRequest("GET", "http://"+tt.host+"/ws/public", nil)
			request.Host = tt.host
			if tt.origin != "" {
				request.Header.Set("Origin", tt.origin)
			}
			if got := websocketOriginAllowed(request, allowedHosts); got != tt.want {
				t.Fatalf("websocketOriginAllowed() = %t, want %t", got, tt.want)
			}
		})
	}
}
