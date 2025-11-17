package handlers_test

import (
	"context"
	"testing"

	"github.com/slack-go/slack"
	"github.com/stretchr/testify/require"

	"github.com/freightCognition/mcp-slackbot/handlers"
	"github.com/freightCognition/mcp-slackbot/services"
)

type mockSlackClient struct {
	postMessageCalls   int
	postEphemeralCalls int
	lastChannel        string
	postMessageErr     error
}

func (m *mockSlackClient) PostMessageContext(ctx context.Context, channelID string, options ...slack.MsgOption) (string, string, error) {
	m.postMessageCalls++
	m.lastChannel = channelID
	return "", "", m.postMessageErr
}

func (m *mockSlackClient) PostEphemeralContext(ctx context.Context, channelID, userID string, options ...slack.MsgOption) (string, error) {
	m.postEphemeralCalls++
	return "", nil
}

type stubPreviewer struct {
	result *services.CarrierPreview
	err    error
}

func (s *stubPreviewer) PreviewCarrier(ctx context.Context, docketNumber string) (*services.CarrierPreview, error) {
	return s.result, s.err
}

func TestHandleMCPCommandSuccess(t *testing.T) {
	client := &mockSlackClient{}
	previewer := &stubPreviewer{result: &services.CarrierPreview{CompanyName: "Carrier"}}
	h := handlers.NewSlashHandler(client, previewer)

	cmd := slack.SlashCommand{Text: "12345", ChannelID: "C123", UserID: "U123"}
	err := h.HandleMCPCommand(context.Background(), cmd)
	require.NoError(t, err)
	require.Equal(t, 1, client.postMessageCalls)
	require.Equal(t, 0, client.postEphemeralCalls)
	require.Equal(t, "C123", client.lastChannel)
}

func TestHandleMCPCommandMissingText(t *testing.T) {
	client := &mockSlackClient{}
	previewer := &stubPreviewer{}
	h := handlers.NewSlashHandler(client, previewer)

	cmd := slack.SlashCommand{Text: ""}
	err := h.HandleMCPCommand(context.Background(), cmd)
	require.NoError(t, err)
	require.Equal(t, 0, client.postMessageCalls)
	require.Equal(t, 1, client.postEphemeralCalls)
}

func TestHandleMCPCommandNoData(t *testing.T) {
	client := &mockSlackClient{}
	previewer := &stubPreviewer{err: services.ErrNoData}
	h := handlers.NewSlashHandler(client, previewer)

	cmd := slack.SlashCommand{Text: "12345"}
	err := h.HandleMCPCommand(context.Background(), cmd)
	require.NoError(t, err)
	require.Equal(t, 1, client.postEphemeralCalls)
}

func TestHandleMCPCommandPostMessageFailure(t *testing.T) {
	client := &mockSlackClient{postMessageErr: context.DeadlineExceeded}
	previewer := &stubPreviewer{result: &services.CarrierPreview{CompanyName: "Carrier"}}
	h := handlers.NewSlashHandler(client, previewer)

	cmd := slack.SlashCommand{Text: "12345", ChannelID: "C123", UserID: "U123"}
	err := h.HandleMCPCommand(context.Background(), cmd)
	require.Error(t, err)
	require.Equal(t, 1, client.postEphemeralCalls)
}
