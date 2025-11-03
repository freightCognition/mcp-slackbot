package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/freightCognition/mcp-slackbot/config"
)

type MCPAPI struct {
	client       *http.Client
	baseURL      string
	tokenManager *TokenManager
}

var (
	ErrNoData         = errors.New("no data returned for docket number")
	ErrExhaustedRetry = errors.New("exhausted retries for preview endpoint")
)

type CarrierPreview struct {
	CompanyName           string                `json:"CompanyName"`
	DotNumber             string                `json:"DotNumber"`
	DocketNumber          string                `json:"DocketNumber"`
	IsBlocked             bool                  `json:"IsBlocked"`
	FreightValidateStatus string                `json:"FreightValidateStatus"`
	RiskAssessmentDetails *RiskAssessmentDetail `json:"RiskAssessmentDetails"`
}

type RiskAssessmentDetail struct {
	TotalPoints int           `json:"TotalPoints"`
	Authority   *RiskCategory `json:"Authority"`
	Insurance   *RiskCategory `json:"Insurance"`
	Operation   *RiskCategory `json:"Operation"`
	Safety      *RiskCategory `json:"Safety"`
	Other       *RiskCategory `json:"Other"`
}

type RiskCategory struct {
	TotalPoints int          `json:"TotalPoints"`
	Infractions []Infraction `json:"Infractions"`
}

type Infraction struct {
	Points     int    `json:"Points"`
	RuleText   string `json:"RuleText"`
	RuleOutput string `json:"RuleOutput"`
}

func NewMCPAPI(cfg *config.Config, tm *TokenManager, client *http.Client) *MCPAPI {
	cl := client
	if cl == nil {
		cl = &http.Client{Timeout: 10 * time.Second}
	}

	return &MCPAPI{
		client:       cl,
		baseURL:      cfg.MCPPreviewURL,
		tokenManager: tm,
	}
}

func (api *MCPAPI) PreviewCarrier(ctx context.Context, docketNumber string) (*CarrierPreview, error) {
	if docketNumber == "" {
		return nil, errors.New("docket number is required")
	}

	for attempt := 0; attempt < 2; attempt++ {
		req, err := http.NewRequestWithContext(ctx, http.MethodPost, api.baseURL, nil)
		if err != nil {
			return nil, fmt.Errorf("create request: %w", err)
		}

		query := req.URL.Query()
		query.Set("docketNumber", docketNumber)
		req.URL.RawQuery = query.Encode()
		req.Header.Set("Authorization", "Bearer "+api.tokenManager.BearerToken())
		req.Header.Set("Content-Type", "application/json")

		resp, err := api.client.Do(req)
		if err != nil {
			return nil, fmt.Errorf("call preview endpoint: %w", err)
		}

		var decodeErr error
		if resp.StatusCode == http.StatusUnauthorized && attempt == 0 {
			resp.Body.Close()
			if _, err := api.tokenManager.Refresh(ctx); err != nil {
				return nil, fmt.Errorf("refresh token: %w", err)
			}
			continue
		}

		if resp.StatusCode >= 400 {
			decodeErr = fmt.Errorf("preview endpoint returned status %d", resp.StatusCode)
		}

		var payload []CarrierPreview
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			resp.Body.Close()
			return nil, fmt.Errorf("decode response: %w", err)
		}
		resp.Body.Close()

		if decodeErr != nil {
			return nil, decodeErr
		}

		if len(payload) == 0 {
			return nil, ErrNoData
		}

		return &payload[0], nil
	}

	return nil, ErrExhaustedRetry
}
