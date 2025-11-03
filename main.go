package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os/signal"
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

	api := slack.New(
		cfg.SlackBotToken,
		slack.OptionAppLevelToken(cfg.SlackAppToken),
	)

	socketClient := socketmode.New(api)

	tokenManager := services.NewTokenManager(cfg, nil)
	mcpAPI := services.NewMCPAPI(cfg, tokenManager, nil)
	slashHandler := handlers.NewSlashHandler(api, mcpAPI)

	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	go serveHealth(ctx, cfg.HealthPort)

	go func() {
		for {
			select {
			case <-ctx.Done():
				return
			case evt := <-socketClient.Events:
				handleEvent(ctx, socketClient, slashHandler, evt)
			}
		}
	}()

	if err := socketClient.RunContext(ctx); err != nil && !errors.Is(err, context.Canceled) {
		log.Fatalf("socket mode client error: %v", err)
	}
}

func handleEvent(ctx context.Context, client *socketmode.Client, handler *handlers.SlashHandler, evt socketmode.Event) {
	switch evt.Type {
	case socketmode.EventTypeSlashCommand:
		cmd, ok := evt.Data.(slack.SlashCommand)
		if !ok {
			client.Ack(*evt.Request)
			return
		}

		client.Ack(*evt.Request)
		if cmd.Command != "/mcp" {
			return
		}

		go func(command slack.SlashCommand) {
			if err := handler.HandleMCPCommand(ctx, command); err != nil {
				log.Printf("handle slash command error: %v", err)
			}
		}(cmd)
	default:
		if evt.Request != nil {
			client.Ack(*evt.Request)
		}
	}
}

func serveHealth(ctx context.Context, port int) {
	mux := http.NewServeMux()
	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"status": "healthy"})
	})

	srv := &http.Server{
		Addr:         fmt.Sprintf(":%d", port),
		Handler:      mux,
		ReadTimeout:  5 * time.Second,
		WriteTimeout: 5 * time.Second,
	}

	go func() {
		<-ctx.Done()
		ctxShutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := srv.Shutdown(ctxShutdown); err != nil {
			log.Printf("health server shutdown error: %v", err)
		}
	}()

	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Printf("health server error: %v", err)
	}
}
