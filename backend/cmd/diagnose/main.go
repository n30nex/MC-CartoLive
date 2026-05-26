package main

import (
	"context"
	"database/sql"
	"flag"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"

	_ "modernc.org/sqlite"
)

type diagnosticFilters struct {
	DBPath        string
	Region        string
	IATA          string
	Name          string
	Label         string
	ID            string
	PublicRegions string
	PublicIATAs   string
	Limit         int
}

type nodeRow struct {
	node live.Node
}

type observerRow struct {
	observer live.Observer
}

type activitySummary struct {
	IATA       string
	Label      string
	Kind       string
	Count      int64
	LastHeard  int64
	LastStatus string
}

func main() {
	filters := diagnosticFilters{}
	flag.StringVar(&filters.DBPath, "db", envString("DB_PATH", "data/meshcore-live.db"), "SQLite database path")
	flag.StringVar(&filters.Region, "region", "", "broker region label to inspect")
	flag.StringVar(&filters.IATA, "iata", "", "legacy alias for --region")
	flag.StringVar(&filters.Name, "name", "", "case-insensitive node or observer name search")
	flag.StringVar(&filters.Label, "label", "", "case-insensitive sanitized public label search")
	flag.StringVar(&filters.ID, "id", "", "operator-local node ID or public key lookup")
	flag.StringVar(&filters.PublicRegions, "public-regions", os.Getenv("PUBLIC_REGIONS"), "comma-separated public region allowlist")
	flag.StringVar(&filters.PublicIATAs, "public-iatas", os.Getenv("PUBLIC_IATAS"), "legacy alias for --public-regions")
	flag.IntVar(&filters.Limit, "limit", 25, "maximum rows per section")
	flag.Parse()
	filters = normalizeDiagnosticFilters(filters)
	if strings.TrimSpace(filters.Region) == "" && strings.TrimSpace(filters.Name) == "" && strings.TrimSpace(filters.Label) == "" && strings.TrimSpace(filters.ID) == "" {
		fmt.Fprintln(os.Stderr, "provide at least one of --region, --iata, --name, --label, or --id")
		os.Exit(2)
	}
	report, err := buildDiagnosticReport(context.Background(), filters)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Print(report)
}

func buildDiagnosticReport(ctx context.Context, filters diagnosticFilters) (string, error) {
	db, err := sql.Open("sqlite", filters.DBPath+"?_pragma=busy_timeout%3d5000&_pragma=foreign_keys%3dON")
	if err != nil {
		return "", err
	}
	defer db.Close()
	return reportFromDB(ctx, db, filters)
}

func normalizeDiagnosticFilters(filters diagnosticFilters) diagnosticFilters {
	filters.Region = strings.ToUpper(strings.TrimSpace(filters.Region))
	filters.IATA = strings.ToUpper(strings.TrimSpace(filters.IATA))
	if filters.Region == "" {
		filters.Region = filters.IATA
	}
	if filters.IATA == "" {
		filters.IATA = filters.Region
	}
	if strings.TrimSpace(filters.PublicRegions) == "" {
		filters.PublicRegions = filters.PublicIATAs
	}
	if strings.TrimSpace(filters.PublicIATAs) == "" {
		filters.PublicIATAs = filters.PublicRegions
	}
	return filters
}

