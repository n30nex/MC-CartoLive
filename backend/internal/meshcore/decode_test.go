package meshcore

import (
	"testing"
)

func TestParseHexPacketValid(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	raw := []byte{header, 0x01, 0xAA, 0x01}
	parsed, err := ParsePacket(raw)
	if err != nil {
		t.Fatal(err)
	}
	if parsed.RouteType != RouteFlood {
		t.Fatalf("route type = %d, want %d", parsed.RouteType, RouteFlood)
	}
	if parsed.PayloadType != PayloadPlainText {
		t.Fatalf("payload type = %d, want %d", parsed.PayloadType, PayloadPlainText)
	}
	if parsed.HashSize != 1 {
		t.Fatalf("hash size = %d, want 1", parsed.HashSize)
	}
	if parsed.HopCount != 1 {
		t.Fatalf("hop count = %d, want 1", parsed.HopCount)
	}
}

func TestParseHexPacketStripsNonHex(t *testing.T) {
	parsed, err := ParseHexPacket("  09 01 aa\r\n")
	if err != nil {
		t.Fatal(err)
	}
	if parsed.RouteType != RouteFlood {
		t.Fatalf("route type = %d, want %d", parsed.RouteType, RouteFlood)
	}
	if parsed.HashSize != 1 {
		t.Fatalf("hash size = %d, want 1", parsed.HashSize)
	}
}

func TestParseHexPacketEmptyError(t *testing.T) {
	_, err := ParseHexPacket("")
	if err == nil {
		t.Fatal("expected error for empty hex")
	}
}

func TestParseHexPacketOddLengthError(t *testing.T) {
	_, err := ParseHexPacket("08C1A")
	if err == nil {
		t.Fatal("expected error for odd-length hex")
	}
}

func TestParseHexPacketInvalidHexError(t *testing.T) {
	_, err := ParseHexPacket("ZZZZ")
	if err == nil {
		t.Fatal("expected error for invalid hex")
	}
	_, err = ParseHexPacket("08GG")
	if err == nil {
		t.Fatal("expected error for invalid hex")
	}
}

func TestParsePacketTooShort(t *testing.T) {
	_, err := ParsePacket([]byte{})
	if err == nil {
		t.Fatal("expected error for zero-length packet")
	}
	_, err = ParsePacket([]byte{0x08})
	if err == nil {
		t.Fatal("expected error for single-byte packet")
	}
}

func TestParsePacketWithTransportCodes(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteTransportFlood)
	raw := []byte{header, 0xAA, 0xBB, 0xCC, 0xDD, 0x41, 0xEE, 0x01}
	parsed, err := ParsePacket(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.TransportCodes) != 4 {
		t.Fatalf("transport codes length = %d, want 4", len(parsed.TransportCodes))
	}
	if parsed.HashSize != 2 {
		t.Fatalf("hash size = %d, want 2", parsed.HashSize)
	}
	if parsed.HopCount != 1 {
		t.Fatalf("hop count = %d, want 1", parsed.HopCount)
	}
}

func TestParsePacketTransportCodesTooShort(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteTransportFlood)
	_, err := ParsePacket([]byte{header, 0xAA})
	if err == nil {
		t.Fatal("expected error for too-short transport codes")
	}
}

func TestParsePacketMissingPathLength(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	_, err := ParsePacket([]byte{header})
	if err == nil {
		t.Fatal("expected error for missing path length")
	}
}

func TestParsePacketPathTooShort(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	_, err := ParsePacket([]byte{header, 0x02, 0xAA})
	if err == nil {
		t.Fatal("expected error for truncated path")
	}
}

func TestParsePacketPayloadPreserved(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	parsed, err := ParsePacket([]byte{header, 0x01, 0xAA, 0x01, 0x02, 0x03})
	if err != nil {
		t.Fatal(err)
	}
	if len(parsed.Payload) != 3 {
		t.Fatalf("payload length = %d, want 3", len(parsed.Payload))
	}
	if parsed.Payload[0] != 0x01 || parsed.Payload[2] != 0x03 {
		t.Fatal("payload contents mismatch")
	}
}

func TestChunkPathHashSize1(t *testing.T) {
	path := []byte{0xAA, 0xBB, 0xCC}
	chunks := chunkPath(path, 1)
	if len(chunks) != 3 {
		t.Fatalf("chunks = %d, want 3", len(chunks))
	}
	if chunks[0] != "AA" || chunks[1] != "BB" || chunks[2] != "CC" {
		t.Fatalf("chunks = %v", chunks)
	}
}

func TestChunkPathHashSize2(t *testing.T) {
	path := []byte{0xAA, 0xBB, 0xCC, 0xDD}
	chunks := chunkPath(path, 2)
	if len(chunks) != 2 {
		t.Fatalf("chunks = %d, want 2", len(chunks))
	}
	if chunks[0] != "AABB" || chunks[1] != "CCDD" {
		t.Fatalf("chunks = %v", chunks)
	}
}

