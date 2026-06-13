package store

import (
	"context"
	"fmt"
	"strings"
	"time"

	"meshcore-canada-live-map/backend/internal/live"
)

type PublicCoverageQuery struct {
	Region string
	Limit  int
}

func (s *Store) PublicCoverageCells(ctx context.Context, query PublicCoverageQuery) ([]live.PublicCoverageCell, error) {
	if s == nil || s.db == nil {
		return nil, fmt.Errorf("store unavailable")
	}
	limit := query.Limit
	if limit <= 0 || limit > 5000 {
		limit = 1000
	}
	sqlText := `
SELECT id, source, region, min_lat, min_lng, max_lat, max_lng, intensity, sample_count,
  age_bucket, updated_at_ms, attribution, precision_bucket
FROM public_coverage_cells`
	args := []any{}
	if region := strings.ToUpper(strings.TrimSpace(query.Region)); region != "" {
		sqlText += ` WHERE region = ?`
		args = append(args, region)
	}
	sqlText += `
ORDER BY updated_at_ms DESC, id DESC
LIMIT ?`
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, sqlText, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cells := []live.PublicCoverageCell{}
	for rows.Next() {
		var id int64
		var cell live.PublicCoverageCell
		var minLat, minLng, maxLat, maxLng float64
		if err := rows.Scan(
			&id,
			&cell.Source,
			&cell.Region,
			&minLat,
			&minLng,
			&maxLat,
			&maxLng,
			&cell.Intensity,
			&cell.SampleCount,
			&cell.AgeBucket,
			&cell.UpdatedAt,
			&cell.Attribution,
			&cell.PrecisionBucket,
		); err != nil {
			return nil, err
		}
		cell.ID = fmt.Sprintf("coverage-%d", id)
		cell.BBox = []float64{minLng, minLat, maxLng, maxLat}
		cells = append(cells, cell)
	}
	return cells, rows.Err()
}

func (s *Store) UpsertPublicCoverageCell(ctx context.Context, cell live.PublicCoverageCell) error {
	if s == nil || s.db == nil {
		return fmt.Errorf("store unavailable")
	}
	if len(cell.BBox) != 4 {
		return fmt.Errorf("coverage bbox must be [minLng,minLat,maxLng,maxLat]")
	}
	if cell.UpdatedAt <= 0 {
		cell.UpdatedAt = time.Now().UnixMilli()
	}
	if cell.PrecisionBucket == "" {
		cell.PrecisionBucket = "coarse"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO public_coverage_cells (
  source, region, min_lat, min_lng, max_lat, max_lng, intensity, sample_count,
  age_bucket, updated_at_ms, attribution, precision_bucket
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		live.PublicDisplayText(cell.Source, 80),
		strings.ToUpper(strings.TrimSpace(cell.Region)),
		cell.BBox[1],
		cell.BBox[0],
		cell.BBox[3],
		cell.BBox[2],
		cell.Intensity,
		cell.SampleCount,
		live.PublicDisplayText(cell.AgeBucket, 40),
		cell.UpdatedAt,
		live.PublicDisplayText(cell.Attribution, 160),
		live.PublicDisplayText(cell.PrecisionBucket, 40),
	)
	return err
}
