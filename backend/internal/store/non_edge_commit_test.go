package store

import (
	"context"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
	"meshcore-canada-live-map/backend/internal/meshcore"
	mq "meshcore-canada-live-map/backend/internal/mqtt"
)

func TestCommitNonEdgeActivityCoversResolverErrorAndNonHighIdempotently(t *testing.T) {
	for _, tc := range []struct {
		name, status, reason string
	}{
		{name: "resolver error", status: "unresolved", reason: "resolver_error: forced"},
		{name: "non high", status: "missing_coordinates", reason: "observer has no coordinates"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ctx := context.Background()
			st, observationID := nonEdgeCommitStore(t, ctx)
			request := NonEdgeActivityCommitRequest{
				ObservationID: observationID, ResolutionStatus: tc.status, ResolutionReason: tc.reason,
				PublishPublicEvent: true,
				Activity:           live.PublicActivity{ID: "non-edge", Kind: "packet", HeardAt: time.Now().UnixMilli(), AnimationState: live.PublicAnimationUnmapped},
				DedupeKey:          "non-edge:activity", ReceivedAtMs: time.Now().UnixMilli(),
			}
			first, err := st.CommitNonEdgeActivity(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			if !first.EventPresent || !first.EventInserted || first.PublicEvent.Seq <= 0 {
				t.Fatalf("first=%#v", first)
			}
			second, err := st.CommitNonEdgeActivity(ctx, request)
			if err != nil {
				t.Fatal(err)
			}
			if !second.EventPresent || second.EventInserted || second.PublicEvent.Seq != first.PublicEvent.Seq {
				t.Fatalf("retry=%#v", second)
			}
			observation, err := st.ObservationByID(ctx, observationID)
			if err != nil {
				t.Fatal(err)
			}
			if observation.ResolutionStatus != tc.status || observation.ResolutionReason != tc.reason {
				t.Fatalf("observation=%#v", observation)
			}
		})
	}
}

func TestCommitNonEdgeActivityRollsBackResolutionWhenEventInsertFails(t *testing.T) {
	ctx := context.Background()
	st, observationID := nonEdgeCommitStore(t, ctx)
	if _, err := st.db.ExecContext(ctx, `
CREATE TRIGGER fail_non_edge_public_event BEFORE INSERT ON public_events
BEGIN SELECT RAISE(ABORT, 'forced non-edge event failure'); END;`); err != nil {
		t.Fatal(err)
	}
	_, err := st.CommitNonEdgeActivity(ctx, NonEdgeActivityCommitRequest{
		ObservationID: observationID, ResolutionStatus: "missing_coordinates", ResolutionReason: "forced",
		PublishPublicEvent: true, Activity: live.PublicActivity{ID: "rollback", HeardAt: time.Now().UnixMilli()}, DedupeKey: "rollback:activity",
	})
	if err == nil {
		t.Fatal("expected forced public event failure")
	}
	observation, err := st.ObservationByID(ctx, observationID)
	if err != nil {
		t.Fatal(err)
	}
	if observation.ResolutionStatus != "unresolved" || observation.ResolutionReason != "" {
		t.Fatalf("resolution escaped rolled-back transaction: %#v", observation)
	}
	var events int
	if err := st.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM public_events`).Scan(&events); err != nil {
		t.Fatal(err)
	}
	if events != 0 {
		t.Fatalf("events=%d want 0", events)
	}
}

func nonEdgeCommitStore(t *testing.T, ctx context.Context) (*Store, int64) {
	t.Helper()
	st, err := OpenMemory(ctx)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	if _, err := st.db.ExecContext(ctx, `PRAGMA foreign_keys=OFF`); err != nil {
		t.Fatal(err)
	}
	observationID, err := st.InsertObservation(ctx, ObservationInsert{
		Message: mq.NormalizedMessage{Topic: "meshcore/YYZ/CC00/packets", TopicInfo: mq.TopicInfo{IATA: "YYZ", PublisherPK: "CC00"}, HeardAtMs: time.Now().UnixMilli()},
		Parsed:  meshcore.ParsedPacket{PacketHash: "non-edge-packet", RouteTypeName: "flood", PayloadTypeName: "TXT"},
		Summary: "synthetic non-edge",
	})
	if err != nil {
		t.Fatal(err)
	}
	return st, observationID
}
