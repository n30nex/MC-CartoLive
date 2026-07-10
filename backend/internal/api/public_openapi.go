package api

import (
	_ "embed"
	"encoding/json"
)

// publicOpenAPIDocument is generated together with docs/public-api.openapi.json
// by scripts/generate-public-openapi.mjs. The release check requires both
// copies to be byte-identical.
//
//go:embed public-openapi.json
var publicOpenAPIDocument []byte

func publicOpenAPISchema(version string) map[string]any {
	var schema map[string]any
	if err := json.Unmarshal(publicOpenAPIDocument, &schema); err != nil {
		panic("invalid embedded public OpenAPI document: " + err.Error())
	}
	info, ok := schema["info"].(map[string]any)
	if !ok {
		panic("embedded public OpenAPI document is missing info")
	}
	info["version"] = version
	return schema
}
