package tests

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	imqtt "meshcore-canada-live-map/backend/internal/mqtt"
	"meshcore-canada-live-map/backend/internal/resolve"
	"meshcore-canada-live-map/backend/internal/store"
)

func TestPublicChatEndpointReturnsSanitizedRoutedAndObserverMessages(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "AA00000000000000000000000000000000000000000000000000000000000000"
	if err := st.ApplyManualNode(ctx, observerKey, "YYZ Observer", 43.65, -79.38, "test"); err != nil {
		t.Fatal(err)
	}
	base := time.Now().Add(-time.Hour).UnixMilli()
	insertChatObservation(t, ctx, st, "hash-chat-observer-private", "YYZ", observerKey, base+1_000, resolve.StatusNoPath, chatObservationOptions{
		MessageSender: "ObserverBot",
		MessageText:   "observer hello",
	})
	routedID := insertChatObservation(t, ctx, st, "hash-chat-routed-private", "YYZ", observerKey, base+2_000, resolve.StatusHigh, chatObservationOptions{
		MessageSender: "Corebot",
		MessageText:   "routed hello",
	})
	insertHistoryEdgeWithOptions(t, ctx, st, routedID, "hash-chat-routed-private", base+2_000, historyEdgeOptions{
		PayloadTypeName: "PLAIN_TEXT",
		MessageSender:   "Corebot",
		MessageText:     "routed hello",
		Labels:          []string{"YYZ Sender", "Krabs Repeater"},
	})
	disallowedID := insertChatObservation(t, ctx, st, "hash-chat-prg-private", "PRG", observerKey, base+2_500, resolve.StatusHigh, chatObservationOptions{
		MessageSender: "Prague",
		MessageText:   "not allowed",
	})
	insertHistoryEdgeWithOptions(t, ctx, st, disallowedID, "hash-chat-prg-private", base+2_500, historyEdgeOptions{
		MessageSender: "Prague",
		MessageText:   "not allowed",
		Labels:        []string{"PRG Sender", "PRG Relay"},
	})

	server := publicHistoryTestServer(st, func(iata string) bool { return strings.ToUpper(iata) == "YYZ" })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/chat?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("chat status = %d body=%s", response.Code, response.Body.String())
	}
	var chat live.PublicChatResponse
	if err := json.Unmarshal(response.Body.Bytes(), &chat); err != nil {
		t.Fatal(err)
	}
	if got, want := len(chat.Messages), 2; got != want {
		t.Fatalf("messages = %d, want %d: %#v", got, want, chat.Messages)
	}
	routed := chat.Messages[0]
	if routed.At != base+2_000 || routed.Source != "routed" || routed.ChannelLabel != "Public" || routed.Text != "routed hello" {
		t.Fatalf("routed message = %#v, want newest public routed chat", routed)
	}
	if len(routed.RouteIDs) == 0 || len(routed.EndpointLabels) != 2 || routed.Anchor == nil {
		t.Fatalf("routed message route metadata = %#v, want public route ids, labels, and anchor", routed)
	}
	observer := chat.Messages[1]
	if observer.At != base+1_000 || observer.Source != "observer" || observer.Text != "observer hello" || observer.Anchor == nil {
		t.Fatalf("observer message = %#v, want observer-only message with public anchor", observer)
	}

	raw := response.Body.String()
	for _, forbidden := range []string{
		"packetHash",
		"observerPublicKey",
		"pathHex",
		"payloadHex",
		"rawJson",
		"resolutionReason",
		observerKey,
		observerKey[:8],
		"hash-chat-observer-private",
		"hash-chat-routed-private",
		"hash-chat-prg-private",
		"secret summary",
		"broker-private",
	} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("chat response leaked forbidden value %q: %s", forbidden, raw)
		}
	}
	if strings.Contains(raw, "PRG") || strings.Contains(raw, "not allowed") {
		t.Fatalf("chat response included disallowed message: %s", raw)
	}
}

