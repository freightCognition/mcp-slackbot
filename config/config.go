package config

import (
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/joho/godotenv"
)

type Config struct {
	SlackAppToken    string
	SlackBotToken    string
	BearerToken      string
	RefreshToken     string
	TokenEndpointURL string
	ClientID         string
	ClientSecret     string
	HealthPort       int
	MCPPreviewURL    string
	EnvFilePath      string
}

func Load() (*Config, error) {
	_ = godotenv.Load()

	required := map[string]string{
		"SLACK_APP_TOKEN":    os.Getenv("SLACK_APP_TOKEN"),
		"SLACK_BOT_TOKEN":    os.Getenv("SLACK_BOT_TOKEN"),
		"BEARER_TOKEN":       os.Getenv("BEARER_TOKEN"),
		"REFRESH_TOKEN":      os.Getenv("REFRESH_TOKEN"),
		"TOKEN_ENDPOINT_URL": os.Getenv("TOKEN_ENDPOINT_URL"),
		"CLIENT_ID":          os.Getenv("CLIENT_ID"),
		"CLIENT_SECRET":      os.Getenv("CLIENT_SECRET"),
	}

	missing := make([]string, 0)
	for key, val := range required {
		if strings.TrimSpace(val) == "" {
			missing = append(missing, key)
		}
	}

	if len(missing) > 0 {
		return nil, fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}

	port, err := strconv.Atoi(defaultString(os.Getenv("HEALTH_PORT"), "3001"))
	if err != nil {
		return nil, fmt.Errorf("invalid HEALTH_PORT: %w", err)
	}

	envPath := defaultString(os.Getenv("ENV_FILE_PATH"), ".env")
	absEnvPath, err := filepath.Abs(envPath)
	if err != nil {
		return nil, fmt.Errorf("failed to resolve Env path: %w", err)
	}

	return &Config{
		SlackAppToken:    required["SLACK_APP_TOKEN"],
		SlackBotToken:    required["SLACK_BOT_TOKEN"],
		BearerToken:      required["BEARER_TOKEN"],
		RefreshToken:     required["REFRESH_TOKEN"],
		TokenEndpointURL: required["TOKEN_ENDPOINT_URL"],
		ClientID:         required["CLIENT_ID"],
		ClientSecret:     required["CLIENT_SECRET"],
		HealthPort:       port,
		MCPPreviewURL:    defaultString(os.Getenv("MCP_PREVIEW_URL"), "https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier"),
		EnvFilePath:      absEnvPath,
	}, nil
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
