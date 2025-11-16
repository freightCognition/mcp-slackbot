package handlers

import (
	"fmt"
	"strings"

	"freightCognition/mcp-slackbot/formatters"
	"freightCognition/mcp-slackbot/services"
	"github.com/slack-go/slack"
)

// SlashCommandHandler handles the /mcp slash command.
type SlashCommandHandler struct {
	mcpClient *services.MCPClient
}

// NewSlashCommandHandler creates a new SlashCommandHandler.
func NewSlashCommandHandler(mcpClient *services.MCPClient) *SlashCommandHandler {
	return &SlashCommandHandler{
		mcpClient: mcpClient,
	}
}

// Handle handles the slash command logic.
func (h *SlashCommandHandler) Handle(api *slack.Client, cmd slack.SlashCommand) {
	if strings.TrimSpace(cmd.Text) == "" {
		_, err := api.PostEphemeral(cmd.ChannelID, cmd.UserID, slack.MsgOptionText("Please provide a valid MC number.", false))
		if err != nil {
			fmt.Printf("Failed to send ephemeral message: %v\n", err)
		}
		return
	}

	mcNumber := strings.TrimSpace(cmd.Text)
	fmt.Printf("Fetching data for MC number: %s\n", mcNumber)

	// Acknowledge the command immediately
	// The function expects a JSON response, so we send an empty JSON object.
	// In a real http handler you would use w.Write([]byte(`{}`))
	// but here we don't have direct access to the writer.
	// The slack-go library handles the ack for us implicitly with socketmode,
	// but we'll send a quick ephemeral message to let the user know we're working on it.
	_, err := api.PostEphemeral(cmd.ChannelID, cmd.UserID, slack.MsgOptionText(fmt.Sprintf("Fetching data for MC %s...", mcNumber), false))
	if err != nil {
		fmt.Printf("Failed to send initial ephemeral message: %v\n", err)
	}

	data, err := h.mcpClient.GetCarrierPreview(mcNumber)
	if err != nil {
		fmt.Printf("Error getting carrier preview: %v\n", err)
		_, postErr := api.PostEphemeral(cmd.ChannelID, cmd.UserID, slack.MsgOptionText(fmt.Sprintf("Error fetching data: %v", err), false))
		if postErr != nil {
			fmt.Printf("Failed to send error message: %v\n", postErr)
		}
		return
	}

	blocks := formatters.BuildSlackResponse(data)

	// Use PostMessage to send the response to the channel.
	// The original used a webhook, but with the bot token we can post directly.
	_, _, err = api.PostMessage(cmd.ChannelID, slack.MsgOptionBlocks(blocks...))
	if err != nil {
		fmt.Printf("Failed to post message: %v\n", err)
	}
}
