package mqtt

import (
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

func TestForceReconnectReplacesPahoClient(t *testing.T) {
	client := NewClient(ClientConfig{
		Enabled:   true,
		BrokerURL: "wss://mqtt.example.test:443/mqtt",
		Topic:     "meshcore/#",
		ClientID:  "test-client",
	}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)

	var (
		mu      sync.Mutex
		clients []*fakePahoClient
	)
	client.newPahoClient = func(*paho.ClientOptions) paho.Client {
		mu.Lock()
		defer mu.Unlock()
		next := &fakePahoClient{token: completeToken{}}
		clients = append(clients, next)
		return next
	}

	client.client = client.buildPahoClient()
	client.connected.Store(true)
	client.forceReconnect()

	mu.Lock()
	defer mu.Unlock()
	if len(clients) != 2 {
		t.Fatalf("created %d paho clients, want 2", len(clients))
	}
	if clients[0].disconnects != 1 {
		t.Fatalf("old client disconnects = %d, want 1", clients[0].disconnects)
	}
	if clients[1].connects != 1 {
		t.Fatalf("new client connects = %d, want 1", clients[1].connects)
	}
	if client.Connected() {
		t.Fatal("client should report disconnected until the replacement OnConnect handler fires")
	}
	if client.Status(time.Now()).LastConnectionLostAt == 0 {
		t.Fatal("expected forced reconnect to record a connection-lost timestamp")
	}
}

type fakePahoClient struct {
	token       paho.Token
	connects    int
	disconnects int
}

func (f *fakePahoClient) IsConnected() bool {
	return false
}

func (f *fakePahoClient) IsConnectionOpen() bool {
	return false
}

func (f *fakePahoClient) Connect() paho.Token {
	f.connects++
	return f.token
}

func (f *fakePahoClient) Disconnect(uint) {
	f.disconnects++
}

func (f *fakePahoClient) Publish(string, byte, bool, interface{}) paho.Token {
	return f.token
}

func (f *fakePahoClient) Subscribe(string, byte, paho.MessageHandler) paho.Token {
	return f.token
}

func (f *fakePahoClient) SubscribeMultiple(map[string]byte, paho.MessageHandler) paho.Token {
	return f.token
}

func (f *fakePahoClient) Unsubscribe(...string) paho.Token {
	return f.token
}

func (f *fakePahoClient) AddRoute(string, paho.MessageHandler) {
}

func (f *fakePahoClient) OptionsReader() paho.ClientOptionsReader {
	return paho.ClientOptionsReader{}
}

type completeToken struct{}

func (completeToken) Wait() bool {
	return true
}

func (completeToken) WaitTimeout(time.Duration) bool {
	return true
}

func (completeToken) Done() <-chan struct{} {
	ch := make(chan struct{})
	close(ch)
	return ch
}

func (completeToken) Error() error {
	return nil
}
