package services

import (
	"encoding/json"
	"fmt"
	"io/ioutil"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"

	"freightCognition/mcp-slackbot/config"
)

// TokenManager handles refreshing and storing the API tokens.
type TokenManager struct {
	config    *config.Config
	bearerToken string
	mutex     sync.Mutex
}

// NewTokenManager creates a new TokenManager.
func NewTokenManager(cfg *config.Config) *TokenManager {
	return &TokenManager{
		config:    cfg,
		bearerToken: cfg.BearerToken,
	}
}

// GetBearerToken returns the current bearer token in a thread-safe way.
func (tm *TokenManager) GetBearerToken() string {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()
	return tm.bearerToken
}

// RefreshToken refreshes the access token.
func (tm *TokenManager) RefreshToken() error {
	tm.mutex.Lock()
	defer tm.mutex.Unlock()

	fmt.Println("Attempting to refresh access token...")

	data := url.Values{}
	data.Set("grant_type", "refresh_token")
	data.Set("refresh_token", tm.config.RefreshToken)
	data.Set("client_id", tm.config.ClientID)
	data.Set("client_secret", tm.config.ClientSecret)

	req, err := http.NewRequest("POST", tm.config.TokenEndpointURL, strings.NewReader(data.Encode()))
	if err != nil {
		return fmt.Errorf("failed to create refresh token request: %w", err)
	}
	req.Header.Add("Content-Type", "application/x-www-form-urlencoded")

	client := &http.Client{}
	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("failed to send refresh token request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("failed to refresh token, status code: %d", resp.StatusCode)
	}

	body, err := ioutil.ReadAll(resp.Body)
	if err != nil {
		return fmt.Errorf("failed to read refresh token response body: %w", err)
	}

	var tokenResponse struct {
		AccessToken  string `json:"access_token"`
		RefreshToken string `json:"refresh_token"`
	}

	if err := json.Unmarshal(body, &tokenResponse); err != nil {
		return fmt.Errorf("failed to unmarshal refresh token response: %w", err)
	}

	if tokenResponse.AccessToken == "" {
		return fmt.Errorf("new access token not found in refresh response")
	}

	tm.bearerToken = tokenResponse.AccessToken
	updateValues := map[string]string{"BEARER_TOKEN": tokenResponse.AccessToken}

	if tokenResponse.RefreshToken != "" && tokenResponse.RefreshToken != tm.config.RefreshToken {
		fmt.Println("New refresh token received.")
		tm.config.RefreshToken = tokenResponse.RefreshToken
		updateValues["REFRESH_TOKEN"] = tokenResponse.RefreshToken
	}

	if err := updateEnvFile(updateValues); err != nil {
		fmt.Printf("Warning: failed to update .env file: %v\n", err)
	}

	fmt.Println("Access token refreshed successfully.")
	return nil
}

// updateEnvFile updates the .env file with new values.
func updateEnvFile(values map[string]string) error {
	envFilePath := ".env"
	input, err := ioutil.ReadFile(envFilePath)
	if err != nil {
		// If .env doesn't exist, we can't update it. This is not a critical error.
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}

	lines := strings.Split(string(input), "\n")
	for i, line := range lines {
		for key, value := range values {
			if strings.HasPrefix(line, key+"=") {
				lines[i] = key + "=" + value
				// Remove the key from the map to avoid adding it again
				delete(values, key)
			}
		}
	}

	// Add any new keys that weren't found
	for key, value := range values {
		lines = append(lines, key+"="+value)
	}

	output := strings.Join(lines, "\n")
	return ioutil.WriteFile(envFilePath, []byte(output), 0644)
}
