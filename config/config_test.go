package config

import "testing"

func TestLoadSuccess(t *testing.T) {
	t.Setenv("SLACK_APP_TOKEN", "xapp-test")
	t.Setenv("SLACK_BOT_TOKEN", "xoxb-test")
	t.Setenv("BEARER_TOKEN", "bearer")
	t.Setenv("REFRESH_TOKEN", "refresh")
	t.Setenv("TOKEN_ENDPOINT_URL", "https://example.com/token")
	t.Setenv("CLIENT_ID", "client")
	t.Setenv("CLIENT_SECRET", "secret")
	t.Setenv("MCP_API_URL", "https://example.com/mcp")

	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() returned error: %v", err)
	}

	if cfg.MCPAPIURL != "https://example.com/mcp" {
		t.Fatalf("expected MCPAPIURL to be set, got %s", cfg.MCPAPIURL)
	}
}

func TestLoadMissingValues(t *testing.T) {
	t.Setenv("SLACK_APP_TOKEN", "")
	t.Setenv("SLACK_BOT_TOKEN", "")
	t.Setenv("BEARER_TOKEN", "")
	t.Setenv("REFRESH_TOKEN", "")
	t.Setenv("TOKEN_ENDPOINT_URL", "")
	t.Setenv("CLIENT_ID", "")
	t.Setenv("CLIENT_SECRET", "")

	if _, err := Load(); err == nil {
		t.Fatal("expected error due to missing environment variables")
	}
}
