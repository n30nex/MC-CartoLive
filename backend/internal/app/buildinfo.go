package app

// Release identity is injected at build time with -ldflags -X. Runtime
// environment variables deliberately cannot override these values: the
// running binary is the source of truth for its own provenance.
var (
	BuildVersion = "dev"
	BuildGitSHA  = "unknown"
	BuildTime    = "unknown"
)
