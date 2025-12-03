package services_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/freightCognition/mcp-slackbot/config"
	"github.com/freightCognition/mcp-slackbot/services"
)

func testConfig(envPath, tokenURL string) *config.Config {
	return &config.Config{
		SlackAppToken:    "xapp",
		SlackBotToken:    "xoxb",
		BearerToken:      "oldBearer",
		RefreshToken:     "oldRefresh",
		TokenEndpointURL: tokenURL,
		ClientID:         "client",
		ClientSecret:     "secret",
		HealthPort:       3001,
		MCPPreviewURL:    "https://example.com",
		EnvFilePath:      envPath,
	}
}

func TestTokenManagerRefreshSuccess(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "POST", r.Method)
		require.NoError(t, r.ParseForm())
		require.Equal(t, "oldRefresh", r.Form.Get("refresh_token"))
		require.Equal(t, "client", r.Form.Get("client_id"))
		require.Equal(t, "secret", r.Form.Get("client_secret"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"access_token":  "newBearer",
			"refresh_token": "newRefresh",
		})
	}))
	defer server.Close()

	tm := services.NewTokenManager(testConfig(envPath, server.URL), server.Client())
	result, err := tm.Refresh(context.Background())
	require.NoError(t, err)
	require.True(t, result.Success)
	require.True(t, result.NewRefreshToken)
	require.Equal(t, "newBearer", tm.BearerToken())
	require.Equal(t, "newRefresh", tm.RefreshToken())
	content, err := os.ReadFile(envPath)
	require.NoError(t, err)
	require.Contains(t, string(content), "BEARER_TOKEN=\"newBearer\"")
	require.Contains(t, string(content), "REFRESH_TOKEN=\"newRefresh\"")
}

func TestTokenManagerRefreshFailure(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	defer server.Close()

	tm := services.NewTokenManager(testConfig(envPath, server.URL), server.Client())
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()

	result, err := tm.Refresh(ctx)
	require.Error(t, err)
	require.False(t, result.Success)
}
