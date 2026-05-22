package live

type Node struct {
	NodeID            string   `json:"nodeId"`
	PublicKey         string   `json:"publicKey"`
	Name              string   `json:"name"`
	NodeType          int      `json:"nodeType"`
	Role              string   `json:"role"`
	Latitude          *float64 `json:"latitude,omitempty"`
	Longitude         *float64 `json:"longitude,omitempty"`
	LocationSource    string   `json:"locationSource,omitempty"`
	LastSeen          int64    `json:"lastSeen"`
	FirstSeen         int64    `json:"firstSeen"`
	IATAsHeardIn      []string `json:"iatasHeardIn"`
	ObservationCount  int64    `json:"recentObservationCount"`
	SupportsMultibyte string   `json:"supportsMultibytePaths"`
}

type Observer struct {
	PublicKey   string   `json:"publicKey"`
	IATA        string   `json:"iata"`
	Name        string   `json:"name"`
	Latitude    *float64 `json:"latitude,omitempty"`
	Longitude   *float64 `json:"longitude,omitempty"`
	LastSeen    int64    `json:"lastSeen"`
	PacketCount int64    `json:"packetCount"`
	StatusJSON  string   `json:"statusJson,omitempty"`
}

type PacketObservation struct {
	ID                int64    `json:"id"`
	PacketHash        string   `json:"packetHash"`
	PayloadType       int      `json:"payloadType"`
	PayloadTypeName   string   `json:"payloadTypeName"`
	RouteType         int      `json:"routeType"`
	RouteTypeName     string   `json:"routeTypeName"`
	ObserverName      string   `json:"observerName"`
	ObserverPublicKey string   `json:"observerPublicKey"`
	IATA              string   `json:"iata"`
	HeardAt           int64    `json:"heardAt"`
	RSSI              *float64 `json:"rssi,omitempty"`
	SNR               *float64 `json:"snr,omitempty"`
	Score             *float64 `json:"score,omitempty"`
	HashSize          int      `json:"hashSize"`
	HopCount          int      `json:"hopCount"`
	PathHex           string   `json:"pathHex"`
	ResolutionStatus  string   `json:"resolutionStatus"`
	ResolutionReason  string   `json:"resolutionReason,omitempty"`
	Summary           string   `json:"summary"`
	MessageSender     string   `json:"messageSender,omitempty"`
	MessageText       string   `json:"messageText,omitempty"`
	InvalidForMap     bool     `json:"invalidForMap"`
}

type EdgeEndpoint struct {
	NodeID    string  `json:"nodeId"`
	Name      string  `json:"name"`
	Lat       float64 `json:"lat"`
	Lng       float64 `json:"lng"`
	PathHash3 string  `json:"pathHash3,omitempty"`
}

type EdgeSegment struct {
	From       EdgeEndpoint `json:"from"`
	To         EdgeEndpoint `json:"to"`
	DistanceKM float64      `json:"distanceKm"`
	SNR        *float64     `json:"snr,omitempty"`
	RSSI       *float64     `json:"rssi,omitempty"`
}

type MessageAnchor struct {
	Kind     string       `json:"kind"`
	Endpoint EdgeEndpoint `json:"endpoint"`
}

type EdgeEvent struct {
	ID              int64          `json:"id,omitempty"`
	PacketHash      string         `json:"packetHash"`
	ObservationID   int64          `json:"observationId"`
	IATA            string         `json:"iata,omitempty"`
	PayloadType     int            `json:"payloadType"`
	PayloadTypeName string         `json:"payloadTypeName"`
	MessageSender   string         `json:"messageSender,omitempty"`
	MessageText     string         `json:"messageText,omitempty"`
	MessageAnchor   *MessageAnchor `json:"messageAnchor,omitempty"`
	HeardAt         int64          `json:"heardAt"`
	Segments        []EdgeSegment  `json:"segments"`
	RenderReason    string         `json:"renderReason"`
}

type State struct {
	ServerTime       int64               `json:"serverTime"`
	Nodes            []Node              `json:"nodes"`
	Observers        []Observer          `json:"observers"`
	RecentPackets    []PacketObservation `json:"recentPackets"`
	RecentEdgeEvents []EdgeEvent         `json:"recentEdgeEvents"`
}

type Envelope struct {
	Version      int    `json:"v"`
	Type         string `json:"type"`
	Event        string `json:"event,omitempty"`
	Seq          int64  `json:"seq,omitempty"`
	ServerTime   int64  `json:"serverTime,omitempty"`
	ReceivedAt   int64  `json:"receivedAt,omitempty"`
	DisplayAt    int64  `json:"displayAt,omitempty"`
	ConnectionID string `json:"connectionId,omitempty"`
	Data         any    `json:"data,omitempty"`
	DroppedCount int    `json:"droppedCount,omitempty"`
	Since        int64  `json:"since,omitempty"`
}
