package formatters_test

import (
	"testing"

	"github.com/slack-go/slack"
	"github.com/stretchr/testify/require"

	"github.com/freightCognition/mcp-slackbot/formatters"
	"github.com/freightCognition/mcp-slackbot/services"
)

func TestRiskLevelFunctions(t *testing.T) {
	require.Equal(t, "🟢", formatters.RiskLevelEmoji(50))
	require.Equal(t, "🟡", formatters.RiskLevelEmoji(200))
	require.Equal(t, "🟠", formatters.RiskLevelEmoji(300))
	require.Equal(t, "🔴", formatters.RiskLevelEmoji(1200))

	require.Equal(t, "Low", formatters.RiskLevel(50))
	require.Equal(t, "Medium", formatters.RiskLevel(200))
	require.Equal(t, "Review Required", formatters.RiskLevel(300))
	require.Equal(t, "Fail", formatters.RiskLevel(1200))
}

func TestFormatInfractions(t *testing.T) {
	text := formatters.FormatInfractions([]services.Infraction{{
		RuleText:   "Rule",
		RuleOutput: "Output",
		Points:     10,
	}})
	require.Contains(t, text, "Rule: Output (10 points)")
	require.Equal(t, "No infractions found.", formatters.FormatInfractions(nil))
}

func TestBuildCarrierBlocks(t *testing.T) {
	preview := &services.CarrierPreview{
		CompanyName:  "Carrier",
		DotNumber:    "DOT123",
		DocketNumber: "MC456",
		RiskAssessmentDetails: &services.RiskAssessmentDetail{
			TotalPoints: 50,
			Authority: &services.RiskCategory{
				TotalPoints: 70,
				Infractions: []services.Infraction{{RuleText: "Rule", RuleOutput: "Output", Points: 5}},
			},
		},
		IsBlocked:             true,
		FreightValidateStatus: "Review Recommended",
	}

	blocks := formatters.BuildCarrierBlocks(preview)
	require.NotEmpty(t, blocks)

	header, ok := blocks[0].(*slack.HeaderBlock)
	require.True(t, ok)
	require.Contains(t, header.Text.Text, "Risk Assessment")

	foundMCP := false
	for _, block := range blocks {
		section, ok := block.(*slack.SectionBlock)
		if !ok {
			continue
		}
		if section.Text != nil && section.Text.Text == "*MyCarrierProtect:* 🔴 Fail" {
			foundMCP = true
			break
		}
	}
	require.True(t, foundMCP)
}