func reportFromDB(ctx context.Context, db *sql.DB, filters diagnosticFilters) (string, error) {
	filters = normalizeDiagnosticFilters(filters)
	if filters.Limit <= 0 || filters.Limit > 200 {
		filters.Limit = 25
	}
	publicRegions := csv(filters.PublicRegions)
	filter := live.NewPublicIATAFilter(publicRegions)
	nodes, err := queryNodes(ctx, db, filters)
	if err != nil {
		return "", err
	}
	observers, err := queryObservers(ctx, db, filters)
	if err != nil {
		return "", err
	}
	packets, err := queryPacketSummaries(ctx, db, filters)
	if err != nil {
		return "", err
	}
	routes, err := queryRouteSummaries(ctx, db, filters)
	if err != nil {
		return "", err
	}

	var b strings.Builder
	fmt.Fprintf(&b, "MC-CartoLive operator diagnostic\n")
	fmt.Fprintf(&b, "filters: region=%q iata=%q name=%q label=%q id=%q db=%q\n", strings.ToUpper(strings.TrimSpace(filters.Region)), strings.ToUpper(strings.TrimSpace(filters.IATA)), strings.TrimSpace(filters.Name), strings.TrimSpace(filters.Label), safeID(filters.ID), filters.DBPath)
	fmt.Fprintf(&b, "public_regions=%q\n", strings.Join(publicRegions, ","))
	fmt.Fprintf(&b, "public_iatas=%q legacy_alias=true\n", strings.Join(publicRegions, ","))
	fmt.Fprintf(&b, "live_confidence_note=\"packet ingest freshness, map motion, and mappability are separate checks\"\n\n")

	fmt.Fprintf(&b, "nodes (%d)\n", len(nodes))
	if len(nodes) == 0 {
		fmt.Fprintf(&b, "- none\n")
	}
	for _, row := range nodes {
		decision := live.PublicNodeMapInclusion(row.node, filter)
		labelHints := labelIATAHints(row.node.Name, row.node.IATAsHeardIn)
		fmt.Fprintf(&b, "- %s role=%s actual_iatas=%s public_iata=%s coords=%s coord_status=%s last_seen=%s observations=%d map=%s",
			display(row.node.Name, row.node.NodeID),
			row.node.Role,
			strings.Join(row.node.IATAsHeardIn, ","),
			publicIATAMatch(row.node.IATAsHeardIn, publicRegions, filter),
			coordString(row.node.Latitude, row.node.Longitude),
			coordinateStatus(row.node.Latitude, row.node.Longitude),
			timeString(row.node.LastSeen),
			row.node.ObservationCount,
			decision.Reason,
		)
		if decision.PositionSource != "" {
			fmt.Fprintf(&b, " source=%s", decision.PositionSource)
		}
		if len(labelHints) > 0 {
			fmt.Fprintf(&b, " label_iata_hint=%s", strings.Join(labelHints, ","))
		}
		fmt.Fprintf(&b, "\n")
	}

	fmt.Fprintf(&b, "\nobservers (%d)\n", len(observers))
	if len(observers) == 0 {
		fmt.Fprintf(&b, "- none\n")
	}
	for _, row := range observers {
		decision := live.PublicObserverFallbackInclusion(row.observer, filter)
		labelHints := labelIATAHints(row.observer.Name, []string{row.observer.IATA})
		fmt.Fprintf(&b, "- %s actual_iata=%s public_iata=%s coords=%s coord_status=%s last_seen=%s packets=%d map=%s",
			display(row.observer.Name, row.observer.IATA+" observer"),
			row.observer.IATA,
			publicIATAMatch([]string{row.observer.IATA}, publicRegions, filter),
			coordString(row.observer.Latitude, row.observer.Longitude),
			coordinateStatus(row.observer.Latitude, row.observer.Longitude),
			timeString(row.observer.LastSeen),
			row.observer.PacketCount,
			decision.Reason,
		)
		if decision.PositionSource != "" {
			fmt.Fprintf(&b, " source=%s", decision.PositionSource)
		}
		if len(labelHints) > 0 {
			fmt.Fprintf(&b, " label_iata_hint=%s", strings.Join(labelHints, ","))
		}
		fmt.Fprintf(&b, "\n")
	}

	writeActivitySection(&b, "recent packet observations", packets)
	writeActivitySection(&b, "recent routed edge events", routes)
	return b.String(), nil
}

func queryNodes(ctx context.Context, db *sql.DB, filters diagnosticFilters) ([]nodeRow, error) {
	where, args := nodeWhere(filters)
	args = append(args, filters.Limit)
	query := `
SELECT n.node_id, n.public_key, n.name, n.node_type, n.role, n.latitude, n.longitude,
  n.location_source, n.first_seen_ms, n.last_seen_ms, n.observation_count, n.supports_multibyte,
  COALESCE(GROUP_CONCAT(DISTINCT ni.iata), '')
FROM nodes n
LEFT JOIN node_iatas ni ON ni.public_key=n.public_key` + where + `
GROUP BY n.node_id, n.public_key, n.name, n.node_type, n.role, n.latitude, n.longitude,
  n.location_source, n.first_seen_ms, n.last_seen_ms, n.observation_count, n.supports_multibyte
ORDER BY n.last_seen_ms DESC
LIMIT ?`
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []nodeRow{}
	for rows.Next() {
		var item live.Node
		var lat, lng sql.NullFloat64
		var iatas string
		if err := rows.Scan(&item.NodeID, &item.PublicKey, &item.Name, &item.NodeType, &item.Role, &lat, &lng, &item.LocationSource, &item.FirstSeen, &item.LastSeen, &item.ObservationCount, &item.SupportsMultibyte, &iatas); err != nil {
			return nil, err
		}
		item.Latitude = floatPtr(lat)
		item.Longitude = floatPtr(lng)
		item.IATAsHeardIn = csv(iatas)
		out = append(out, nodeRow{node: item})
	}
	return out, rows.Err()
}

