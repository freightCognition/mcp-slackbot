package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/freightCognition/mcp-slackbot/config"
)

// ErrNoCarrierData is returned when the MCP API does not return any carrier information.
var ErrNoCarrierData = errors.New("no data returned for carrier")

// MCPClient communicates with the MyCarrierPortal API.
type MCPClient struct {
	httpClient   *http.Client
	cfg          *config.Config
	tokenManager *TokenManager
}

// Carrier represents the carrier response returned from the MCP API.
type Carrier struct {
	CompanyName           string               `json:"CompanyName"`
	DotNumber             string               `json:"DotNumber"`
	DocketNumber          string               `json:"DocketNumber"`
	RiskAssessmentDetails RiskAssessmentDetail `json:"RiskAssessmentDetails"`
	IsBlocked             bool                 `json:"IsBlocked"`
	FreightValidateStatus string               `json:"FreightValidateStatus"`
}

// RiskAssessmentDetail contains overall and per-category assessment information.
type RiskAssessmentDetail struct {
	TotalPoints int           `json:"TotalPoints"`
	Authority   *RiskCategory `json:"Authority"`
	Insurance   *RiskCategory `json:"Insurance"`
	Operation   *RiskCategory `json:"Operation"`
	Safety      *RiskCategory `json:"Safety"`
	Other       *RiskCategory `json:"Other"`
}

// RiskCategory represents a specific risk category with infractions.
type RiskCategory struct {
	TotalPoints int          `json:"TotalPoints"`
	Infractions []Infraction `json:"Infractions"`
}

// Infraction represents a single infraction from the MCP API.
type Infraction struct {
	Points     int    `json:"Points"`
	RiskLevel  string `json:"RiskLevel"`
	RuleText   string `json:"RuleText"`
	RuleOutput string `json:"RuleOutput"`
}

// NewMCPClient constructs a new MCPClient.
func NewMCPClient(cfg *config.Config, tokenManager *TokenManager) *MCPClient {
	return &MCPClient{
		httpClient:   &http.Client{Timeout: 10 * time.Second},
		cfg:          cfg,
		tokenManager: tokenManager,
	}
}

// PreviewCarrier fetches carrier preview data for the provided docket number, retrying once if
// a token refresh is required.
func (c *MCPClient) PreviewCarrier(ctx context.Context, docketNumber string) (*Carrier, error) {
	maxAttempts := 2

	for attempt := 0; attempt < maxAttempts; attempt++ {
		carrier, status, err := c.previewCarrierOnce(ctx, docketNumber)
		if err != nil {
			if status == http.StatusUnauthorized && attempt < maxAttempts-1 {
				if _, refreshErr := c.tokenManager.RefreshAccessToken(ctx); refreshErr != nil {
					return nil, fmt.Errorf("refreshing token: %w", refreshErr)
				}
				continue
			}
			return nil, err
		}
		return carrier, nil
	}

	return nil, errors.New("exhausted retries fetching carrier data")
}

func (c *MCPClient) previewCarrierOnce(ctx context.Context, docketNumber string) (*Carrier, int, error) {
	endpoint, err := url.Parse(c.cfg.MCPAPIURL)
	if err != nil {
		return nil, 0, fmt.Errorf("invalid MCP API URL: %w", err)
	}

	query := endpoint.Query()
	query.Set("docketNumber", docketNumber)
	endpoint.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.String(), nil)
	if err != nil {
		return nil, 0, fmt.Errorf("creating MCP request: %w", err)
	}

	req.Header.Set("Authorization", fmt.Sprintf("Bearer %s", c.tokenManager.BearerToken()))
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, 0, fmt.Errorf("performing MCP request: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		io.Copy(io.Discard, resp.Body)
		return nil, http.StatusUnauthorized, fmt.Errorf("unauthorized")
	}

	if resp.StatusCode >= 400 {
		body, _ := io.ReadAll(resp.Body)
		return nil, resp.StatusCode, fmt.Errorf("mcp api error (status %d): %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}

	var carriers []Carrier
	if err := json.NewDecoder(resp.Body).Decode(&carriers); err != nil {
		return nil, resp.StatusCode, fmt.Errorf("decoding MCP response: %w", err)
	}

	if len(carriers) == 0 {
		return nil, resp.StatusCode, ErrNoCarrierData
	}

	return &carriers[0], resp.StatusCode, nil
}
