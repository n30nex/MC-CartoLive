package app

import (
	"context"
	"fmt"
	"sync"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type writeLane string

const (
	writeLanePrimary    writeLane = "primary"
	writeLaneLiveCore   writeLane = "live_core"
	writeLaneBackground writeLane = "background"
)

type coordinatedWrite struct {
	ctx      context.Context
	lane     writeLane
	queuedAt time.Time
	fn       func(context.Context) error
	result   chan error
}

// writeCoordinator is the sole application-level admission point for runtime
// SQLite mutations. Primary and live-core work alternate when both are queued;
// background work is admitted only after both live lanes are empty.
type writeCoordinator struct {
	ctx     context.Context
	cancel  context.CancelFunc
	in      chan coordinatedWrite
	runtime *live.RuntimeStats
	done    chan struct{}
	once    sync.Once
}

func newWriteCoordinator(runtime *live.RuntimeStats) *writeCoordinator {
	ctx, cancel := context.WithCancel(context.Background())
	c := &writeCoordinator{
		ctx: ctx, cancel: cancel, in: make(chan coordinatedWrite, 8192),
		runtime: runtime, done: make(chan struct{}),
	}
	go c.run()
	return c
}

func (c *writeCoordinator) Close() {
	if c == nil {
		return
	}
	c.once.Do(c.cancel)
	<-c.done
}

func (c *writeCoordinator) Do(ctx context.Context, lane writeLane, fn func(context.Context) error) error {
	if c == nil {
		return fn(ctx)
	}
	if fn == nil {
		return fmt.Errorf("nil coordinated write")
	}
	if ctx == nil {
		ctx = context.Background()
	}
	request := coordinatedWrite{
		ctx: ctx, lane: lane, queuedAt: time.Now(), fn: fn, result: make(chan error, 1),
	}
	if c.runtime != nil {
		c.runtime.RecordWriterQueued(string(lane), request.queuedAt.UnixMilli())
	}
	select {
	case c.in <- request:
	case <-ctx.Done():
		if c.runtime != nil {
			c.runtime.RecordWriterCanceled(string(lane), request.queuedAt.UnixMilli())
		}
		return ctx.Err()
	case <-c.ctx.Done():
		if c.runtime != nil {
			c.runtime.RecordWriterCanceled(string(lane), request.queuedAt.UnixMilli())
		}
		return context.Canceled
	}
	select {
	case err := <-request.result:
		return err
	case <-ctx.Done():
		return ctx.Err()
	case <-c.ctx.Done():
		return context.Canceled
	}
}

func (c *writeCoordinator) run() {
	defer close(c.done)
	queues := map[writeLane][]coordinatedWrite{
		writeLanePrimary: {}, writeLaneLiveCore: {}, writeLaneBackground: {},
	}
	nextLive := writeLanePrimary
	for {
		if len(queues[writeLanePrimary])+len(queues[writeLaneLiveCore])+len(queues[writeLaneBackground]) == 0 {
			select {
			case <-c.ctx.Done():
				return
			case request := <-c.in:
				queues[request.lane] = append(queues[request.lane], request)
			}
		}
		// Collect everything that arrived while the prior mutation was running so
		// lane selection observes the real backlog rather than ingress order.
		for draining := true; draining; {
			select {
			case request := <-c.in:
				queues[request.lane] = append(queues[request.lane], request)
			default:
				draining = false
			}
		}

		lane := writeLaneBackground
		hasPrimary := len(queues[writeLanePrimary]) > 0
		hasLive := len(queues[writeLaneLiveCore]) > 0
		switch {
		case hasPrimary && hasLive:
			lane = nextLive
			if nextLive == writeLanePrimary {
				nextLive = writeLaneLiveCore
			} else {
				nextLive = writeLanePrimary
			}
		case hasPrimary:
			lane = writeLanePrimary
			nextLive = writeLaneLiveCore
		case hasLive:
			lane = writeLaneLiveCore
			nextLive = writeLanePrimary
		}
		request := queues[lane][0]
		queues[lane] = queues[lane][1:]
		if c.runtime != nil {
			c.runtime.RecordWriterStarted(string(lane), request.queuedAt.UnixMilli(), time.Since(request.queuedAt))
		}
		err := request.ctx.Err()
		if err == nil {
			err = request.fn(request.ctx)
		}
		request.result <- err
	}
}
