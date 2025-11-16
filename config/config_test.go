package config

import (
	"os"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	// Set up mock environment variables
	os.Setenv("SLACK_APP_TOKEN", "test_app_token")
	os.Setenv("SLACK_BOT_TOKEN", "test_bot_token")
	os.Setenv("BEARER_TOKEN", "test_bearer_token")
	os.Setenv("REFRESH_TOKEN", "test_refresh_token")
	os.Setenv("TOKEN_ENDPOINT_URL", "http://localhost/token")
	os.Setenv("CLIENT_ID", "test_client_id")
	os.Setenv("CLIENT_SECRET", "test_client_secret")

	cfg, err := LoadConfig()
	if err != nil {
		t.Fatalf("Expected no error, but got %v", err)
	}

	if cfg.SlackAppToken != "test_app_token" {
		t.Errorf("Expected SLACK_APP_TOKEN to be 'test_app_token', but got '%s'", cfg.SlackAppToken)
	}
	if cfg.SlackBotToken != "test_bot_token" {
		t.Errorf("Expected SLACK_BOT_TOKEN to be 'test_bot_token', but got '%s'", cfg.SlackBotToken)
	}

	// Unset a required variable to test for an error
	os.Unsetenv("SLACK_APP_TOKEN")
	_, err = LoadConfig()
	if err == nil {
		t.Error("Expected an error when a required environment variable is not set, but got nil")
	}
}
