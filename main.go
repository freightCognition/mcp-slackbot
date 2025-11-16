package main

import (
	"fmt"
	"log"
	"net/http"
	"os"

	"freightCognition/mcp-slackbot/config"
	"freightCognition/mcp-slackbot/handlers"
	"freightCognition/mcp-slackbot/services"
	"github.com/slack-go/slack"
	"github.com/slack-go/slack/socketmode"
)

func main() {
	cfg, err := config.LoadConfig()
	if err != nil {
		log.Fatalf("Failed to load configuration: %v", err)
	}

	api := slack.New(
		cfg.SlackBotToken,
		slack.OptionAppLevelToken(cfg.SlackAppToken),
		slack.OptionDebug(true),
	)

	client := socketmode.New(
		api,
		socketmode.OptionDebug(true),
		socketmode.OptionLog(log.New(os.Stdout, "socketmode: ", log.Lshortfile|log.LstdFlags)),
	)

	tokenManager := services.NewTokenManager(cfg)
	mcpClient := services.NewMCPClient(tokenManager)
	slashHandler := handlers.NewSlashCommandHandler(mcpClient)

	// Start health check server
	go func() {
		http.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
			w.Write([]byte("OK"))
		})
		fmt.Println("Health check server listening on :3001")
		if err := http.ListenAndServe(":3001", nil); err != nil {
			log.Fatalf("Failed to start health check server: %v", err)
		}
	}()

	go func() {
		for evt := range client.Events {
			switch evt.Type {
			case socketmode.EventTypeSlashCommand:
				cmd, ok := evt.Data.(slack.SlashCommand)
				if !ok {
					log.Printf("Ignored unexpected event type: %v", evt.Type)
					continue
				}
				client.Ack(*evt.Request)
				if cmd.Command == "/mcp" {
					go slashHandler.Handle(api, cmd)
				}
			}
		}
	}()

	fmt.Println("Slack bot is running.")
	if err := client.Run(); err != nil {
		log.Fatalf("Failed to run socketmode client: %v", err)
	}
}
