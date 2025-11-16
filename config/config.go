package config

import (
	"fmt"
	"os"

	"github.com/joho/godotenv"
)

// Config holds the application's configuration.
type Config struct {
	SlackAppToken    string
	SlackBotToken    string
	BearerToken      string
	RefreshToken     string
	TokenEndpointURL string
	ClientID         string
	ClientSecret     string
}

// LoadConfig loads configuration from environment variables.
func LoadConfig() (*Config, error) {
	// Load .env file. In a production environment, variables should be set directly.
	godotenv.Load()

	cfg := &Config{
		SlackAppToken:    os.Getenv("SLACK_APP_TOKEN"),
		SlackBotToken:    os.Getenv("SLACK_BOT_TOKEN"),
		BearerToken:      os.Getenv("BEARER_TOKEN"),
		RefreshToken:     os.Getenv("REFRESH_TOKEN"),
		TokenEndpointURL: os.Getenv("TOKEN_ENDPOINT_URL"),
		ClientID:         os.Getenv("CLIENT_ID"),
		ClientSecret:     os.Getenv("CLIENT_SECRET"),
	}

	// Validate required variables
	if cfg.SlackAppToken == "" {
		return nil, fmt.Errorf("SLACK_APP_TOKEN is not set")
	}
	if cfg.SlackBotToken == "" {
		return nil, fmt.Errorf("SLACK_BOT_TOKEN is not set")
	}
	if cfg.BearerToken == "" {
		return nil, fmt.Errorf("BEARER_TOKEN is not set")
	}
	if cfg.RefreshToken == "" {
		return nil, fmt.Errorf("REFRESH_TOKEN is not set")
	}
	if cfg.TokenEndpointURL == "" {
		return nil, fmt.Errorf("TOKEN_ENDPOINT_URL is not set")
	}
	if cfg.ClientID == "" {
		return nil, fmt.Errorf("CLIENT_ID is not set")
	}
	if cfg.ClientSecret == "" {
		return nil, fmt.Errorf("CLIENT_SECRET is not set")
	}

	return cfg, nil
}
