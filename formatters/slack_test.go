package formatters

import (
	"testing"

	"freightCognition/mcp-slackbot/services"
)

func TestGetRiskLevelEmoji(t *testing.T) {
	testCases := []struct {
		points   int
		expected string
	}{
		{0, "🟢"},
		{124, "🟢"},
		{125, "🟡"},
		{249, "🟡"},
		{250, "🟠"},
		{999, "🟠"},
		{1000, "🔴"},
	}

	for _, tc := range testCases {
		result := GetRiskLevelEmoji(tc.points)
		if result != tc.expected {
			t.Errorf("For %d points, expected %s, but got %s", tc.points, tc.expected, result)
		}
	}
}

func TestGetRiskLevel(t *testing.T) {
	testCases := []struct {
		points   int
		expected string
	}{
		{0, "Low"},
		{124, "Low"},
		{125, "Medium"},
		{249, "Medium"},
		{250, "Review Required"},
		{999, "Review Required"},
		{1000, "Fail"},
	}

	for _, tc := range testCases {
		result := GetRiskLevel(tc.points)
		if result != tc.expected {
			t.Errorf("For %d points, expected %s, but got %s", tc.points, tc.expected, result)
		}
	}
}

func TestFormatInfractions(t *testing.T) {
	infractions := []services.Infraction{
		{RuleText: "Rule 1", RuleOutput: "Output 1", Points: 10},
		{RuleText: "Rule 2", RuleOutput: "Output 2", Points: 20},
	}

	expected := "- Rule 1: Output 1 (10 points)\n- Rule 2: Output 2 (20 points)\n"
	result := FormatInfractions(infractions)
	if result != expected {
		t.Errorf("Expected:\n%s\nGot:\n%s", expected, result)
	}

	// Test with no infractions
	result = FormatInfractions([]services.Infraction{})
	if result != "No infractions found." {
		t.Errorf("Expected 'No infractions found.', but got '%s'", result)
	}
}
