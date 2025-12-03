package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"

	"github.com/freightCognition/mcp-slackbot/config"
)

type TokenManager struct {
	mu            sync.RWMutex
	httpClient    *http.Client
	envFilePath   string
	tokenEndpoint string
	clientID      string
	clientSecret  string
	bearerToken   string
	refreshToken  string
}

type RefreshResult struct {
	Success         bool
	NewRefreshToken bool
}

func NewTokenManager(cfg *config.Config, client *http.Client) *TokenManager {
	cl := client
	if cl == nil {
		cl = &http.Client{Timeout: 10 * time.Second}
	}

	return &TokenManager{
		httpClient:    cl,
		envFilePath:   cfg.EnvFilePath,
		tokenEndpoint: cfg.TokenEndpointURL,
		clientID:      cfg.ClientID,
		clientSecret:  cfg.ClientSecret,
		bearerToken:   cfg.BearerToken,
		refreshToken:  cfg.RefreshToken,
	}
}

func (tm *TokenManager) BearerToken() string {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	return tm.bearerToken
}

func (tm *TokenManager) RefreshToken() string {
	tm.mu.RLock()
	defer tm.mu.RUnlock()
	return tm.refreshToken
}

func (tm *TokenManager) Refresh(ctx context.Context) (*RefreshResult, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", tm.refreshToken)
	data.Set("client_id", tm.clientID)
	data.Set("client_secret", tm.clientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tm.tokenEndpoint, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("create refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := tm.httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("execute refresh request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return &RefreshResult{Success: false}, fmt.Errorf("refresh request failed with status %d", resp.StatusCode)
	}

	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, fmt.Errorf("decode refresh response: %w", err)
	}

	if payload.AccessToken == "" {
		return nil, errors.New("refresh response missing access_token")
	}

	updates := map[string]string{"BEARER_TOKEN": payload.AccessToken}
	if payload.RefreshToken != "" {
		updates["REFRESH_TOKEN"] = payload.RefreshToken
	}

	if err := tm.updateEnvFile(updates); err != nil {
		return nil, fmt.Errorf("update env file: %w", err)
	}

	if payload.RefreshToken != "" {
		tm.refreshToken = payload.RefreshToken
		os.Setenv("REFRESH_TOKEN", payload.RefreshToken)
	}

	tm.bearerToken = payload.AccessToken
	os.Setenv("BEARER_TOKEN", payload.AccessToken)

	return &RefreshResult{Success: true, NewRefreshToken: payload.RefreshToken != ""}, nil
}

func (tm *TokenManager) updateEnvFile(values map[string]string) error {
	existing := map[string]string{}
	if _, err := os.Stat(tm.envFilePath); err == nil {
		loaded, err := godotenv.Read(tm.envFilePath)
		if err != nil {
			return err
		}
		existing = loaded
	}

	for k, v := range values {
		existing[k] = v
	}

	return godotenv.Write(existing, tm.envFilePath)
}
