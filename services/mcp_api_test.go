package services

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/freightCognition/mcp-slackbot/config"
)

func TestPreviewCarrierSuccess(t *testing.T) {
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("docketNumber") != "123" {
			t.Fatalf("expected docketNumber query param")
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode([]Carrier{{
			CompanyName:  "Company",
			DotNumber:    "111",
			DocketNumber: "123",
			RiskAssessmentDetails: RiskAssessmentDetail{
				TotalPoints: 10,
			},
		}})
	}))
	defer mcpServer.Close()

	cfg := &config.Config{
		MCPAPIURL:        mcpServer.URL,
		TokenEndpointURL: "https://token", // unused
		EnvFilePath:      filepath.Join(t.TempDir(), ".env"),
		BearerToken:      "token",
		RefreshToken:     "refresh",
		ClientID:         "client",
		ClientSecret:     "secret",
	}

	tm := NewTokenManager(cfg)
	client := NewMCPClient(cfg, tm)
	client.httpClient = mcpServer.Client()

	carrier, err := client.PreviewCarrier(context.Background(), "123")
	if err != nil {
		t.Fatalf("PreviewCarrier returned error: %v", err)
	}

	if carrier.CompanyName != "Company" {
		t.Fatalf("unexpected company name: %s", carrier.CompanyName)
	}
}

func TestPreviewCarrierRefreshesTokenOnUnauthorized(t *testing.T) {
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`{"access_token":"new-access","refresh_token":"new-refresh"}`))
	}))
	defer tokenServer.Close()

	requestCount := 0
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requestCount++
		auth := r.Header.Get("Authorization")
		if requestCount == 1 {
			if auth != "Bearer old-access" {
				t.Fatalf("expected first request to use old token, got %s", auth)
			}
			w.WriteHeader(http.StatusUnauthorized)
			return
		}

		if auth != "Bearer new-access" {
			t.Fatalf("expected refreshed token, got %s", auth)
		}

		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[{"CompanyName":"Updated","RiskAssessmentDetails":{"TotalPoints":5}}]`))
	}))
	defer mcpServer.Close()

	cfg := &config.Config{
		MCPAPIURL:        mcpServer.URL,
		TokenEndpointURL: tokenServer.URL,
		EnvFilePath:      filepath.Join(t.TempDir(), ".env"),
		BearerToken:      "old-access",
		RefreshToken:     "refresh",
		ClientID:         "client",
		ClientSecret:     "secret",
	}

	tm := NewTokenManager(cfg)
	tm.httpClient = tokenServer.Client()

	client := NewMCPClient(cfg, tm)
	client.httpClient = mcpServer.Client()

	carrier, err := client.PreviewCarrier(context.Background(), "123")
	if err != nil {
		t.Fatalf("PreviewCarrier returned error: %v", err)
	}

	if carrier.CompanyName != "Updated" {
		t.Fatalf("expected updated carrier data, got %s", carrier.CompanyName)
	}

	if requestCount != 2 {
		t.Fatalf("expected two requests, got %d", requestCount)
	}

	if tm.BearerToken() != "new-access" {
		t.Fatalf("expected token manager to update bearer token")
	}
}

func TestPreviewCarrierNoData(t *testing.T) {
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte(`[]`))
	}))
	defer mcpServer.Close()

	cfg := &config.Config{
		MCPAPIURL:        mcpServer.URL,
		TokenEndpointURL: "https://token",
		EnvFilePath:      filepath.Join(t.TempDir(), ".env"),
		BearerToken:      "token",
		RefreshToken:     "refresh",
		ClientID:         "client",
		ClientSecret:     "secret",
	}

	tm := NewTokenManager(cfg)
	client := NewMCPClient(cfg, tm)
	client.httpClient = mcpServer.Client()

	if _, err := client.PreviewCarrier(context.Background(), "123"); err != ErrNoCarrierData {
		t.Fatalf("expected ErrNoCarrierData, got %v", err)
	}
}

func TestPreviewCarrierServerError(t *testing.T) {
	mcpServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusInternalServerError)
	}))
	defer mcpServer.Close()

	cfg := &config.Config{
		MCPAPIURL:        mcpServer.URL,
		TokenEndpointURL: "https://token",
		EnvFilePath:      filepath.Join(t.TempDir(), ".env"),
		BearerToken:      "token",
		RefreshToken:     "refresh",
		ClientID:         "client",
		ClientSecret:     "secret",
	}

	tm := NewTokenManager(cfg)
	client := NewMCPClient(cfg, tm)
	client.httpClient = mcpServer.Client()

	if _, err := client.PreviewCarrier(context.Background(), "123"); err == nil {
		t.Fatalf("expected error when MCP API returns 500")
	}
}
