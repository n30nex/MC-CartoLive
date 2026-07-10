package mqtt

import (
	"context"
	"crypto/tls"
	"log/slog"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
	"github.com/google/uuid"
)

type Handler func(context.Context, NormalizedMessage)

type queuedMessage struct {
	message    NormalizedMessage
	enqueuedAt int64
}

type ClientConfig struct {
	Enabled   bool
	BrokerURL string
	Topic     string
	ClientID  string
	QueueSize int
	Auth      AuthConfig
}

type Client struct {
	cfg                   ClientConfig
	log                   *slog.Logger
	handler               Handler
	queue                 chan queuedMessage
	queueAgeMu            sync.Mutex
	queueTimes            []int64
	connected             atomic.Bool
	subscribed            atomic.Bool
	total                 atomic.Int64
	accepted              atomic.Int64
	processed             atomic.Int64
	dropped               atomic.Int64
	reconnects            atomic.Int64
	malformed             atomic.Int64
	internalDropped       atomic.Int64
	normalizeErrors       atomic.Int64
	lastMessageAt         atomic.Int64
	lastConnectedAt       atomic.Int64
	lastSubscribedAt      atomic.Int64
	lastConnectionLostAt  atomic.Int64
	lastSessionRecoveryAt atomic.Int64
	shutdown              atomic.Bool
	clientMu              sync.Mutex
	client                paho.Client
	newPahoClient         func(*paho.ClientOptions) paho.Client
}

func NewClient(cfg ClientConfig, log *slog.Logger, handler Handler) *Client {
	if cfg.QueueSize < 1 {
		cfg.QueueSize = 4096
	}
	return &Client{
		cfg:           cfg,
		log:           log,
		handler:       handler,
		queue:         make(chan queuedMessage, cfg.QueueSize),
		newPahoClient: paho.NewClient,
	}
}

func (c *Client) Start(ctx context.Context) error {
	// Keep the normalized queue worker available when the network subscriber is
	// disabled. Synthetic fixture replay and release load gates deliberately use
	// the same bounded queue and writer path as production MQTT traffic.
	go c.dispatch(ctx)
	if !c.cfg.Enabled {
		c.log.Info("mqtt disabled")
		return nil
	}
	if err := c.cfg.Auth.Validate(); err != nil {
		return err
	}
	c.clientMu.Lock()
	c.client = c.buildPahoClient()
	client := c.client
	c.clientMu.Unlock()

	c.connect(client)

	go func() {
		<-ctx.Done()
		c.shutdown.Store(true)
		c.clientMu.Lock()
		client := c.client
		c.clientMu.Unlock()
		if client != nil {
			client.Disconnect(250)
		}
		c.connected.Store(false)
		c.subscribed.Store(false)
	}()

	go c.watchdog(ctx)

	return nil
}

func (c *Client) buildPahoClient() paho.Client {
	opts := paho.NewClientOptions()
	opts.AddBroker(c.cfg.BrokerURL)
	opts.SetClientID(c.cfg.ClientID)
	opts.SetCleanSession(true)
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetPingTimeout(10 * time.Second)
	opts.SetMaxReconnectInterval(5 * time.Minute)
	opts.SetConnectRetryInterval(5 * time.Second)
	opts.SetTLSConfig(&tls.Config{MinVersion: tls.VersionTLS12})
	if c.cfg.Auth.Mode == "subscriber" {
		opts.SetUsername(c.cfg.Auth.Username)
		opts.SetPassword(c.cfg.Auth.Password)
	} else if c.cfg.Auth.Mode == "jwt" {
		opts.SetUsername("v1_" + strings.ToUpper(c.cfg.Auth.PublicKey))
		opts.SetPassword(c.cfg.Auth.Token)
	}

	opts.SetConnectionLostHandler(func(_ paho.Client, err error) {
		c.connected.Store(false)
		c.subscribed.Store(false)
		c.lastConnectionLostAt.Store(time.Now().UnixMilli())
		c.log.Warn("mqtt connection lost", "error", err)
	})
	opts.SetOnConnectHandler(func(client paho.Client) {
		c.connected.Store(true)
		c.subscribed.Store(false)
		c.reconnects.Add(1)
		c.lastConnectedAt.Store(time.Now().UnixMilli())
		c.log.Info("mqtt connected", "broker", redactBroker(c.cfg.BrokerURL), "topic", c.cfg.Topic)
		token := client.Subscribe(c.cfg.Topic, 0, c.onMessage())
		if !token.WaitTimeout(10 * time.Second) {
			c.log.Error("mqtt subscribe timed out", "topic", c.cfg.Topic)
			c.scheduleSessionRecovery()
			return
		}
		if err := token.Error(); err != nil {
			c.log.Error("mqtt subscribe failed", "error", err)
			c.scheduleSessionRecovery()
			return
		}
		c.subscribed.Store(true)
		c.lastSubscribedAt.Store(time.Now().UnixMilli())
		c.log.Info("mqtt subscribed", "topic", c.cfg.Topic)
	})

	factory := c.newPahoClient
	if factory == nil {
		factory = paho.NewClient
	}
	return factory(opts)
}