func TestChunkPathHashSize4(t *testing.T) {
	path := []byte{0xAA, 0xBB, 0xCC, 0xDD, 0xEE, 0xFF, 0x00, 0x11}
	chunks := chunkPath(path, 4)
	if len(chunks) != 2 {
		t.Fatalf("chunks = %d, want 2", len(chunks))
	}
	if chunks[0] != "AABBCCDD" || chunks[1] != "EEFF0011" {
		t.Fatalf("chunks = %v", chunks)
	}
}

func TestChunkPathEmpty(t *testing.T) {
	chunks := chunkPath([]byte{}, 1)
	if chunks != nil {
		t.Fatalf("chunks = %v, want nil", chunks)
	}
}

func TestChunkPathZeroHashSize(t *testing.T) {
	chunks := chunkPath([]byte{0xAA, 0xBB}, 0)
	if chunks != nil {
		t.Fatalf("chunks = %v, want nil", chunks)
	}
}

func TestChunkPathPartialLastChunkDropped(t *testing.T) {
	path := []byte{0xAA, 0xBB, 0xCC}
	chunks := chunkPath(path, 2)
	if len(chunks) != 1 {
		t.Fatalf("chunks = %d, want 1", len(chunks))
	}
}

func TestParseAdvertPayloadValid(t *testing.T) {
	payload := make([]byte, 100)
	for i := range payload[:32] {
		payload[i] = 0xAA
	}
	payload[32] = 0x78
	payload[33] = 0x56
	payload[34] = 0x34
	payload[35] = 0x12

	advert, ok, err := ParseAdvertPayload(payload)
	if !ok || err != nil {
		t.Fatalf("ok=%t err=%v", ok, err)
	}
	if advert.Role != "unknown" {
		t.Fatalf("role = %s, want unknown", advert.Role)
	}
	if advert.Timestamp != 0x12345678 {
		t.Fatalf("timestamp = 0x%x", advert.Timestamp)
	}
}

func TestParseAdvertPayloadWithName(t *testing.T) {
	payload := make([]byte, 101+9)
	for i := range payload[:32] {
		payload[i] = 0xAA
	}
	payload[100] = 0x80
	copy(payload[101:], []byte("TestNode"))
	advert, ok, err := ParseAdvertPayload(payload)
	if !ok || err != nil {
		t.Fatalf("ok=%t err=%v", ok, err)
	}
	if advert.Name != "TestNode" {
		t.Fatalf("name = %q, want TestNode", advert.Name)
	}
}

func TestParseAdvertPayloadWithLocation(t *testing.T) {
	payload := make([]byte, 100+9)
	for i := range payload[:32] {
		payload[i] = 0xAA
	}
	payload[100] = 0x10 | 0x03
	latMicro := int32(43 * 1_000_000)
	lngMicro := int32(-80 * 1_000_000)
	payload[101] = byte(latMicro)
	payload[102] = byte(latMicro >> 8)
	payload[103] = byte(latMicro >> 16)
	payload[104] = byte(latMicro >> 24)
	payload[105] = byte(lngMicro)
	payload[106] = byte(lngMicro >> 8)
	payload[107] = byte(lngMicro >> 16)
	payload[108] = byte(lngMicro >> 24)

	advert, ok, err := ParseAdvertPayload(payload)
	if !ok || err != nil {
		t.Fatalf("ok=%t err=%v", ok, err)
	}
	if advert.Role != "room_server" {
		t.Fatalf("role = %s, want room_server", advert.Role)
	}
	if advert.Latitude == nil || *advert.Latitude != 43.0 {
		t.Fatalf("latitude = %v", advert.Latitude)
	}
	if advert.Longitude == nil || *advert.Longitude != -80.0 {
		t.Fatalf("longitude = %v", advert.Longitude)
	}
}

func TestParseAdvertPayloadTooShort(t *testing.T) {
	_, ok, _ := ParseAdvertPayload([]byte{0x01, 0x02})
	if ok {
		t.Fatal("expected not ok for short payload")
	}
}

func TestDecodePublicMessagePlainText(t *testing.T) {
	msg := DecodePublicMessage(PayloadPlainText, []byte("hello"), "", nil)
	if msg.Text != "hello" {
		t.Fatalf("text = %q, want hello", msg.Text)
	}
	if msg.Sender != "" {
		t.Fatalf("sender = %q, want empty", msg.Sender)
	}
}

func TestDecodePublicMessageJSON(t *testing.T) {
	rawJSON := `{"decoded":{"sender":"Alice","message":"hello world"}}`
	msg := DecodePublicMessage(PayloadGroupText, []byte{0x01, 0x02, 0x03}, rawJSON, nil)
	if msg.Sender != "Alice" {
		t.Fatalf("sender = %q, want Alice", msg.Sender)
	}
	if msg.Text != "hello world" {
		t.Fatalf("text = %q, want hello world", msg.Text)
	}
}

func TestDecodeTextPayloadNonText(t *testing.T) {
	text := DecodeTextPayload(PayloadAdvert, []byte("hello"))
	if text != "" {
		t.Fatalf("text = %q, want empty (non-text payload type)", text)
	}
}

