package meshcore

import (
	"crypto/aes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"
)

func Summary(parsed ParsedPacket, advert *Advert) string {
	if advert != nil {
		name := advert.Name
		if name == "" {
			name = advert.PublicKey[:8]
		}
		return fmt.Sprintf("Advert %s", name)
	}
	return fmt.Sprintf("%s %s %d hop(s)", parsed.RouteTypeName, parsed.PayloadTypeName, parsed.HopCount)
}

func DecodeTextPayload(payloadType int, payload []byte) string {
	if payloadType != PayloadPlainText && payloadType != PayloadGroupText {
		return ""
	}
	if len(payload) == 0 || !utf8.Valid(payload) {
		return ""
	}
	return SanitizeTextPayload(string(payload))
}

func DecodePublicMessageText(payloadType int, payload []byte, rawJSON string, channelSecrets []string) string {
	return DecodePublicMessage(payloadType, payload, rawJSON, channelSecrets).Text
}

type DecodedPublicMessage struct {
	Sender string
	Text   string
}

// MeshCore's default Public channel key is well-known and used as a built-in
// lowest-priority key for public channel text. Custom channel names or keys
// supplied through config are still tried first.
const defaultPublicChannelKeyHex = "8b3387e9c5cdea6ac9e5edbaa115cd72"

func DecodePublicMessage(payloadType int, payload []byte, rawJSON string, channelSecrets []string) DecodedPublicMessage {
	if text := MessageTextFromJSON(rawJSON); text != "" {
		sender := MessageSenderFromJSON(rawJSON)
		return DecodedPublicMessage{Sender: sender, Text: stripSenderPrefix(text, sender)}
	}
	if payloadType == PayloadGroupText {
		return DecodeGroupTextMessage(payload, channelSecrets)
	}
	return DecodedPublicMessage{Text: DecodeTextPayload(payloadType, payload)}
}

func DecodePublicMessageSender(payloadType int, payload []byte, rawJSON string, channelSecrets []string) string {
	return DecodePublicMessage(payloadType, payload, rawJSON, channelSecrets).Sender
}

func DecodeGroupTextPayload(payload []byte, channelSecrets []string) string {
	return DecodeGroupTextMessage(payload, channelSecrets).Text
}

func DecodeGroupTextMessage(payload []byte, channelSecrets []string) DecodedPublicMessage {
	if len(payload) < 3 {
		return DecodedPublicMessage{}
	}
	channelHash := strings.ToLower(hex.EncodeToString(payload[:1]))
	cipherMAC := payload[1:3]
	ciphertext := payload[3:]
	if len(ciphertext) == 0 || len(ciphertext)%aes.BlockSize != 0 {
		return DecodedPublicMessage{}
	}
	for _, secret := range groupTextChannelSecrets(channelSecrets) {
		key, ok := normalizeChannelSecret(secret, channelHash)
		if !ok {
			continue
		}
		message := decryptGroupText(ciphertext, cipherMAC, key)
		if message.Text != "" {
			return message
		}
	}
	return DecodedPublicMessage{}
}

func groupTextChannelSecrets(channelSecrets []string) []string {
	out := make([]string, 0, len(channelSecrets)+1)
	for _, secret := range channelSecrets {
		if strings.TrimSpace(secret) != "" {
			out = append(out, secret)
		}
	}
	out = append(out, defaultPublicChannelKeyHex)
	return out
}

func SanitizeTextPayload(value string) string {
	value = strings.TrimSpace(strings.TrimRight(value, "\x00"))
	if value == "" {
		return ""
	}
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	return strings.Join(strings.Fields(value), " ")
}

func MessageTextFromJSON(rawJSON string) string {
	rawJSON = strings.TrimSpace(rawJSON)
	if rawJSON == "" {
		return ""
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &object); err != nil {
		return ""
	}
	return messageTextFromObject(object, 0)
}

func MessageSenderFromJSON(rawJSON string) string {
	rawJSON = strings.TrimSpace(rawJSON)
	if rawJSON == "" {
		return ""
	}
	var object map[string]any
	if err := json.Unmarshal([]byte(rawJSON), &object); err != nil {
		return ""
	}
	return messageSenderFromObject(object, 0)
}