func (c *Client) connect(client paho.Client) {
	if client == nil {
		return
	}
	token := client.Connect()
	go func() {
		if !token.WaitTimeout(10 * time.Second) {
			c.log.Warn("mqtt initial connect still pending; continuing startup")
			if !token.WaitTimeout(20 * time.Second) {
				c.log.Error("mqtt connect timed out after 30s total")
				return
			}
		}
		if err := token.Error(); err != nil {
			c.connected.Store(false)
			c.subscribed.Store(false)
			c.log.Error("mqtt connect failed", "error", err)
		}
	}()
}

func (c *Client) watchdog(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			// RF traffic can legitimately be quiet. Connection and subscription
			// callbacks, not message recency, drive session recovery.
			if c.Connected() && !c.SessionReady() {
				c.log.Warn("mqtt connected but subscription is not ready")
				c.scheduleSessionRecovery()
			}
		}
	}
}

func (c *Client) scheduleSessionRecovery() {
	if c == nil || c.shutdown.Load() {
		return
	}
	now := time.Now().UnixMilli()
	for {
		last := c.lastSessionRecoveryAt.Load()
		if last > 0 && now-last < int64(30*time.Second/time.Millisecond) {
			return
		}
		if c.lastSessionRecoveryAt.CompareAndSwap(last, now) {
			go c.forceReconnect()
			return
		}
	}
}

func (c *Client) forceReconnect() {
	if c.shutdown.Load() {
		return
	}
	c.connected.Store(false)
	c.subscribed.Store(false)
	c.lastConnectionLostAt.Store(time.Now().UnixMilli())

	c.clientMu.Lock()
	oldClient := c.client
	c.client = c.buildPahoClient()
	newClient := c.client
	c.clientMu.Unlock()

	if oldClient != nil {
		oldClient.Disconnect(250)
	}
	c.connect(newClient)
}

func (c *Client) onMessage() paho.MessageHandler {
	return func(_ paho.Client, msg paho.Message) {
		if c.shutdown.Load() {
			return
		}
		topic := msg.Topic()
		info, err := ParseTopic(topic)
		if err != nil {
			c.malformed.Add(1)
			c.log.Debug("mqtt dropped malformed topic", "topic", topic, "error", err)
			return
		}
		if info.Subtopic == "internal" {
			c.internalDropped.Add(1)
			c.log.Debug("mqtt internal topic dropped", "iata", info.IATA)
			return
		}
		normalized, err := Normalize(topic, msg.Payload(), time.Now())
		if err != nil {
			c.normalizeErrors.Add(1)
			c.log.Debug("mqtt normalize failed", "topic", topic, "error", err)
			return
		}
		c.SubmitNormalized(normalized)
	}
}

// SubmitNormalized puts an already parsed MQTT message through the same
// bounded queue used by the network callback. It is intentionally useful for
// credential-free fixture replay and reproducible release load gates. A fresh
// ingest ID is assigned once, before enqueueing, and is preserved by retries.
func (c *Client) SubmitNormalized(normalized NormalizedMessage) bool {
	if c == nil || c.shutdown.Load() {
		return false
	}
	if normalized.IngestID == "" {
		normalized.IngestID = uuid.NewString()
	}
	c.total.Add(1)
	c.lastMessageAt.Store(normalized.HeardAtMs)
	now := time.Now().UnixMilli()
	queued := queuedMessage{message: normalized, enqueuedAt: now}
	c.queueAgeMu.Lock()
	select {
	case c.queue <- queued:
		c.queueTimes = append(c.queueTimes, now)
		c.accepted.Add(1)
		c.queueAgeMu.Unlock()
		return true
	default:
		c.queueAgeMu.Unlock()
		dropped := c.dropped.Add(1)
		if dropped == 1 || dropped%100 == 0 {
			c.log.Warn("mqtt ingest queue full; dropping normalized message", "dropped", dropped, "queueSize", c.cfg.QueueSize)
		}
		return false
	}
}