func TestDecodeTextPayloadGroupText(t *testing.T) {
	text := DecodeTextPayload(PayloadGroupText, []byte("group message"))
	if text != "group message" {
		t.Fatalf("text = %q, want group message", text)
	}
}

func TestNodeRoleFromType(t *testing.T) {
	tests := []struct {
		nodeType int
		want     string
	}{
		{1, "companion"},
		{2, "repeater"},
		{3, "room_server"},
		{4, "sensor"},
		{0, "unknown"},
		{99, "unknown"},
	}
	for _, tt := range tests {
		got := NodeRoleFromType(tt.nodeType)
		if got != tt.want {
			t.Fatalf("NodeRoleFromType(%d) = %q, want %q", tt.nodeType, got, tt.want)
		}
	}
}

func TestPayloadTypeName(t *testing.T) {
	tests := []struct {
		payloadType int
		want        string
	}{
		{PayloadRequest, "REQUEST"},
		{PayloadResponse, "RESPONSE"},
		{PayloadPlainText, "PLAIN_TEXT"},
		{PayloadAck, "ACK"},
		{PayloadAdvert, "ADVERT"},
		{PayloadGroupText, "GROUP_TEXT"},
		{PayloadGroupData, "GROUP_DATA"},
		{PayloadAnonReq, "ANON_REQUEST"},
		{PayloadPath, "RETURNED_PATH"},
		{PayloadTrace, "TRACE"},
		{PayloadMultipart, "MULTIPART"},
		{PayloadControl, "CONTROL"},
		{PayloadRawCustom, "CUSTOM"},
		{99, "RESERVED"},
	}
	for _, tt := range tests {
		got := PayloadTypeName(tt.payloadType)
		if got != tt.want {
			t.Fatalf("PayloadTypeName(%d) = %q, want %q", tt.payloadType, got, tt.want)
		}
	}
}

func TestParsePacketHashSize4NonTraceInvalidForMap(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	parsed, err := ParsePacket([]byte{header, 0xC1, 0xAA, 0xBB, 0xCC, 0xDD})
	if err != nil {
		t.Fatal(err)
	}
	if !parsed.InvalidForMap {
		t.Fatal("expected invalid for map for non-trace 4-byte path")
	}
}

func TestParsePacketHashSize4TraceValidForMap(t *testing.T) {
	header := byte((PayloadTrace << 2) | RouteFlood)
	parsed, err := ParsePacket([]byte{header, 0xC1, 0xAA, 0xBB, 0xCC, 0xDD})
	if err != nil {
		t.Fatal(err)
	}
	if parsed.InvalidForMap {
		t.Fatal("trace 4-byte path should be valid for map")
	}
}

func TestParsePacketHashSize3NonTraceValidForMap(t *testing.T) {
	header := byte((PayloadPlainText << 2) | RouteFlood)
	parsed, err := ParsePacket([]byte{header, 0x81, 0xAA, 0xBB, 0xCC})
	if err != nil {
		t.Fatal(err)
	}
	if parsed.HashSize != 3 {
		t.Fatalf("hash size = %d, want 3", parsed.HashSize)
	}
	if parsed.InvalidForMap {
		t.Fatal("3-byte path should be valid for map")
	}
}

func TestParsePacketHashSizeCalculatedCorrectly(t *testing.T) {
	tests := []struct {
		pathLength byte
		wantSize   int
		wantHops   int
	}{
		{0x00, 1, 0},
		{0x01, 1, 1},
		{0x40, 2, 0},
		{0x41, 2, 1},
		{0x80, 3, 0},
		{0x81, 3, 1},
		{0xC0, 4, 0},
		{0xC1, 4, 1},
		{0x3F, 1, 63},
	}
	for _, tt := range tests {
		t.Run("", func(t *testing.T) {
			header := byte((PayloadPlainText << 2) | RouteFlood)
			pathLen := tt.pathLength
			if int(pathLen&0x3F) != tt.wantHops {
				t.Fatalf("hop count mismatch: got %d, want %d", int(pathLen&0x3F), tt.wantHops)
			}
			wantTotalBytes := tt.wantSize * tt.wantHops
			raw := make([]byte, 2+wantTotalBytes)
			raw[0] = header
			raw[1] = pathLen
			parsed, err := ParsePacket(raw)
			if err != nil {
				t.Fatal(err)
			}
			if parsed.HashSize != tt.wantSize {
				t.Fatalf("hash size = %d, want %d", parsed.HashSize, tt.wantSize)
			}
			if parsed.HopCount != tt.wantHops {
				t.Fatalf("hop count = %d, want %d", parsed.HopCount, tt.wantHops)
			}
		})
	}
}

func TestParsePacketHashNotPresent(t *testing.T) {
	parsed, err := ParsePacket([]byte{0x09, 0x00})
	if err != nil {
		t.Fatal(err)
	}
	if parsed.PacketHash == "" {
		t.Fatal("packet hash should not be empty")
	}
	if len(parsed.PacketHash) != 16 {
		t.Fatalf("packet hash length = %d, want 16", len(parsed.PacketHash))
	}
}
