package app

import "testing"

func TestLoadConfigDefaultsToPublicMode(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("PUBLIC_MODE", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.PublicMode {
		t.Fatalf("PublicMode = false, want true by default")
	}
}

func TestLoadConfigDefaultsToWorldwidePackageMode(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MAP_REGION_PRESET", "")
	t.Setenv("MAP_BOUNDS", "")
	t.Setenv("PUBLIC_REGIONS", "")
	t.Setenv("PUBLIC_IATAS", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MapRegionPreset != "world" {
		t.Fatalf("MapRegionPreset = %q, want world", cfg.MapRegionPreset)
	}
	if len(cfg.PublicRegions) != 0 {
		t.Fatalf("PublicRegions = %#v, want allow-all empty default", cfg.PublicRegions)
	}
	if cfg.MapBounds.MinLat != -85 || cfg.MapBounds.MaxLng != 180 {
		t.Fatalf("MapBounds = %#v, want world bounds", cfg.MapBounds)
	}
}

func TestLoadConfigCanadaPresetKeepsLegacyAllowlist(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MAP_REGION_PRESET", "canada")
	t.Setenv("PUBLIC_REGIONS", "")
	t.Setenv("PUBLIC_IATAS", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MapRegionPreset != "canada" {
		t.Fatalf("MapRegionPreset = %q, want canada", cfg.MapRegionPreset)
	}
	if len(cfg.PublicRegions) == 0 {
		t.Fatalf("PublicRegions empty for Canada preset")
	}
	if cfg.MapBounds.MinLat != 41 || cfg.MapBounds.MinLng != -142 {
		t.Fatalf("MapBounds = %#v, want Canada bounds", cfg.MapBounds)
	}
}

func TestLoadConfigLegacyPublicIATAsImplyCanadaPresetWhenUnset(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MAP_REGION_PRESET", "")
	t.Setenv("PUBLIC_REGIONS", "")
	t.Setenv("PUBLIC_IATAS", "YTR,YGK")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MapRegionPreset != "canada" {
		t.Fatalf("MapRegionPreset = %q, want canada for legacy PUBLIC_IATAS env", cfg.MapRegionPreset)
	}
	if cfg.MapBounds.MinLat != 41 || cfg.MapBounds.MinLng != -142 {
		t.Fatalf("MapBounds = %#v, want Canada bounds", cfg.MapBounds)
	}
	if got := cfg.PublicRegions; len(got) != 2 || got[0] != "YTR" || got[1] != "YGK" {
		t.Fatalf("PublicRegions = %#v, want legacy YTR,YGK", got)
	}
}

func TestLoadConfigPublicRegionsOverrideLegacyIATAs(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("PUBLIC_REGIONS", "r1, aus")
	t.Setenv("PUBLIC_IATAS", "YYZ")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if got := cfg.PublicRegions; len(got) != 2 || got[0] != "R1" || got[1] != "AUS" {
		t.Fatalf("PublicRegions = %#v, want R1,AUS", got)
	}
}

func TestLoadConfigCustomMapBounds(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("MAP_BOUNDS", "-45,110,-10,155")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.MapRegionPreset != "custom" {
		t.Fatalf("MapRegionPreset = %q, want custom", cfg.MapRegionPreset)
	}
	if cfg.MapBounds.MinLat != -45 || cfg.MapBounds.MinLng != 110 || cfg.MapBounds.MaxLat != -10 || cfg.MapBounds.MaxLng != 155 {
		t.Fatalf("MapBounds = %#v, want Australia-style bounds", cfg.MapBounds)
	}
}

func TestLoadConfigAllowsLocalDebugMode(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("PUBLIC_MODE", "false")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.PublicMode {
		t.Fatalf("PublicMode = true, want false when PUBLIC_MODE=false")
	}
}

func TestLoadConfigDefaultsToSevenDayDataRetention(t *testing.T) {
	t.Setenv("MQTT_ENABLED", "false")
	t.Setenv("DATA_RETENTION_DAYS", "")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DataRetentionDays != 7 {
		t.Fatalf("DataRetentionDays = %d, want 7", cfg.DataRetentionDays)
	}
	if cfg.PropagationEventRetentionDays != 7 {
		t.Fatalf("PropagationEventRetentionDays = %d, want 7", cfg.PropagationEventRetentionDays)
	}
}
