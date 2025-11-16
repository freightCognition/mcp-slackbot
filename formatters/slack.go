package formatters

import (
	"fmt"
	"strings"

	"freightCognition/mcp-slackbot/services"
	"github.com/slack-go/slack"
)

// GetRiskLevelEmoji returns the emoji corresponding to the risk points.
func GetRiskLevelEmoji(points int) string {
	switch {
	case points >= 0 && points <= 124:
		return "🟢"
	case points >= 125 && points <= 249:
		return "🟡"
	case points >= 250 && points <= 999:
		return "🟠"
	default:
		return "🔴"
	}
}

// GetRiskLevel returns the risk level string corresponding to the points.
func GetRiskLevel(points int) string {
	switch {
	case points >= 0 && points <= 124:
		return "Low"
	case points >= 125 && points <= 249:
		return "Medium"
	case points >= 250 && points <= 999:
		return "Review Required"
	default:
		return "Fail"
	}
}

// FormatInfractions formats the list of infractions into a string.
func FormatInfractions(infractions []services.Infraction) string {
	if len(infractions) == 0 {
		return "No infractions found."
	}
	var builder strings.Builder
	for _, infraction := range infractions {
		builder.WriteString(fmt.Sprintf("- %s: %s (%d points)\n", infraction.RuleText, infraction.RuleOutput, infraction.Points))
	}
	return builder.String()
}

// BuildSlackResponse builds the Slack message blocks for the response.
func BuildSlackResponse(data *services.CarrierPreviewResponse) []slack.Block {
	if data == nil {
		return []slack.Block{
			slack.NewSectionBlock(
				slack.NewTextBlockObject("mrkdwn", "No data found for the provided MC number.", false, false),
				nil,
				nil,
			),
		}
	}

	blocks := []slack.Block{
		slack.NewHeaderBlock(
			slack.NewTextBlockObject("plain_text", "MyCarrierPortal Risk Assessment", true, false),
		),
		slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*%s*\nDOT: %s / MC: %s", data.CompanyName, data.DotNumber, data.DocketNumber), false, false),
			nil,
			nil,
		),
		slack.NewSectionBlock(
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*Overall assessment:* %s %s", GetRiskLevelEmoji(data.RiskAssessmentDetails.TotalPoints), GetRiskLevel(data.RiskAssessmentDetails.TotalPoints)), false, false),
			nil,
			nil,
		),
		slack.NewContextBlock("",
			slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Total Points: %d", data.RiskAssessmentDetails.TotalPoints), false, false),
		),
		slack.NewDividerBlock(),
	}

	categories := map[string]services.CategoryDetails{
		"Authority":   data.RiskAssessmentDetails.Authority,
		"Insurance":   data.RiskAssessmentDetails.Insurance,
		"Operation":   data.RiskAssessmentDetails.Operation,
		"Safety":      data.RiskAssessmentDetails.Safety,
		"Other":       data.RiskAssessmentDetails.Other,
	}

	for name, category := range categories {
		if category.TotalPoints > 0 || len(category.Infractions) > 0 {
			blocks = append(blocks,
				slack.NewSectionBlock(
					slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*%s:* %s %s", name, GetRiskLevelEmoji(category.TotalPoints), GetRiskLevel(category.TotalPoints)), false, false),
					nil,
					nil,
				),
				slack.NewContextBlock("",
					slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s", GetRiskLevel(category.TotalPoints), category.TotalPoints, FormatInfractions(category.Infractions)), false, false),
				),
			)
		}
	}

	// MyCarrierProtect section
	mcpPoints := 0
	var mcpInfractions []services.Infraction
	if data.IsBlocked {
		mcpPoints += 1000
		mcpInfractions = append(mcpInfractions, services.Infraction{
			Points:     1000,
			RuleText:   "MyCarrierProtect: Blocked",
			RuleOutput: "Carrier blocked by 3 or more companies",
		})
	}
	if data.FreightValidateStatus == "Review Recommended" {
		mcpPoints += 1000
		mcpInfractions = append(mcpInfractions, services.Infraction{
			Points:     1000,
			RuleText:   "FreightValidate Status",
			RuleOutput: "Carrier has a FreightValidate Review Recommended status",
		})
	}

	if mcpPoints > 0 {
		mcpRating := GetRiskLevel(mcpPoints)
		blocks = append(blocks,
			slack.NewSectionBlock(
				slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("*MyCarrierProtect:* %s %s", GetRiskLevelEmoji(mcpPoints), mcpRating), false, false),
				nil,
				nil,
			),
			slack.NewContextBlock("",
				slack.NewTextBlockObject("mrkdwn", fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s", mcpRating, mcpPoints, FormatInfractions(mcpInfractions)), false, false),
			),
			slack.NewDividerBlock(),
		)
	}

	return blocks
}
