package mqtt

import (
	"context"
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

func TestOnMessageAssignsIngestIDBeforeQueue(t *testing.T) {
	client := NewClient(ClientConfig{QueueSize: 2}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	client.onMessage()(nil, fakeMessage{topic: "meshcore/YYZ/ABCDEF012345/packets", payload: []byte(`{"raw":"0102"}`)})
	select {
	case queued := <-client.queue:
		if queued.message.IngestID == "" {
			t.Fatal("queued normalized message has empty ingest ID")
		}
	default:
		t.Fatal("normalized message was not queued")
	}
}

func TestQueueStatusTracksAcceptedProcessedAndOldest(t *testing.T) {
	processed := make(chan struct{}, 1)
	client := NewClient(ClientConfig{QueueSize: 2}, slog.New(slog.NewTextHandler(io.Discard, nil)), func(context.Context, NormalizedMessage) {
		processed <- struct{}{}
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go client.dispatch(ctx)
	client.onMessage()(nil, fakeMessage{topic: "meshcore/YYZ/ABCDEF012345/packets", payload: []byte(`{"raw":"0102"}`)})
	select {
	case <-processed:
	case <-time.After(time.Second):
		t.Fatal("message was not processed")
	}
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		status := client.Status(time.Now())
		if status.ProcessedMessages == 1 {
			if status.AcceptedMessages != 1 || status.DroppedMessages != 0 || status.QueueDepth != 0 || status.OldestQueueItemAgeMs != 0 {
				t.Fatalf("queue status=%#v", status)
			}
			return
		}
		time.Sleep(time.Millisecond)
	}
	t.Fatal("processed counter did not advance")
}

func TestDisabledClientDispatchesSubmittedNormalizedFixture(t *testing.T) {
	processed := make(chan NormalizedMessage, 1)
	client := NewClient(ClientConfig{Enabled: false, QueueSize: 2}, slog.New(slog.NewTextHandler(io.Discard, nil)), func(_ context.Context, msg NormalizedMessage) {
		processed <- msg
	})
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := client.Start(ctx); err != nil {
		t.Fatal(err)
	}
	msg, err := Normalize("meshcore/YYZ/ABCDEF012345/packets", []byte(`{"raw":"0102"}`), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if !client.SubmitNormalized(msg) {
		t.Fatal("fixture message was not accepted")
	}
	select {
	case got := <-processed:
		if got.IngestID == "" {
			t.Fatal("submitted fixture message has empty ingest ID")
		}
	case <-time.After(time.Second):
		t.Fatal("disabled client did not dispatch submitted fixture message")
	}
}

func TestQueueOldestTracksCurrentFIFOHead(t *testing.T) {
	client := NewClient(ClientConfig{QueueSize: 4}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	client.queueAgeMu.Lock()
	client.queueTimes = append(client.queueTimes, 100, 200)
	if got := client.queueOldestLocked(); got != 100 {
		t.Fatalf("oldest=%d want 100", got)
	}
	client.popQueueTimestampLocked()
	if got := client.queueOldestLocked(); got != 200 {
		t.Fatalf("oldest after pop=%d want 200", got)
	}
	client.queueAgeMu.Unlock()
}

type fakeMessage struct {
	topic   string
	payload []byte
}

func (f fakeMessage) Duplicate() bool   { return false }
func (f fakeMessage) Qos() byte         { return 0 }
func (f fakeMessage) Retained() bool    { return false }
func (f fakeMessage) Topic() string     { return f.topic }
func (f fakeMessage) MessageID() uint16 { return 1 }
func (f fakeMessage) Payload() []byte   { return f.payload }
func (f fakeMessage) Ack()              {}

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