func messageTextFromObject(object map[string]any, depth int) string {
	if object == nil || depth > 5 {
		return ""
	}
	for _, key := range []string{"decoded_json", "decodedJson", "decoded_payload", "decodedPayload", "payload_json", "payloadJson"} {
		if value, ok := object[key]; ok {
			if nested := objectFromJSONString(value); nested != nil {
				if text := messageTextFromObject(nested, depth+1); text != "" {
					return text
				}
			}
		}
	}
	for _, key := range []string{"message_text", "messageText", "decoded_text", "decodedText", "payload_text", "payloadText", "text", "message", "body", "content"} {
		if value, ok := object[key]; ok {
			if text, ok := value.(string); ok {
				if sanitized := SanitizeTextPayload(text); sanitized != "" {
					return sanitized
				}
			}
		}
	}
	for _, key := range []string{"payload", "decoded", "decrypted", "data", "packet", "groupText", "group_text"} {
		if value, ok := object[key]; ok {
			if nested, ok := value.(map[string]any); ok {
				if text := messageTextFromObject(nested, depth+1); text != "" {
					return text
				}
			} else if nested := objectFromJSONString(value); nested != nil {
				if text := messageTextFromObject(nested, depth+1); text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func messageSenderFromObject(object map[string]any, depth int) string {
	if object == nil || depth > 5 {
		return ""
	}
	for _, key := range []string{"decoded_json", "decodedJson", "decoded_payload", "decodedPayload", "payload_json", "payloadJson"} {
		if value, ok := object[key]; ok {
			if nested := objectFromJSONString(value); nested != nil {
				if text := messageSenderFromObject(nested, depth+1); text != "" {
					return text
				}
			}
		}
	}
	for _, key := range []string{"sender", "sender_name", "senderName", "from", "fromName", "author", "authorName"} {
		if value, ok := object[key]; ok {
			if text, ok := value.(string); ok {
				if sanitized := SanitizeTextPayload(text); sanitized != "" {
					return limitPublicMessageField(sanitized, 80)
				}
			}
		}
	}
	for _, key := range []string{"payload", "decoded", "decrypted", "data", "packet", "groupText", "group_text"} {
		if value, ok := object[key]; ok {
			if nested, ok := value.(map[string]any); ok {
				if text := messageSenderFromObject(nested, depth+1); text != "" {
					return text
				}
			} else if nested := objectFromJSONString(value); nested != nil {
				if text := messageSenderFromObject(nested, depth+1); text != "" {
					return text
				}
			}
		}
	}
	return ""
}

func objectFromJSONString(value any) map[string]any {
	raw, ok := value.(string)
	if !ok {
		return nil
	}
	raw = strings.TrimSpace(raw)
	if raw == "" || !strings.HasPrefix(raw, "{") {
		return nil
	}
	var nested map[string]any
	if err := json.Unmarshal([]byte(raw), &nested); err != nil {
		return nil
	}
	return nested
}

func stripSenderPrefix(text string, sender string) string {
	text = SanitizeTextPayload(text)
	sender = SanitizeTextPayload(sender)
	if text == "" || sender == "" {
		return text
	}
	prefix := sender + ": "
	if strings.HasPrefix(text, prefix) {
		return SanitizeTextPayload(strings.TrimPrefix(text, prefix))
	}
	return text
}

func normalizeChannelSecret(secret string, packetChannelHash string) ([]byte, bool) {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return nil, false
	}
	if strings.EqualFold(secret, "public") {
		secret = defaultPublicChannelKeyHex
	}
	clean := strings.ToLower(hexCleaner.ReplaceAllString(secret, ""))
	var key []byte
	if len(clean) >= 32 && len(clean)%2 == 0 {
		secretBytes, err := hex.DecodeString(clean)
		if err != nil || len(secretBytes) < aes.BlockSize {
			return nil, false
		}
		key = secretBytes[:aes.BlockSize]
	} else {
		sum := sha256.Sum256([]byte(secret))
		key = sum[:aes.BlockSize]
	}
	hash := sha256.Sum256(key)
	if fmt.Sprintf("%02x", hash[0]) != packetChannelHash {
		return nil, false
	}
	return key, true
}

func decryptGroupText(ciphertext []byte, cipherMAC []byte, key []byte) DecodedPublicMessage {
	channelSecret := make([]byte, 32)
	copy(channelSecret, key)
	mac := hmac.New(sha256.New, channelSecret)
	_, _ = mac.Write(ciphertext)
	expected := mac.Sum(nil)
	if len(expected) < 2 || len(cipherMAC) < 2 || !hmac.Equal(expected[:2], cipherMAC[:2]) {
		return DecodedPublicMessage{}
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return DecodedPublicMessage{}
	}
	plaintext := make([]byte, len(ciphertext))
	for offset := 0; offset < len(ciphertext); offset += aes.BlockSize {
		block.Decrypt(plaintext[offset:offset+aes.BlockSize], ciphertext[offset:offset+aes.BlockSize])
	}
	if len(plaintext) < 5 {
		return DecodedPublicMessage{}
	}
	return parseGroupTextPlaintext(plaintext)
}

func parseGroupTextPlaintext(plaintext []byte) DecodedPublicMessage {
	if len(plaintext) < 5 {
		return DecodedPublicMessage{}
	}
	messageBytes := plaintext[5:]
	if nul := bytesIndexByte(messageBytes, 0); nul >= 0 {
		messageBytes = messageBytes[:nul]
	}
	if !utf8.Valid(messageBytes) {
		return DecodedPublicMessage{}
	}
	text := SanitizeTextPayload(string(messageBytes))
	if text == "" {
		return DecodedPublicMessage{}
	}
	if colon := strings.Index(text, ": "); colon > 0 && colon < 50 {
		potentialSender := text[:colon]
		if !strings.ContainsAny(potentialSender, ":[]") {
			return DecodedPublicMessage{
				Sender: limitPublicMessageField(SanitizeTextPayload(potentialSender), 80),
				Text:   SanitizeTextPayload(text[colon+2:]),
			}
		}
	}
	return DecodedPublicMessage{Text: text}
}

func bytesIndexByte(value []byte, target byte) int {
	for index, item := range value {
		if item == target {
			return index
		}
	}
	return -1
}

func limitPublicMessageField(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes])
}