func queryObservers(ctx context.Context, db *sql.DB, filters diagnosticFilters) ([]observerRow, error) {
	where, args := observerWhere(filters)
	args = append(args, filters.Limit)
	query := `
SELECT public_key, iata, name, latitude, longitude, last_seen_ms, packet_count, status_json
FROM observers` + where + `
ORDER BY last_seen_ms DESC
LIMIT ?`
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []observerRow{}
	for rows.Next() {
		var item live.Observer
		var lat, lng sql.NullFloat64
		if err := rows.Scan(&item.PublicKey, &item.IATA, &item.Name, &lat, &lng, &item.LastSeen, &item.PacketCount, &item.StatusJSON); err != nil {
			return nil, err
		}
		item.Latitude = floatPtr(lat)
		item.Longitude = floatPtr(lng)
		out = append(out, observerRow{observer: item})
	}
	return out, rows.Err()
}

func queryPacketSummaries(ctx context.Context, db *sql.DB, filters diagnosticFilters) ([]activitySummary, error) {
	where, args := packetWhere(filters, "packet_observations")
	args = append(args, filters.Limit)
	query := `
SELECT iata, observer_name, payload_type_name || '/' || resolution_status, COUNT(*) AS count, MAX(heard_at_ms) AS last_heard, resolution_status
FROM packet_observations` + where + `
GROUP BY iata, observer_name, payload_type_name, resolution_status
ORDER BY last_heard DESC
LIMIT ?`
	return querySummaries(ctx, db, query, args)
}

func queryRouteSummaries(ctx context.Context, db *sql.DB, filters diagnosticFilters) ([]activitySummary, error) {
	where, args := packetWhere(filters, "o")
	args = append(args, filters.Limit)
	query := `
SELECT COALESCE(o.iata, ''), COALESCE(o.observer_name, ''), e.payload_type_name || '/routed', COUNT(*) AS count, MAX(e.heard_at_ms) AS last_heard, e.render_reason
FROM live_edge_events e
LEFT JOIN packet_observations o ON o.id=e.observation_id` + where + `
GROUP BY COALESCE(o.iata, ''), COALESCE(o.observer_name, ''), e.payload_type_name, e.render_reason
ORDER BY last_heard DESC
LIMIT ?`
	return querySummaries(ctx, db, query, args)
}