func TestPublicChatEndpointFiltersPublicMessageFields(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "BB00000000000000000000000000000000000000000000000000000000000000"
	base := time.Now().Add(-time.Hour).UnixMilli()
	publicID := insertChatObservation(t, ctx, st, "hash-chat-public-filter-private", "YKF", observerKey, base+1_000, resolve.StatusHigh, chatObservationOptions{
		MessageSender: "CafeBot",
		MessageText:   "coffee at the ramp",
	})
	insertHistoryEdgeWithOptions(t, ctx, st, publicID, "hash-chat-public-filter-private", base+1_000, historyEdgeOptions{
		PayloadTypeName: "PLAIN_TEXT",
		MessageSender:   "CafeBot",
		MessageText:     "coffee at the ramp",
		Labels:          []string{"YKF Sender", "Krabs Repeater"},
	})
	advertID := insertChatObservation(t, ctx, st, "hash-chat-advert-filter-private", "YTR", observerKey, base+2_000, resolve.StatusHigh, chatObservationOptions{
		PayloadType:   meshcore.PayloadAdvert,
		MessageSender: "NoticeBot",
		MessageText:   "maintenance notice",
	})
	insertHistoryEdgeWithOptions(t, ctx, st, advertID, "hash-chat-advert-filter-private", base+2_000, historyEdgeOptions{
		PayloadTypeName: "ADVERT",
		MessageSender:   "NoticeBot",
		MessageText:     "maintenance notice",
		Labels:          []string{"YTR Sender", "YTR Relay"},
	})

	server := publicHistoryTestServer(st, func(string) bool { return true })
	tests := []struct {
		name string
		url  string
		want string
	}{
		{"iata", "/api/v1/public/chat?from=" + ms(base) + "&to=" + ms(base+3_000) + "&iata=ytr&limit=10", "YTR"},
		{"region", "/api/v1/public/chat?from=" + ms(base) + "&to=" + ms(base+3_000) + "&region=ykf&limit=10", "YKF"},
		{"public channel label", "/api/v1/public/chat?from=" + ms(base) + "&to=" + ms(base+3_000) + "&channel=public&limit=10", "YKF"},
		{"payload channel fallback", "/api/v1/public/chat?from=" + ms(base) + "&to=" + ms(base+3_000) + "&channel=advert&limit=10", "YTR"},
		{"public query", "/api/v1/public/chat?from=" + ms(base) + "&to=" + ms(base+3_000) + "&q=krabs&limit=10", "YKF"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			response := httptest.NewRecorder()
			request := httptest.NewRequest(http.MethodGet, tt.url, nil)
			server.Routes().ServeHTTP(response, request)
			if response.Code != http.StatusOK {
				t.Fatalf("chat status = %d body=%s", response.Code, response.Body.String())
			}
			var chat live.PublicChatResponse
			if err := json.Unmarshal(response.Body.Bytes(), &chat); err != nil {
				t.Fatal(err)
			}
			if len(chat.Messages) != 1 || chat.Messages[0].IATA != tt.want {
				t.Fatalf("messages = %#v, want single %s match", chat.Messages, tt.want)
			}
			raw := response.Body.String()
			if strings.Contains(raw, "hash-chat") || strings.Contains(raw, "broker-private") {
				t.Fatalf("filtered chat response leaked private data: %s", raw)
			}
		})
	}
}

func TestPublicChatEndpointRedactsSensitiveMessageSubstrings(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "DD00000000000000000000000000000000000000000000000000000000000000"
	fullKey := strings.Repeat("AA12", 16)
	rawPath := "0a:1b:2c:3d:4e:5f:6a"
	base := time.Now().Add(-time.Hour).UnixMilli()
	insertChatObservation(t, ctx, st, "hash-chat-sensitive-private", "YYZ", observerKey, base+1_000, resolve.StatusNoPath, chatObservationOptions{
		MessageSender: "sender token=" + fullKey,
		MessageText:   "hello key=" + fullKey + " path " + rawPath + " hash=" + fullKey,
	})

	server := publicHistoryTestServer(st, func(string) bool { return true })
	response := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/api/v1/public/chat?from="+ms(base)+"&to="+ms(base+2_000)+"&limit=10", nil)
	server.Routes().ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("chat status = %d body=%s", response.Code, response.Body.String())
	}
	var chat live.PublicChatResponse
	if err := json.Unmarshal(response.Body.Bytes(), &chat); err != nil {
		t.Fatal(err)
	}
	if len(chat.Messages) != 1 {
		t.Fatalf("messages = %#v, want one redacted message", chat.Messages)
	}
	message := chat.Messages[0]
	if !strings.Contains(message.Text, "[redacted]") || !strings.Contains(message.Text, "[redacted path]") {
		t.Fatalf("message text = %q, want redacted sensitive substrings", message.Text)
	}
	if strings.Contains(message.Sender, fullKey) || strings.Contains(message.Text, fullKey) || strings.Contains(message.Text, rawPath) {
		t.Fatalf("chat message leaked sensitive substrings: %#v", message)
	}
	raw := response.Body.String()
	for _, forbidden := range []string{fullKey, rawPath, "token=", "hash=", "key="} {
		if strings.Contains(raw, forbidden) {
			t.Fatalf("chat response leaked forbidden substring %q: %s", forbidden, raw)
		}
	}
}

