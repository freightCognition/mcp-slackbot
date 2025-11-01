package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/slack-go/slack"

	"github.com/freightCognition/mcp-slackbot/formatters"
	"github.com/freightCognition/mcp-slackbot/services"
)

// SlashHandler routes slash command invocations to the appropriate business logic.
type SlackAPI interface {
	PostMessage(channel string, options ...slack.MsgOption) (string, string, error)
	PostEphemeral(channel, user string, options ...slack.MsgOption) (string, error)
}

type MCPService interface {
	PreviewCarrier(ctx context.Context, docketNumber string) (*services.Carrier, error)
}

type SlashHandler struct {
	api       SlackAPI
	mcpClient MCPService
}

// NewSlashHandler constructs a SlashHandler instance.
func NewSlashHandler(api SlackAPI, mcpClient MCPService) *SlashHandler {
	return &SlashHandler{api: api, mcpClient: mcpClient}
}

// HandleMCPCommand processes the /mcp slash command payload.
func (h *SlashHandler) HandleMCPCommand(ctx context.Context, cmd slack.SlashCommand) {
	mcNumber := strings.TrimSpace(cmd.Text)
	if mcNumber == "" {
		h.postEphemeral(cmd, "Please provide a valid MC number.")
		return
	}

	reqCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	carrier, err := h.mcpClient.PreviewCarrier(reqCtx, mcNumber)
	if err != nil {
		if errors.Is(err, services.ErrNoCarrierData) {
			h.postEphemeral(cmd, "No data found for the provided MC number.")
			return
		}

		log.Printf("error fetching carrier data: %v", err)
		h.postEphemeral(cmd, "Error fetching data. Please try again later.")
		return
	}

	if err := h.postCarrierSummary(cmd, carrier); err != nil {
		log.Printf("error posting Slack message: %v", err)
		h.postEphemeral(cmd, "Unable to post results to Slack. Please try again later.")
	}
}

func (h *SlashHandler) postCarrierSummary(cmd slack.SlashCommand, carrier *services.Carrier) error {
	totalPoints := carrier.RiskAssessmentDetails.TotalPoints
	header := slack.NewHeaderBlock(slack.NewTextBlockObject("plain_text", "MyCarrierPortal Risk Assessment", true, false))

	companyLine := fmt.Sprintf("*%s*\nDOT: %s / MC: %s",
		valueOrDefault(carrier.CompanyName, "N/A"),
		valueOrDefault(carrier.DotNumber, "N/A"),
		valueOrDefault(carrier.DocketNumber, "N/A"),
	)

	overallLine := fmt.Sprintf("*Overall assessment:* %s %s",
		formatters.RiskLevelEmoji(totalPoints),
		formatters.RiskLevel(totalPoints),
	)

	totalPointsLine := slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Total Points: %d", totalPoints), false, false)

	blocks := []slack.Block{
		header,
		slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", companyLine, false, false), nil, nil),
		slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", overallLine, false, false), nil, nil),
		slack.NewContextBlock("", totalPointsLine),
		slack.NewDividerBlock(),
	}

	categoryOrder := []struct {
		Name string
		Data *services.RiskCategory
	}{
		{Name: "Authority", Data: carrier.RiskAssessmentDetails.Authority},
		{Name: "Insurance", Data: carrier.RiskAssessmentDetails.Insurance},
		{Name: "Operation", Data: carrier.RiskAssessmentDetails.Operation},
		{Name: "Safety", Data: carrier.RiskAssessmentDetails.Safety},
		{Name: "Other", Data: carrier.RiskAssessmentDetails.Other},
	}

	for _, category := range categoryOrder {
		if category.Data == nil {
			continue
		}

		categoryPoints := category.Data.TotalPoints
		sectionText := fmt.Sprintf("*%s:* %s %s", category.Name, formatters.RiskLevelEmoji(categoryPoints), formatters.RiskLevel(categoryPoints))
		blocks = append(blocks, slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", sectionText, false, false), nil, nil))

		infractions := convertInfractions(category.Data.Infractions)
		contextText := slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s",
			formatters.RiskLevel(categoryPoints),
			categoryPoints,
			formatters.FormatInfractions(infractions),
		), false, false)

		blocks = append(blocks, slack.NewContextBlock("", contextText))
	}

	// MyCarrierProtect derived section
	protectPoints := 0
	infractions := make([]formatters.Infraction, 0, 2)
	if carrier.IsBlocked {
		protectPoints += 1000
		infractions = append(infractions, formatters.Infraction{
			Points:     1000,
			RuleText:   "MyCarrierProtect: Blocked",
			RuleOutput: "Carrier blocked by 3 or more companies",
		})
	}
	if strings.EqualFold(carrier.FreightValidateStatus, "Review Recommended") {
		protectPoints += 1000
		infractions = append(infractions, formatters.Infraction{
			Points:     1000,
			RuleText:   "FreightValidate Status",
			RuleOutput: "Carrier has a FreightValidate Review Recommended status",
		})
	}

	if protectPoints > 0 {
		protectHeader := fmt.Sprintf("*MyCarrierProtect:* %s %s", formatters.RiskLevelEmoji(protectPoints), formatters.RiskLevel(protectPoints))
		blocks = append(blocks, slack.NewSectionBlock(slack.NewTextBlockObject("mrkdwn", protectHeader, false, false), nil, nil))

		contextText := slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s",
			formatters.RiskLevel(protectPoints),
			protectPoints,
			formatters.FormatInfractions(infractions),
		), false, false)

		blocks = append(blocks, slack.NewContextBlock("", contextText), slack.NewDividerBlock())
	}

	_, _, err := h.api.PostMessage(cmd.ChannelID, slack.MsgOptionBlocks(blocks...))
	return err
}

func (h *SlashHandler) postEphemeral(cmd slack.SlashCommand, message string) {
	if _, err := h.api.PostEphemeral(cmd.ChannelID, cmd.UserID, slack.MsgOptionText(message, false)); err != nil {
		log.Printf("error sending ephemeral message: %v", err)
	}
}

func convertInfractions(infractions []services.Infraction) []formatters.Infraction {
	if len(infractions) == 0 {
		return nil
	}

	formatted := make([]formatters.Infraction, 0, len(infractions))
	for _, infraction := range infractions {
		formatted = append(formatted, formatters.Infraction{
			RuleText:   infraction.RuleText,
			RuleOutput: infraction.RuleOutput,
			Points:     infraction.Points,
		})
	}

	return formatted
}

func valueOrDefault(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}
