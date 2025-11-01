package handlers

import (
	"context"
	"errors"
	"testing"

	"github.com/slack-go/slack"

	"github.com/freightCognition/mcp-slackbot/services"
)

type mockSlackClient struct {
	messageCalls   int
	ephemeralCalls int
	failPost       bool
}

func (m *mockSlackClient) PostMessage(channel string, options ...slack.MsgOption) (string, string, error) {
	if m.failPost {
		return "", "", errors.New("post failed")
	}
	m.messageCalls++
	return "ts", channel, nil
}

func (m *mockSlackClient) PostEphemeral(channel, user string, options ...slack.MsgOption) (string, error) {
	m.ephemeralCalls++
	return "ts", nil
}

type mockMCPService struct {
	carrier *services.Carrier
	err     error
	calls   int
}

func (m *mockMCPService) PreviewCarrier(ctx context.Context, docket string) (*services.Carrier, error) {
	m.calls++
	return m.carrier, m.err
}

func TestHandleMCPCommandRequiresInput(t *testing.T) {
	slackClient := &mockSlackClient{}
	mcp := &mockMCPService{}
	handler := NewSlashHandler(slackClient, mcp)

	handler.HandleMCPCommand(context.Background(), slack.SlashCommand{Text: "", ChannelID: "C", UserID: "U"})

	if mcp.calls != 0 {
		t.Fatalf("expected MCP service not to be called when text is empty")
	}

	if slackClient.ephemeralCalls != 1 {
		t.Fatalf("expected ephemeral message to be sent")
	}
}

func TestHandleMCPCommandSuccess(t *testing.T) {
	slackClient := &mockSlackClient{}
	carrier := &services.Carrier{
		CompanyName:  "Acme",
		DotNumber:    "123",
		DocketNumber: "456",
		RiskAssessmentDetails: services.RiskAssessmentDetail{
			TotalPoints: 50,
			Authority: &services.RiskCategory{
				TotalPoints: 10,
				Infractions: []services.Infraction{{RuleText: "Rule", RuleOutput: "Output", Points: 5}},
			},
		},
		IsBlocked:             true,
		FreightValidateStatus: "Review Recommended",
	}
	mcp := &mockMCPService{carrier: carrier}
	handler := NewSlashHandler(slackClient, mcp)

	handler.HandleMCPCommand(context.Background(), slack.SlashCommand{Text: "456", ChannelID: "C", UserID: "U"})

	if slackClient.messageCalls != 1 {
		t.Fatalf("expected a message to be posted")
	}

	if slackClient.ephemeralCalls != 0 {
		t.Fatalf("unexpected ephemeral message sent")
	}

	if mcp.calls != 1 {
		t.Fatalf("expected MCP service to be called once")
	}
}

func TestHandleMCPCommandNoData(t *testing.T) {
	slackClient := &mockSlackClient{}
	mcp := &mockMCPService{err: services.ErrNoCarrierData}
	handler := NewSlashHandler(slackClient, mcp)

	handler.HandleMCPCommand(context.Background(), slack.SlashCommand{Text: "123", ChannelID: "C", UserID: "U"})

	if slackClient.ephemeralCalls != 1 {
		t.Fatalf("expected ephemeral message when no data found")
	}
}

func TestHandleMCPCommandPostFailure(t *testing.T) {
	slackClient := &mockSlackClient{failPost: true}
	carrier := &services.Carrier{
		RiskAssessmentDetails: services.RiskAssessmentDetail{TotalPoints: 0},
	}
	mcp := &mockMCPService{carrier: carrier}
	handler := NewSlashHandler(slackClient, mcp)

	handler.HandleMCPCommand(context.Background(), slack.SlashCommand{Text: "123", ChannelID: "C", UserID: "U"})

	if slackClient.ephemeralCalls != 1 {
		t.Fatalf("expected ephemeral message when post fails")
	}
}
