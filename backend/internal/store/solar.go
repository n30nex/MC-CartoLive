package store

import "context"

type SolarSnapshot struct {
	FetchedAtMs    int64
	KpIndex        float64
	SolarFluxSfu   float64
	GeomagActivity string
}

func (s *Store) InsertSolarSnapshot(ctx context.Context, snap SolarSnapshot) (int64, error) {
	r, err := s.db.ExecContext(ctx, `INSERT INTO solar_snapshots (fetched_at_ms, kp_index, solar_flux_sfu, geomag_activity) VALUES (?,?,?,?)`,
		snap.FetchedAtMs, snap.KpIndex, snap.SolarFluxSfu, snap.GeomagActivity)
	if err != nil { return 0, err }
	return r.LastInsertId()
}

func (s *Store) LatestSolarSnapshot(ctx context.Context) (SolarSnapshot, error) {
	var snap SolarSnapshot
	err := s.db.QueryRowContext(ctx, `SELECT fetched_at_ms, kp_index, solar_flux_sfu, geomag_activity FROM solar_snapshots ORDER BY fetched_at_ms DESC LIMIT 1`).
		Scan(&snap.FetchedAtMs, &snap.KpIndex, &snap.SolarFluxSfu, &snap.GeomagActivity)
	return snap, err
}

func (s *Store) TrimSolarSnapshots(ctx context.Context, keep int) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM solar_snapshots WHERE id NOT IN (SELECT id FROM solar_snapshots ORDER BY fetched_at_ms DESC LIMIT ?)`, keep)
	return err
}