func (c *Client) dispatch(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case queued := <-c.queue:
			c.queueAgeMu.Lock()
			c.popQueueTimestampLocked()
			c.queueAgeMu.Unlock()
			func() {
				defer func() {
					if r := recover(); r != nil {
						c.log.Error("mqtt dispatch panic", "panic", r)
					}
				}()
				c.handler(ctx, queued.message)
			}()
			c.processed.Add(1)
		}
	}
}

func (c *Client) Connected() bool {
	return c.connected.Load()
}

func (c *Client) SessionReady() bool {
	return c != nil && c.connected.Load() && c.subscribed.Load()
}

func (c *Client) TotalMessages() int64 {
	return c.total.Load()
}

func (c *Client) DroppedMessages() int64 {
	return c.dropped.Load()
}

type Status struct {
	Enabled              bool  `json:"enabled"`
	Connected            bool  `json:"connected"`
	Subscribed           bool  `json:"subscribed"`
	SessionReady         bool  `json:"sessionReady"`
	TotalMessages        int64 `json:"totalMessages"`
	AcceptedMessages     int64 `json:"acceptedMessages"`
	ProcessedMessages    int64 `json:"processedMessages"`
	DroppedMessages      int64 `json:"droppedMessages"`
	Reconnects           int64 `json:"reconnects"`
	MalformedTopics      int64 `json:"malformedTopics"`
	InternalDropped      int64 `json:"internalDropped"`
	NormalizeErrors      int64 `json:"normalizeErrors"`
	LastMessageAt        int64 `json:"lastMessageAt"`
	LastMessageAgeMs     int64 `json:"lastMessageAgeMs"`
	LastConnectedAt      int64 `json:"lastConnectedAt"`
	LastSubscribedAt     int64 `json:"lastSubscribedAt"`
	LastConnectionLostAt int64 `json:"lastConnectionLostAt"`
	QueueDepth           int   `json:"queueDepth"`
	QueueCapacity        int   `json:"queueCapacity"`
	OldestQueueItemAgeMs int64 `json:"oldestQueueItemAgeMs"`
}

func (c *Client) Status(now time.Time) Status {
	if c == nil {
		return Status{}
	}
	if now.IsZero() {
		now = time.Now()
	}
	lastMessageAt := c.lastMessageAt.Load()
	age := int64(-1)
	if lastMessageAt > 0 {
		age = now.UnixMilli() - lastMessageAt
		if age < 0 {
			age = 0
		}
	}
	c.queueAgeMu.Lock()
	oldestQueueAt := c.queueOldestLocked()
	c.queueAgeMu.Unlock()
	oldestQueueAge := int64(0)
	if oldestQueueAt > 0 {
		oldestQueueAge = now.UnixMilli() - oldestQueueAt
		if oldestQueueAge < 0 {
			oldestQueueAge = 0
		}
	}
	return Status{
		Enabled:              c.cfg.Enabled,
		Connected:            c.Connected(),
		Subscribed:           c.subscribed.Load(),
		SessionReady:         c.SessionReady(),
		TotalMessages:        c.TotalMessages(),
		AcceptedMessages:     c.accepted.Load(),
		ProcessedMessages:    c.processed.Load(),
		DroppedMessages:      c.DroppedMessages(),
		Reconnects:           c.reconnects.Load(),
		MalformedTopics:      c.malformed.Load(),
		InternalDropped:      c.internalDropped.Load(),
		NormalizeErrors:      c.normalizeErrors.Load(),
		LastMessageAt:        lastMessageAt,
		LastMessageAgeMs:     age,
		LastConnectedAt:      c.lastConnectedAt.Load(),
		LastSubscribedAt:     c.lastSubscribedAt.Load(),
		LastConnectionLostAt: c.lastConnectionLostAt.Load(),
		QueueDepth:           len(c.queue),
		QueueCapacity:        cap(c.queue),
		OldestQueueItemAgeMs: oldestQueueAge,
	}
}

func (c *Client) queueOldestLocked() int64 {
	if len(c.queueTimes) == 0 {
		return 0
	}
	return c.queueTimes[0]
}

func (c *Client) popQueueTimestampLocked() {
	if len(c.queueTimes) > 0 {
		c.queueTimes = c.queueTimes[1:]
	}
}

func redactBroker(in string) string {
	protoEnd := strings.Index(in, "://")
	if protoEnd < 0 {
		protoEnd = -3
	}
	if at := strings.LastIndex(in, "@"); at >= 0 && protoEnd < at {
		return in[:protoEnd+3] + "redacted@" + in[at+1:]
	}
	return in
}
