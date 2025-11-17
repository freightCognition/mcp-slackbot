package handlers

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/slack-go/slack"

	"github.com/freightCognition/mcp-slackbot/formatters"
	"github.com/freightCognition/mcp-slackbot/services"
)

type SlackPoster interface {
	PostMessageContext(ctx context.Context, channelID string, options ...slack.MsgOption) (string, string, error)
	PostEphemeralContext(ctx context.Context, channelID, userID string, options ...slack.MsgOption) (string, error)
}

type CarrierPreviewer interface {
	PreviewCarrier(ctx context.Context, docketNumber string) (*services.CarrierPreview, error)
}

type SlashHandler struct {
	api     SlackPoster
	preview CarrierPreviewer
}

func NewSlashHandler(api SlackPoster, previewer CarrierPreviewer) *SlashHandler {
	return &SlashHandler{api: api, preview: previewer}
}

func (h *SlashHandler) HandleMCPCommand(ctx context.Context, cmd slack.SlashCommand) error {
	mcNumber := strings.TrimSpace(cmd.Text)
	if mcNumber == "" {
		return h.postEphemeral(ctx, cmd, "Please provide a valid MC number.")
	}

	timeoutCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()

	preview, err := h.preview.PreviewCarrier(timeoutCtx, mcNumber)
	if err != nil {
		switch {
		case err == services.ErrNoData:
			return h.postEphemeral(ctx, cmd, "No data found for the provided MC number.")
		default:
			return h.postEphemeral(ctx, cmd, "Error fetching data. Please try again later.")
		}
	}

	blocks := formatters.BuildCarrierBlocks(preview)
	if len(blocks) == 0 {
		return h.postEphemeral(ctx, cmd, "No data available to display.")
	}

	channelCtx, cancelMsg := context.WithTimeout(ctx, 5*time.Second)
	defer cancelMsg()

	text := fmt.Sprintf("Carrier risk assessment for MC %s", mcNumber)
	_, _, err = h.api.PostMessageContext(channelCtx, cmd.ChannelID,
		slack.MsgOptionText(text, false),
		slack.MsgOptionBlocks(blocks...),
	)
	if err != nil {
		_ = h.postEphemeral(ctx, cmd, "Failed to post assessment to channel.")
		return fmt.Errorf("post message: %w", err)
	}

	return nil
}

func (h *SlashHandler) postEphemeral(ctx context.Context, cmd slack.SlashCommand, message string) error {
	if strings.TrimSpace(message) == "" {
		return nil
	}
	_, err := h.api.PostEphemeralContext(ctx, cmd.ChannelID, cmd.UserID, slack.MsgOptionText(message, false))
	return err
}
