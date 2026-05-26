package mqtt

import (
	"fmt"
	"regexp"
	"strings"
)

var publicKeyPattern = regexp.MustCompile(`^[0-9A-Fa-f]{8,128}$`)
var regionPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{1,16}$`)

type TopicInfo struct {
	IATA        string `json:"iata"`
	Region      string `json:"region,omitempty"`
	PublisherPK string `json:"publisherPublicKey"`
	Subtopic    string `json:"subtopic"`
}

func ParseTopic(topic string) (TopicInfo, error) {
	parts := strings.Split(strings.Trim(topic, "/"), "/")
	if len(parts) != 4 {
		return TopicInfo{}, fmt.Errorf("unexpected topic shape")
	}
	if parts[0] != "meshcore" {
		return TopicInfo{}, fmt.Errorf("topic does not start with meshcore")
	}
	region := strings.ToUpper(strings.TrimSpace(parts[1]))
	if !regionPattern.MatchString(region) {
		return TopicInfo{}, fmt.Errorf("invalid region %q", parts[1])
	}
	pk := strings.ToUpper(parts[2])
	if !publicKeyPattern.MatchString(pk) {
		return TopicInfo{}, fmt.Errorf("invalid public key in topic")
	}
	subtopic := strings.ToLower(parts[3])
	switch subtopic {
	case "packets", "status", "debug", "internal":
		return TopicInfo{IATA: region, Region: region, PublisherPK: pk, Subtopic: subtopic}, nil
	default:
		return TopicInfo{}, fmt.Errorf("unsupported subtopic %q", subtopic)
	}
}
