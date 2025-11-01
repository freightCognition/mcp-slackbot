package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/joho/godotenv"
)

// Config holds the configuration values required by the application.
type Config struct {
	SlackAppToken    string
	SlackBotToken    string
	BearerToken      string
	RefreshToken     string
	TokenEndpointURL string
	ClientID         string
	ClientSecret     string
	MCPAPIURL        string
	EnvFilePath      string
}

const defaultMCPAPIURL = "https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier"

// Load loads environment variables and validates that all required values are present.
func Load() (*Config, error) {
	envPath := defaultEnvPath()

	// Attempt to load the .env file if present. Ignore missing file errors so that
	// the application can rely on environment variables in production.
	if err := godotenv.Load(envPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("loading env file: %w", err)
	}

	cfg := &Config{
		SlackAppToken:    strings.TrimSpace(os.Getenv("SLACK_APP_TOKEN")),
		SlackBotToken:    strings.TrimSpace(os.Getenv("SLACK_BOT_TOKEN")),
		BearerToken:      strings.TrimSpace(os.Getenv("BEARER_TOKEN")),
		RefreshToken:     strings.TrimSpace(os.Getenv("REFRESH_TOKEN")),
		TokenEndpointURL: strings.TrimSpace(os.Getenv("TOKEN_ENDPOINT_URL")),
		ClientID:         strings.TrimSpace(os.Getenv("CLIENT_ID")),
		ClientSecret:     strings.TrimSpace(os.Getenv("CLIENT_SECRET")),
		MCPAPIURL:        strings.TrimSpace(os.Getenv("MCP_API_URL")),
		EnvFilePath:      envPath,
	}

	if cfg.MCPAPIURL == "" {
		cfg.MCPAPIURL = defaultMCPAPIURL
	}

	if err := cfg.validate(); err != nil {
		return nil, err
	}

	return cfg, nil
}

func (c *Config) validate() error {
	missing := []string{}
	required := map[string]string{
		"SLACK_APP_TOKEN":    c.SlackAppToken,
		"SLACK_BOT_TOKEN":    c.SlackBotToken,
		"BEARER_TOKEN":       c.BearerToken,
		"REFRESH_TOKEN":      c.RefreshToken,
		"TOKEN_ENDPOINT_URL": c.TokenEndpointURL,
		"CLIENT_ID":          c.ClientID,
		"CLIENT_SECRET":      c.ClientSecret,
	}

	for key, value := range required {
		if value == "" {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	return nil
}

func defaultEnvPath() string {
	exe, err := os.Executable()
	if err != nil {
		return ".env"
	}

	dir := filepath.Dir(exe)
	candidate := filepath.Join(dir, ".env")
	if _, err := os.Stat(candidate); err == nil {
		return candidate
	}

	// Fallback to working directory when .env is located alongside source files
	return ".env"
}
