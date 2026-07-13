package app

import (
	"context"
	"reflect"
	"sync"
	"testing"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

func TestWriteCoordinatorAlternatesLiveLanesBeforeBackground(t *testing.T) {
	runtime := live.NewRuntimeStats()
	coordinator := newWriteCoordinator(runtime)
	t.Cleanup(coordinator.Close)

	started := make(chan struct{})
	release := make(chan struct{})
	var mu sync.Mutex
	order := []string{}
	record := func(name string) {
		mu.Lock()
		order = append(order, name)
		mu.Unlock()
	}

	blockDone := make(chan error, 1)
	go func() {
		blockDone <- coordinator.Do(context.Background(), writeLanePrimary, func(context.Context) error {
			record("block")
			close(started)
			<-release
			return nil
		})
	}()
	<-started

	var wg sync.WaitGroup
	queue := func(lane writeLane, name string) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := coordinator.Do(context.Background(), lane, func(context.Context) error {
				record(name)
				return nil
			}); err != nil {
				t.Errorf("%s: %v", name, err)
			}
		}()
	}
	queue(writeLaneBackground, "background")
	queue(writeLanePrimary, "primary")
	queue(writeLaneLiveCore, "live")
	deadline := time.Now().Add(time.Second)
	for time.Now().Before(deadline) {
		snapshot := runtime.Snapshot()
		if snapshot.WriterBackgroundQueueDepth == 1 && snapshot.WriterPrimaryQueueDepth == 1 && snapshot.WriterLiveCoreQueueDepth == 1 {
			break
		}
		time.Sleep(time.Millisecond)
	}
	close(release)
	if err := <-blockDone; err != nil {
		t.Fatal(err)
	}
	wg.Wait()

	mu.Lock()
	got := append([]string(nil), order...)
	mu.Unlock()
	if want := []string{"block", "live", "primary", "background"}; !reflect.DeepEqual(got, want) {
		t.Fatalf("order=%v want=%v", got, want)
	}
}
