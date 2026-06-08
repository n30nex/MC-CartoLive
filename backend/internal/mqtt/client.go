package mqtt

import (
	"context"
	"crypto/tls"
	"log/slog"
	"strings"
	"sync/atomic"
	"time"

	paho "github.com/eclipse/paho.mqtt.golang"
)

type Handler func(context.Context, NormalizedMessage)

type ClientConfig struct {
	Enabled   bool
	BrokerURL string
	Topic     string
	ClientID  string
	QueueSize int
	Auth      AuthConfig
}

type Client struct {
	cfg                  ClientConfig
	log                  *slog.Logger
	handler              Handler
	queue                chan NormalizedMessage
	connected            atomic.Bool
	total                atomic.Int64
	dropped              atomic.Int64
	reconnects           atomic.Int64
	malformed            atomic.Int64
	internalDropped      atomic.Int64
	normalizeErrors      atomic.Int64
	lastMessageAt        atomic.Int64
	lastConnectedAt      atomic.Int64
	lastConnectionLostAt atomic.Int64
	lastForceDisconnect  atomic.Int64
	client               paho.Client
}

func NewClient(cfg ClientConfig, log *slog.Logger, handler Handler) *Client {
	if cfg.QueueSize < 1 {
		cfg.QueueSize = 4096
	}
	return &Client{cfg: cfg, log: log, handler: handler, queue: make(chan NormalizedMessage, cfg.QueueSize)}
}

func (c *Client) Start(ctx context.Context) error {
	if !c.cfg.Enabled {
		c.log.Info("mqtt disabled")
		return nil
	}
	if err := c.cfg.Auth.Validate(); err != nil {
		return err
	}
	go c.dispatch(ctx)

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
		c.lastConnectionLostAt.Store(time.Now().UnixMilli())
		c.log.Warn("mqtt connection lost", "error", err)
	})
	opts.SetOnConnectHandler(func(client paho.Client) {
		c.connected.Store(true)
		c.reconnects.Add(1)
		c.lastConnectedAt.Store(time.Now().UnixMilli())
		c.log.Info("mqtt connected", "broker", redactBroker(c.cfg.BrokerURL), "topic", c.cfg.Topic)
		token := client.Subscribe(c.cfg.Topic, 0, c.onMessage(ctx))
		token.Wait()
		if err := token.Error(); err != nil {
			c.connected.Store(false)
			c.log.Error("mqtt subscribe failed", "error", err)
			return
		}
		c.log.Info("mqtt subscribed", "topic", c.cfg.Topic)
	})

	c.client = paho.NewClient(opts)
	token := c.client.Connect()
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
			c.log.Error("mqtt connect failed", "error", err)
		}
	}()

	go func() {
		<-ctx.Done()
		c.client.Disconnect(250)
		c.connected.Store(false)
	}()

	go c.watchdog(ctx)

	return nil
}

func (c *Client) watchdog(ctx context.Context) {
	ticker := time.NewTicker(60 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if c.Connected() {
				lastMsg := c.lastMessageAt.Load()
				if lastMsg > 0 && time.Now().UnixMilli()-lastMsg > 120_000 {
					lastDisconnect := c.lastForceDisconnect.Load()
					now := time.Now().UnixMilli()
					if lastDisconnect > 0 && now-lastDisconnect < 60_000 {
						c.log.Warn("mqtt watchdog: skipping force disconnect; last disconnect <60s ago")
						continue
					}
					c.log.Warn("mqtt watchdog: connected but no messages for >120s; forcing reconnect")
					c.lastForceDisconnect.Store(now)
					c.client.Disconnect(0)
				}
			}
		}
	}
}

func (c *Client) onMessage(ctx context.Context) paho.MessageHandler {
	return func(_ paho.Client, msg paho.Message) {
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
		c.total.Add(1)
		c.lastMessageAt.Store(normalized.HeardAtMs)
		select {
		case c.queue <- normalized:
		default:
			dropped := c.dropped.Add(1)
			if dropped == 1 || dropped%100 == 0 {
				c.log.Warn("mqtt ingest queue full; dropping normalized message", "dropped", dropped, "queueSize", c.cfg.QueueSize)
			}
		}
	}
}

func (c *Client) dispatch(ctx context.Context) {
	for {
		select {
		case <-ctx.Done():
			return
		case msg := <-c.queue:
			func() {
				defer func() {
					if r := recover(); r != nil {
						c.log.Error("mqtt dispatch panic", "panic", r)
					}
				}()
				c.handler(ctx, msg)
			}()
		}
	}
}

func (c *Client) Connected() bool {
	return c.connected.Load()
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
	TotalMessages        int64 `json:"totalMessages"`
	DroppedMessages      int64 `json:"droppedMessages"`
	Reconnects           int64 `json:"reconnects"`
	MalformedTopics      int64 `json:"malformedTopics"`
	InternalDropped      int64 `json:"internalDropped"`
	NormalizeErrors      int64 `json:"normalizeErrors"`
	LastMessageAt        int64 `json:"lastMessageAt"`
	LastMessageAgeMs     int64 `json:"lastMessageAgeMs"`
	LastConnectedAt      int64 `json:"lastConnectedAt"`
	LastConnectionLostAt int64 `json:"lastConnectionLostAt"`
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
	return Status{
		Enabled:              c.cfg.Enabled,
		Connected:            c.Connected(),
		TotalMessages:        c.TotalMessages(),
		DroppedMessages:      c.DroppedMessages(),
		Reconnects:           c.reconnects.Load(),
		MalformedTopics:      c.malformed.Load(),
		InternalDropped:      c.internalDropped.Load(),
		NormalizeErrors:      c.normalizeErrors.Load(),
		LastMessageAt:        lastMessageAt,
		LastMessageAgeMs:     age,
		LastConnectedAt:      c.lastConnectedAt.Load(),
		LastConnectionLostAt: c.lastConnectionLostAt.Load(),
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
