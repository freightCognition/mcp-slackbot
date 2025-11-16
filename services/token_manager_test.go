package services

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"freightCognition/mcp-slackbot/config"
)

func TestTokenManager_RefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/token" {
			t.Fatalf("Expected to request '/token', got: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		response := map[string]string{
			"access_token":  "new_access_token",
			"refresh_token": "new_refresh_token",
		}
		json.NewEncoder(w).Encode(response)
	}))
	defer server.Close()

	cfg := &config.Config{
		RefreshToken:     "old_refresh_token",
		TokenEndpointURL: server.URL + "/token",
		ClientID:         "test_client_id",
		ClientSecret:     "test_client_secret",
	}

	tm := NewTokenManager(cfg)
	err := tm.RefreshToken()
	if err != nil {
		t.Fatalf("Expected no error, but got %v", err)
	}

	if tm.GetBearerToken() != "new_access_token" {
		t.Errorf("Expected bearer token to be 'new_access_token', but got '%s'", tm.GetBearerToken())
	}
	if cfg.RefreshToken != "new_refresh_token" {
		t.Errorf("Expected refresh token to be 'new_refresh_token', but got '%s'", cfg.RefreshToken)
	}
}
