package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/joho/godotenv"

	"github.com/freightCognition/mcp-slackbot/config"
)

// TokenManager coordinates access token refreshes and .env persistence.
type TokenManager struct {
	mu           sync.Mutex
	cfg          *config.Config
	httpClient   *http.Client
	bearerToken  string
	refreshToken string
}

// NewTokenManager creates a new TokenManager instance using the provided configuration.
func NewTokenManager(cfg *config.Config) *TokenManager {
	return &TokenManager{
		cfg: cfg,
		httpClient: &http.Client{
			Timeout: 10 * time.Second,
		},
		bearerToken:  cfg.BearerToken,
		refreshToken: cfg.RefreshToken,
	}
}

// BearerToken returns the current bearer token in a thread-safe manner.
func (tm *TokenManager) BearerToken() string {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	return tm.bearerToken
}

// RefreshToken returns the current refresh token.
func (tm *TokenManager) RefreshToken() string {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	return tm.refreshToken
}

// UpdateBearerToken allows callers to update the bearer token without refreshing.
func (tm *TokenManager) UpdateBearerToken(token string) {
	tm.mu.Lock()
	defer tm.mu.Unlock()
	tm.bearerToken = token
}

// RefreshAccessToken refreshes the access token, updating the in-memory values and .env file.
func (tm *TokenManager) RefreshAccessToken(ctx context.Context) (bool, error) {
	tm.mu.Lock()
	defer tm.mu.Unlock()

	log.Println("Attempting to refresh access token...")

	values := url.Values{}
	values.Set("grant_type", "refresh_token")
	values.Set("refresh_token", tm.refreshToken)
	values.Set("client_id", tm.cfg.ClientID)
	values.Set("client_secret", tm.cfg.ClientSecret)

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, tm.cfg.TokenEndpointURL, strings.NewReader(values.Encode()))
	if err != nil {
		return false, fmt.Errorf("creating refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := tm.httpClient.Do(req)
	if err != nil {
		return false, fmt.Errorf("refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 400 {
		return false, fmt.Errorf("refresh request returned status %d", resp.StatusCode)
	}

	var payload struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return false, fmt.Errorf("decoding refresh response: %w", err)
	}

	if payload.AccessToken == "" {
		return false, errors.New("refresh response did not include an access_token")
	}

	tm.bearerToken = payload.AccessToken
	tm.cfg.BearerToken = payload.AccessToken
	os.Setenv("BEARER_TOKEN", payload.AccessToken)

	newRefreshTokenIssued := false
	if payload.RefreshToken != "" {
		tm.refreshToken = payload.RefreshToken
		tm.cfg.RefreshToken = payload.RefreshToken
		os.Setenv("REFRESH_TOKEN", payload.RefreshToken)
		newRefreshTokenIssued = true
	}

	if err := tm.writeEnvFile(payload.AccessToken, payload.RefreshToken); err != nil {
		log.Printf("warning: failed to update .env file: %v", err)
	}

	log.Println("Access token refreshed successfully.")
	return newRefreshTokenIssued, nil
}

func (tm *TokenManager) writeEnvFile(accessToken, refreshToken string) error {
	envPath := tm.cfg.EnvFilePath
	envMap := map[string]string{}

	existing, err := godotenv.Read(envPath)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return fmt.Errorf("reading env file: %w", err)
		}
	} else {
		envMap = existing
	}

	envMap["BEARER_TOKEN"] = accessToken
	if refreshToken != "" {
		envMap["REFRESH_TOKEN"] = refreshToken
	} else if tm.refreshToken != "" {
		envMap["REFRESH_TOKEN"] = tm.refreshToken
	}

	if err := godotenv.Write(envMap, envPath); err != nil {
		return fmt.Errorf("writing env file: %w", err)
	}

	return nil
}
