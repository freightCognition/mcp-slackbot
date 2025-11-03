package formatters

import (
	"fmt"
	"strings"

	"github.com/slack-go/slack"

	"github.com/freightCognition/mcp-slackbot/services"
)

func RiskLevelEmoji(points int) string {
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

func RiskLevel(points int) string {
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

func FormatInfractions(infractions []services.Infraction) string {
	if len(infractions) == 0 {
		return "No infractions found."
	}

	lines := make([]string, 0, len(infractions))
	for _, inf := range infractions {
		lines = append(lines, fmt.Sprintf("- %s: %s (%d points)", inf.RuleText, inf.RuleOutput, inf.Points))
	}
	return strings.Join(lines, "\n")
}

func BuildCarrierBlocks(preview *services.CarrierPreview) []slack.Block {
	if preview == nil {
		return nil
	}

	blocks := []slack.Block{
		slack.NewHeaderBlock(slack.NewTextBlockObject(slack.PlainTextType, "MyCarrierPortal Risk Assessment", true, false)),
		slack.NewSectionBlock(
			slack.NewTextBlockObject(slack.MarkdownType,
				fmt.Sprintf("*%s*\nDOT: %s / MC: %s", fallback(preview.CompanyName), fallback(preview.DotNumber), fallback(preview.DocketNumber)),
				false,
				false,
			),
			nil,
			nil,
		),
	}

	if details := preview.RiskAssessmentDetails; details != nil {
		totalPoints := details.TotalPoints
		summary := slack.NewSectionBlock(
			slack.NewTextBlockObject(slack.MarkdownType,
				fmt.Sprintf("*Overall assessment:* %s %s", RiskLevelEmoji(totalPoints), RiskLevel(totalPoints)),
				false,
				false,
			), nil, nil)
		blocks = append(blocks,
			summary,
			slack.NewContextBlock("total_points",
				slack.NewTextBlockObject(slack.MarkdownType,
					fmt.Sprintf("Total Points: %d", totalPoints), false, false),
			),
			slack.NewDividerBlock(),
		)

		categories := []struct {
			name string
			data *services.RiskCategory
		}{
			{"Authority", details.Authority},
			{"Insurance", details.Insurance},
			{"Operation", details.Operation},
			{"Safety", details.Safety},
			{"Other", details.Other},
		}

		for _, cat := range categories {
			if cat.data == nil {
				continue
			}

			points := cat.data.TotalPoints
			blocks = append(blocks,
				slack.NewSectionBlock(
					slack.NewTextBlockObject(slack.MarkdownType,
						fmt.Sprintf("*%s:* %s %s", cat.name, RiskLevelEmoji(points), RiskLevel(points)),
						false,
						false,
					),
					nil,
					nil,
				),
				slack.NewContextBlock(
					cat.name+"_context",
					slack.NewTextBlockObject(slack.MarkdownType,
						fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s", RiskLevel(points), points, FormatInfractions(cat.data.Infractions)),
						false,
						false,
					),
				),
			)
		}
	}

	mcpPoints := 0
	infractions := make([]services.Infraction, 0, 2)
	if preview.IsBlocked {
		mcpPoints += 1000
		infractions = append(infractions, services.Infraction{
			Points:     1000,
			RuleText:   "MyCarrierProtect: Blocked",
			RuleOutput: "Carrier blocked by 3 or more companies",
		})
	}
	if strings.EqualFold(preview.FreightValidateStatus, "Review Recommended") {
		mcpPoints += 1000
		infractions = append(infractions, services.Infraction{
			Points:     1000,
			RuleText:   "FreightValidate Status",
			RuleOutput: "Carrier has a FreightValidate Review Recommended status",
		})
	}

	if mcpPoints > 0 {
		blocks = append(blocks,
			slack.NewSectionBlock(
				slack.NewTextBlockObject(slack.MarkdownType,
					fmt.Sprintf("*MyCarrierProtect:* %s %s", RiskLevelEmoji(mcpPoints), RiskLevel(mcpPoints)),
					false,
					false,
				),
				nil,
				nil,
			),
			slack.NewContextBlock(
				"mcp_context",
				slack.NewTextBlockObject(slack.MarkdownType,
					fmt.Sprintf("Risk Level: %s | Points: %d\nInfractions:\n%s", RiskLevel(mcpPoints), mcpPoints, FormatInfractions(infractions)),
					false,
					false,
				),
			),
			slack.NewDividerBlock(),
		)
	}

	return blocks
}

func fallback(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "N/A"
	}
	return value
}