func TestPublicChatEndpointReturnsNewestFirstWithStableCursorAndWindow(t *testing.T) {
	ctx := context.Background()
	st, err := store.OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Fatalf("close store: %v", err)
		}
	})

	observerKey := "CC00000000000000000000000000000000000000000000000000000000000000"
	base := time.Now().Add(-time.Hour).UnixMilli()
	insertChatObservation(t, ctx, st, "hash-chat-cursor-old-private", "YYZ", observerKey, base+1_000, resolve.StatusNoPath, chatObservationOptions{
		MessageText: "old message",
	})
	insertChatObservation(t, ctx, st, "hash-chat-cursor-new-private", "YYZ", observerKey, base+2_000, resolve.StatusNoPath, chatObservationOptions{
		MessageText: "new message",
	})

	server := publicHistoryTestServer(st, func(string) bool { return true })
	firstPage := httptest.NewRecorder()
	firstRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/chat?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1", nil)
	server.Routes().ServeHTTP(firstPage, firstRequest)
	if firstPage.Code != http.StatusOK {
		t.Fatalf("first cursor page status = %d body=%s", firstPage.Code, firstPage.Body.String())
	}
	var page1 live.PublicChatResponse
	if err := json.Unmarshal(firstPage.Body.Bytes(), &page1); err != nil {
		t.Fatal(err)
	}
	if len(page1.Messages) != 1 || page1.Messages[0].Text != "new message" || page1.NextCursor == "" {
		t.Fatalf("first page = %#v, want newest message plus cursor", page1)
	}

	secondPage := httptest.NewRecorder()
	secondRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/chat?from="+ms(base)+"&to="+ms(base+3_000)+"&limit=1&cursor="+page1.NextCursor, nil)
	server.Routes().ServeHTTP(secondPage, secondRequest)
	if secondPage.Code != http.StatusOK {
		t.Fatalf("second cursor page status = %d body=%s", secondPage.Code, secondPage.Body.String())
	}
	var page2 live.PublicChatResponse
	if err := json.Unmarshal(secondPage.Body.Bytes(), &page2); err != nil {
		t.Fatal(err)
	}
	if len(page2.Messages) != 1 || page2.Messages[0].Text != "old message" {
		t.Fatalf("second page = %#v, want next older message", page2)
	}

	cappedWindow := httptest.NewRecorder()
	now := time.Now().UnixMilli()
	cappedRequest := httptest.NewRequest(http.MethodGet, "/api/v1/public/chat?from="+ms(now-48*60*60_000)+"&to="+ms(now)+"&limit=9999", nil)
	server.Routes().ServeHTTP(cappedWindow, cappedRequest)
	if cappedWindow.Code != http.StatusOK {
		t.Fatalf("capped window status = %d body=%s", cappedWindow.Code, cappedWindow.Body.String())
	}
	var capped live.PublicChatResponse
	if err := json.Unmarshal(cappedWindow.Body.Bytes(), &capped); err != nil {
		t.Fatal(err)
	}
	if capped.Window.To-capped.Window.From > 24*60*60_000 {
		t.Fatalf("window = %#v, want capped to 24h", capped.Window)
	}
	if capped.Window.Count > 500 {
		t.Fatalf("window count = %d, want <= 500", capped.Window.Count)
	}
}

type chatObservationOptions struct {
	PayloadType   int
	MessageSender string
	MessageText   string
}

func insertChatObservation(t *testing.T, ctx context.Context, st *store.Store, hash string, iata string, observerKey string, heardAt int64, status string, options chatObservationOptions) int64 {
	t.Helper()
	payloadType := options.PayloadType
	if payloadType == 0 {
		payloadType = meshcore.PayloadPlainText
	}
	parsed := meshcore.ParsedPacket{
		PacketHash:      hash,
		RawHex:          "00",
		RouteTypeName:   "FLOOD",
		PayloadType:     payloadType,
		PayloadTypeName: meshcore.PayloadTypeName(payloadType),
		HashSize:        3,
		HopCount:        1,
		PathBytes:       []byte{0xaa, 0xbb, 0xcc},
		Payload:         []byte{0x01, 0x02},
	}
	if err := st.UpsertPacket(ctx, parsed, heardAt); err != nil {
		t.Fatal(err)
	}
	id, err := st.InsertObservation(ctx, store.ObservationInsert{
		Message: imqtt.NormalizedMessage{
			TopicInfo:    imqtt.TopicInfo{IATA: iata, PublisherPK: observerKey, Subtopic: "packets"},
			ObserverName: "Observer",
			RawJSON:      `{"broker-private":"not public"}`,
			HeardAtMs:    heardAt,
		},
		Parsed:        parsed,
		Summary:       "secret summary",
		MessageSender: options.MessageSender,
		MessageText:   options.MessageText,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := st.UpdateObservationResolution(ctx, id, status, "private resolver reason"); err != nil {
		t.Fatal(err)
	}
	return id
}
