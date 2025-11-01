package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/slack-go/slack"
	"github.com/slack-go/slack/socketmode"

	"github.com/freightCognition/mcp-slackbot/config"
	"github.com/freightCognition/mcp-slackbot/handlers"
	"github.com/freightCognition/mcp-slackbot/services"
)

func main() {
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("failed to load configuration: %v", err)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	tokenManager := services.NewTokenManager(cfg)
	mcpClient := services.NewMCPClient(cfg, tokenManager)

	debug := strings.EqualFold(os.Getenv("SLACK_DEBUG"), "true")

	api := slack.New(
		cfg.SlackBotToken,
		slack.OptionAppLevelToken(cfg.SlackAppToken),
		slack.OptionDebug(debug),
	)

	client := socketmode.New(
		api,
		socketmode.OptionDebug(debug),
	)

	slashHandler := handlers.NewSlashHandler(api, mcpClient)
	eventHandler := handlers.NewEventHandler()

	go handleSocketModeEvents(ctx, client, slashHandler, eventHandler)
	go startHealthServer(ctx)

	if err := client.Run(); err != nil {
		log.Fatalf("socket mode client exited with error: %v", err)
	}
}

func handleSocketModeEvents(ctx context.Context, client *socketmode.Client, slashHandler *handlers.SlashHandler, eventHandler *handlers.EventHandler) {
	for {
		select {
		case <-ctx.Done():
			return
		case evt, ok := <-client.Events:
			if !ok {
				return
			}

			switch evt.Type {
			case socketmode.EventTypeSlashCommand:
				cmd, ok := evt.Data.(slack.SlashCommand)
				if !ok {
					if evt.Request != nil {
						client.Ack(*evt.Request)
					}
					continue
				}

				if cmd.Command == "/mcp" {
					if evt.Request != nil {
						client.Ack(*evt.Request)
					}
					go slashHandler.HandleMCPCommand(ctx, cmd)
				} else {
					if evt.Request != nil {
						client.Ack(*evt.Request, map[string]interface{}{
							"response_type": "ephemeral",
							"text":          "Unsupported command.",
						})
					}
				}
			default:
				if evt.Request != nil {
					client.Ack(*evt.Request)
				}
				eventHandler.Handle(evt)
			}
		}
	}
}

func startHealthServer(ctx context.Context) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	})

	srv := &http.Server{
		Addr:    ":3001",
		Handler: mux,
	}

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(shutdownCtx); err != nil {
			log.Printf("error shutting down health server: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Printf("health server error: %v", err)
	}
}
