package mqtt

import "testing"

func TestParseTopic(t *testing.T) {
	info, err := ParseTopic("meshcore/YKF/ABCDEF012345/packets")
	if err != nil {
		t.Fatal(err)
	}
	if info.IATA != "YKF" || info.Region != "YKF" || info.PublisherPK != "ABCDEF012345" || info.Subtopic != "packets" {
		t.Fatalf("unexpected topic info: %+v", info)
	}
}

func TestParseTopicAcceptsGenericRegionLabels(t *testing.T) {
	for _, topic := range []string{
		"meshcore/r1/ABCDEF012345/packets",
		"meshcore/eu-west/ABCDEF012345/status",
		"meshcore/AUS_1/ABCDEF012345/packets",
	} {
		info, err := ParseTopic(topic)
		if err != nil {
			t.Fatalf("ParseTopic(%q) error: %v", topic, err)
		}
		if info.IATA == "" || info.Region == "" {
			t.Fatalf("ParseTopic(%q) = %+v, want region alias populated", topic, info)
		}
	}
}

func TestParseTopicRejectsMalformed(t *testing.T) {
	if _, err := ParseTopic("meshcore/YKF/ABCDEF012345"); err == nil {
		t.Fatal("expected malformed topic error")
	}
	if _, err := ParseTopic("meshcore/region/withslash/ABCDEF012345/packets"); err == nil {
		t.Fatal("expected unsafe region topic error")
	}
}

func TestParseTopicAllowsInternalForExplicitDrop(t *testing.T) {
	info, err := ParseTopic("meshcore/YKF/ABCDEF012345/internal")
	if err != nil {
		t.Fatal(err)
	}
	if info.Subtopic != "internal" {
		t.Fatalf("subtopic = %s, want internal", info.Subtopic)
	}
}
