package formatters

import (
	"fmt"
	"strings"
)

// Infraction represents a single rule violation returned from the MCP API.
type Infraction struct {
	RuleText   string
	RuleOutput string
	Points     int
}

// RiskLevelEmoji returns the emoji associated with a given risk score.
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

// RiskLevel converts a risk score into a human readable value.
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

// FormatInfractions formats infractions for Slack markdown rendering.
func FormatInfractions(infractions []Infraction) string {
	if len(infractions) == 0 {
		return "No infractions found."
	}

	lines := make([]string, 0, len(infractions))
	for _, infraction := range infractions {
		lines = append(lines, fmt.Sprintf("- %s: %s (%d points)", infraction.RuleText, infraction.RuleOutput, infraction.Points))
	}

	return strings.Join(lines, "\n")
}
