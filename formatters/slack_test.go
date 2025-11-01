package formatters

import "testing"

func TestRiskLevelEmoji(t *testing.T) {
	cases := []struct {
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

	for _, tc := range cases {
		if got := RiskLevelEmoji(tc.points); got != tc.expected {
			t.Fatalf("RiskLevelEmoji(%d) = %s, expected %s", tc.points, got, tc.expected)
		}
	}
}

func TestRiskLevel(t *testing.T) {
	cases := []struct {
		points   int
		expected string
	}{
		{0, "Low"},
		{200, "Medium"},
		{300, "Review Required"},
		{1000, "Fail"},
	}

	for _, tc := range cases {
		if got := RiskLevel(tc.points); got != tc.expected {
			t.Fatalf("RiskLevel(%d) = %s, expected %s", tc.points, got, tc.expected)
		}
	}
}

func TestFormatInfractions(t *testing.T) {
	infractions := []Infraction{
		{RuleText: "Rule A", RuleOutput: "Output A", Points: 10},
		{RuleText: "Rule B", RuleOutput: "Output B", Points: 20},
	}

	expected := "- Rule A: Output A (10 points)\n- Rule B: Output B (20 points)"
	if got := FormatInfractions(infractions); got != expected {
		t.Fatalf("FormatInfractions returned %q, expected %q", got, expected)
	}

	if got := FormatInfractions(nil); got != "No infractions found." {
		t.Fatalf("FormatInfractions(nil) = %q", got)
	}
}
