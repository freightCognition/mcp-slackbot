package config_test

import (
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/freightCognition/mcp-slackbot/config"
)

func setRequiredEnv(t *testing.T) string {
	t.Helper()
	t.Setenv("SLACK_APP_TOKEN", "xapp-test")
	t.Setenv("SLACK_BOT_TOKEN", "xoxb-test")
	t.Setenv("BEARER_TOKEN", "bearer")
	t.Setenv("REFRESH_TOKEN", "refresh")
	t.Setenv("TOKEN_ENDPOINT_URL", "https://example.com/token")
	t.Setenv("CLIENT_ID", "client-id")
	t.Setenv("CLIENT_SECRET", "client-secret")
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	t.Setenv("ENV_FILE_PATH", envPath)
	return envPath
}

func TestLoadSuccess(t *testing.T) {
	envPath := setRequiredEnv(t)
	t.Setenv("HEALTH_PORT", "4000")
	t.Setenv("MCP_PREVIEW_URL", "https://example.com/preview")

	cfg, err := config.Load()
	require.NoError(t, err)
	require.Equal(t, "xapp-test", cfg.SlackAppToken)
	require.Equal(t, "xoxb-test", cfg.SlackBotToken)
	require.Equal(t, 4000, cfg.HealthPort)
	require.Equal(t, envPath, cfg.EnvFilePath)
	require.Equal(t, "https://example.com/preview", cfg.MCPPreviewURL)
}

func TestLoadMissingVariable(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("CLIENT_SECRET", "")

	_, err := config.Load()
	require.Error(t, err)
}