func querySummaries(ctx context.Context, db *sql.DB, query string, args []any) ([]activitySummary, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []activitySummary{}
	for rows.Next() {
		var item activitySummary
		if err := rows.Scan(&item.IATA, &item.Label, &item.Kind, &item.Count, &item.LastHeard, &item.LastStatus); err != nil {
			return nil, err
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

func nodeWhere(filters diagnosticFilters) (string, []any) {
	clauses := []string{}
	args := []any{}
	if iata := strings.ToUpper(strings.TrimSpace(filters.IATA)); iata != "" {
		clauses = append(clauses, `EXISTS (SELECT 1 FROM node_iatas ni_filter WHERE ni_filter.public_key=n.public_key AND upper(ni_filter.iata)=?)`)
		args = append(args, iata)
	}
	if name := strings.TrimSpace(filters.Name); name != "" {
		clauses = append(clauses, `lower(n.name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(name)+"%")
	}
	if label := strings.TrimSpace(filters.Label); label != "" {
		clauses = append(clauses, `lower(n.name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(label)+"%")
	}
	if id := strings.TrimSpace(filters.ID); id != "" {
		clauses = append(clauses, `(n.node_id=? OR upper(n.public_key)=?)`)
		args = append(args, id, strings.ToUpper(id))
	}
	return whereSQL(clauses), args
}

func observerWhere(filters diagnosticFilters) (string, []any) {
	clauses := []string{}
	args := []any{}
	if iata := strings.ToUpper(strings.TrimSpace(filters.IATA)); iata != "" {
		clauses = append(clauses, `upper(iata)=?`)
		args = append(args, iata)
	}
	if name := strings.TrimSpace(filters.Name); name != "" {
		clauses = append(clauses, `lower(name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(name)+"%")
	}
	if label := strings.TrimSpace(filters.Label); label != "" {
		clauses = append(clauses, `lower(name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(label)+"%")
	}
	if id := strings.TrimSpace(filters.ID); id != "" {
		clauses = append(clauses, `upper(public_key)=?`)
		args = append(args, strings.ToUpper(id))
	}
	return whereSQL(clauses), args
}

func packetWhere(filters diagnosticFilters, alias string) (string, []any) {
	prefix := ""
	if alias != "" {
		prefix = alias + "."
	}
	clauses := []string{}
	args := []any{}
	if iata := strings.ToUpper(strings.TrimSpace(filters.IATA)); iata != "" {
		clauses = append(clauses, `upper(`+prefix+`iata)=?`)
		args = append(args, iata)
	}
	if name := strings.TrimSpace(filters.Name); name != "" {
		clauses = append(clauses, `lower(`+prefix+`observer_name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(name)+"%")
	}
	if label := strings.TrimSpace(filters.Label); label != "" {
		clauses = append(clauses, `lower(`+prefix+`observer_name) LIKE ?`)
		args = append(args, "%"+strings.ToLower(label)+"%")
	}
	if id := strings.TrimSpace(filters.ID); id != "" {
		clauses = append(clauses, `upper(`+prefix+`observer_public_key)=?`)
		args = append(args, strings.ToUpper(id))
	}
	return whereSQL(clauses), args
}

func whereSQL(clauses []string) string {
	if len(clauses) == 0 {
		return ""
	}
	return " WHERE " + strings.Join(clauses, " AND ")
}

func writeActivitySection(b *strings.Builder, title string, items []activitySummary) {
	fmt.Fprintf(b, "\n%s (%d)\n", title, len(items))
	if len(items) == 0 {
		fmt.Fprintf(b, "- none\n")
		return
	}
	for _, item := range items {
		fmt.Fprintf(b, "- region=%s iata=%s observer=%s kind=%s count=%d last=%s status=%s\n",
			item.IATA,
			item.IATA, display(item.Label, "unknown"), item.Kind, item.Count, timeString(item.LastHeard), item.LastStatus)
	}
}

func publicIATAMatch(iatas []string, publicIATAs []string, filter live.PublicIATAFilter) string {
	normalized := normalizeIATAs(iatas)
	if len(normalized) == 0 {
		return "none"
	}
	if len(publicIATAs) == 0 {
		return "unrestricted"
	}
	allowed := []string{}
	filtered := []string{}
	for _, iata := range normalized {
		if filter.Allows(iata) {
			allowed = append(allowed, iata)
		} else {
			filtered = append(filtered, iata)
		}
	}
	if len(allowed) > 0 {
		return "allowed:" + strings.Join(allowed, ",")
	}
	return "filtered:" + strings.Join(filtered, ",")
}

func coordinateStatus(lat *float64, lng *float64) string {
	decision := live.PublicMapInclusion{}
	switch {
	case lat == nil || lng == nil:
		decision.Reason = live.MapIncludeMissingCoords
	case *lat == 0 || *lng == 0:
		decision.Reason = live.MapIncludeZeroCoords
	default:
		decision = live.PublicNodeMapInclusion(live.Node{Latitude: lat, Longitude: lng}, live.NewPublicIATAFilter(nil))
	}
	if decision.Mappable {
		return "valid"
	}
	return decision.Reason
}

func labelIATAHints(label string, actualIATAs []string) []string {
	actual := map[string]struct{}{}
	for _, iata := range normalizeIATAs(actualIATAs) {
		actual[iata] = struct{}{}
	}
	hints := []string{}
	for _, token := range strings.FieldsFunc(strings.ToUpper(label), func(r rune) bool {
		return r < 'A' || r > 'Z'
	}) {
		if len(token) != 3 || token[0] != 'Y' {
			continue
		}
		if _, ok := actual[token]; ok {
			continue
		}
		if !containsString(hints, token) {
			hints = append(hints, token)
		}
	}
	return hints
}

func normalizeIATAs(values []string) []string {
	out := []string{}
	for _, value := range values {
		for _, item := range csv(value) {
			if !containsString(out, item) {
				out = append(out, item)
			}
		}
	}
	return out
}

func containsString(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func coordString(lat *float64, lng *float64) string {
	if lat == nil || lng == nil {
		return "missing"
	}
	return strconv.FormatFloat(*lat, 'f', 5, 64) + "," + strconv.FormatFloat(*lng, 'f', 5, 64)
}

func timeString(ms int64) string {
	if ms <= 0 {
		return "unknown"
	}
	return time.UnixMilli(ms).UTC().Format(time.RFC3339)
}

func display(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func safeID(id string) string {
	id = strings.TrimSpace(id)
	if len(id) <= 12 {
		return id
	}
	return id[:6] + "..." + id[len(id)-4:]
}

func csv(value string) []string {
	parts := strings.Split(value, ",")
	out := []string{}
	for _, part := range parts {
		part = strings.ToUpper(strings.TrimSpace(part))
		if part != "" {
			out = append(out, part)
		}
	}
	return out
}

func floatPtr(value sql.NullFloat64) *float64 {
	if !value.Valid {
		return nil
	}
	out := value.Float64
	return &out
}

func envString(key string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}
