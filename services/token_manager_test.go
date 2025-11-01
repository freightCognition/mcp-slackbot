package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/joho/godotenv"

	"github.com/freightCognition/mcp-slackbot/config"
)

func TestRefreshAccessTokenSuccess(t *testing.T) {
	tokenResponse := map[string]string{
		"access_token":  "new-access",
		"refresh_token": "new-refresh",
	}

	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if err := r.ParseForm(); err != nil {
			t.Fatalf("failed to parse form: %v", err)
		}

		if r.FormValue("refresh_token") != "old-refresh" {
			t.Fatalf("expected refresh token old-refresh, got %s", r.FormValue("refresh_token"))
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(tokenResponse)
	}))
	defer server.Close()

	envPath := filepath.Join(t.TempDir(), ".env")
	cfg := &config.Config{
		ClientID:         "client",
		ClientSecret:     "secret",
		TokenEndpointURL: server.URL,
		EnvFilePath:      envPath,
		BearerToken:      "old-bearer",
		RefreshToken:     "old-refresh",
	}

	tm := NewTokenManager(cfg)
	tm.httpClient = server.Client()

	newRefresh, err := tm.RefreshAccessToken(context.Background())
	if err != nil {
		t.Fatalf("RefreshAccessToken returned error: %v", err)
	}

	if !newRefresh {
		t.Fatalf("expected new refresh token to be issued")
	}

	if token := tm.BearerToken(); token != "new-access" {
		t.Fatalf("expected bearer token to be updated, got %s", token)
	}

	if token := tm.RefreshToken(); token != "new-refresh" {
		t.Fatalf("expected refresh token to be updated, got %s", token)
	}

	envMap, err := godotenv.Read(envPath)
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}

	if envMap["BEARER_TOKEN"] != "new-access" {
		t.Fatalf("env file not updated with bearer token")
	}

	if envMap["REFRESH_TOKEN"] != "new-refresh" {
		t.Fatalf("env file not updated with refresh token")
	}
}

func TestRefreshAccessTokenWithoutNewRefreshToken(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"new-access"}`))
	}))
	defer server.Close()

	envPath := filepath.Join(t.TempDir(), ".env")
	cfg := &config.Config{
		ClientID:         "client",
		ClientSecret:     "secret",
		TokenEndpointURL: server.URL,
		EnvFilePath:      envPath,
		BearerToken:      "old-bearer",
		RefreshToken:     "old-refresh",
	}

	tm := NewTokenManager(cfg)
	tm.httpClient = server.Client()

	newRefresh, err := tm.RefreshAccessToken(context.Background())
	if err != nil {
		t.Fatalf("RefreshAccessToken returned error: %v", err)
	}

	if newRefresh {
		t.Fatalf("expected no new refresh token to be issued")
	}

	if tm.RefreshToken() != "old-refresh" {
		t.Fatalf("refresh token should remain unchanged")
	}

	envMap, err := godotenv.Read(envPath)
	if err != nil {
		t.Fatalf("failed to read env file: %v", err)
	}

	if envMap["REFRESH_TOKEN"] != "old-refresh" {
		t.Fatalf("expected env file to retain old refresh token")
	}
}

func TestRefreshAccessTokenHTTPError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer server.Close()

	envPath := filepath.Join(t.TempDir(), ".env")
	cfg := &config.Config{
		ClientID:         "client",
		ClientSecret:     "secret",
		TokenEndpointURL: server.URL,
		EnvFilePath:      envPath,
		BearerToken:      "old-bearer",
		RefreshToken:     "old-refresh",
	}

	tm := NewTokenManager(cfg)
	tm.httpClient = server.Client()

	if _, err := tm.RefreshAccessToken(context.Background()); err == nil {
		t.Fatalf("expected error when refresh endpoint returns 500")
	}

	if tm.BearerToken() != "old-bearer" {
		t.Fatalf("bearer token should not change on error")
	}
}
