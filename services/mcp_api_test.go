package services_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/freightCognition/mcp-slackbot/config"
	"github.com/freightCognition/mcp-slackbot/services"
)

func newTestConfig(envPath, previewURL, tokenURL string) *config.Config {
	return &config.Config{
		SlackAppToken:    "xapp",
		SlackBotToken:    "xoxb",
		BearerToken:      "oldBearer",
		RefreshToken:     "oldRefresh",
		TokenEndpointURL: tokenURL,
		ClientID:         "client",
		ClientSecret:     "secret",
		HealthPort:       3001,
		MCPPreviewURL:    previewURL,
		EnvFilePath:      envPath,
	}
}

func TestPreviewCarrierSuccess(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	previewServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "Bearer oldBearer", r.Header.Get("Authorization"))
		require.Equal(t, "12345", r.URL.Query().Get("docketNumber"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]services.CarrierPreview{{
			CompanyName: "Carrier",
		}})
	}))
	defer previewServer.Close()

	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "should not refresh", http.StatusBadRequest)
	}))
	defer tokenServer.Close()

	cfg := newTestConfig(envPath, previewServer.URL, tokenServer.URL)
	tokenManager := services.NewTokenManager(cfg, tokenServer.Client())
	api := services.NewMCPAPI(cfg, tokenManager, previewServer.Client())

	result, err := api.PreviewCarrier(context.Background(), "12345")
	require.NoError(t, err)
	require.Equal(t, "Carrier", result.CompanyName)
	require.Equal(t, "oldBearer", tokenManager.BearerToken())
}

func TestPreviewCarrierRefreshOnUnauthorized(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	call := 0
	previewServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		call++
		if call == 1 {
			require.Equal(t, "Bearer oldBearer", r.Header.Get("Authorization"))
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		require.Equal(t, "Bearer newBearer", r.Header.Get("Authorization"))
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]services.CarrierPreview{{
			CompanyName: "Carrier",
		}})
	}))
	defer previewServer.Close()

	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{
			"access_token":  "newBearer",
			"refresh_token": "newRefresh",
		})
	}))
	defer tokenServer.Close()

	cfg := newTestConfig(envPath, previewServer.URL, tokenServer.URL)
	tokenManager := services.NewTokenManager(cfg, tokenServer.Client())
	api := services.NewMCPAPI(cfg, tokenManager, previewServer.Client())

	result, err := api.PreviewCarrier(context.Background(), "12345")
	require.NoError(t, err)
	require.Equal(t, "Carrier", result.CompanyName)
	require.Equal(t, "newBearer", tokenManager.BearerToken())
	data, err := os.ReadFile(envPath)
	require.NoError(t, err)
	require.Contains(t, string(data), "BEARER_TOKEN=\"newBearer\"")
}

func TestPreviewCarrierRefreshFailure(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")

	previewServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "unauthorized", http.StatusUnauthorized)
	}))
	defer previewServer.Close()

	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "bad request", http.StatusBadRequest)
	}))
	defer tokenServer.Close()

	cfg := newTestConfig(envPath, previewServer.URL, tokenServer.URL)
	tokenManager := services.NewTokenManager(cfg, tokenServer.Client())
	api := services.NewMCPAPI(cfg, tokenManager, previewServer.Client())

	_, err := api.PreviewCarrier(context.Background(), "12345")
	require.Error(t, err)
}
