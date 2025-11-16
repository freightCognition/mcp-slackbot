package services

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// MCPClient is the client for the MyCarrierPortal API.
type MCPClient struct {
	httpClient *http.Client
	tokenManager *TokenManager
}

// NewMCPClient creates a new MCPClient.
func NewMCPClient(tm *TokenManager) *MCPClient {
	return &MCPClient{
		httpClient: &http.Client{Timeout: 10 * time.Second},
		tokenManager: tm,
	}
}

// CarrierPreviewResponse defines the structure for the API response.
type CarrierPreviewResponse struct {
	CompanyName         string `json:"CompanyName"`
	DotNumber           string `json:"DotNumber"`
	DocketNumber        string `json:"DocketNumber"`
	IsBlocked           bool   `json:"IsBlocked"`
	FreightValidateStatus string `json:"FreightValidateStatus"`
	RiskAssessmentDetails struct {
		TotalPoints int `json:"TotalPoints"`
		Authority   CategoryDetails `json:"Authority"`
		Insurance   CategoryDetails `json:"Insurance"`
		Operation   CategoryDetails `json:"Operation"`
		Safety      CategoryDetails `json:"Safety"`
		Other       CategoryDetails `json:"Other"`
	} `json:"RiskAssessmentDetails"`
}

// CategoryDetails defines the structure for each risk category.
type CategoryDetails struct {
	TotalPoints int          `json:"TotalPoints"`
	Infractions []Infraction `json:"Infractions"`
}

// Infraction defines the structure for an infraction.
type Infraction struct {
	RuleText string `json:"RuleText"`
	RuleOutput string `json:"RuleOutput"`
	Points   int    `json:"Points"`
}

// GetCarrierPreview fetches the carrier preview data.
func (c *MCPClient) GetCarrierPreview(mcNumber string) (*CarrierPreviewResponse, error) {
	const maxAttempts = 2
	var apiResponse []CarrierPreviewResponse
	var err error

	for attempt := 0; attempt < maxAttempts; attempt++ {
		req, err := http.NewRequest("POST", "https://mycarrierpacketsapi-stage.azurewebsites.net/api/v1/Carrier/PreviewCarrier", nil)
		if err != nil {
			return nil, fmt.Errorf("failed to create API request: %w", err)
		}

		q := req.URL.Query()
		q.Add("docketNumber", mcNumber)
		req.URL.RawQuery = q.Encode()

		req.Header.Set("Authorization", "Bearer "+c.tokenManager.GetBearerToken())
		req.Header.Set("Content-Type", "application/json")

		resp, err := c.httpClient.Do(req)
		if err != nil {
			return nil, fmt.Errorf("failed to execute API request: %w", err)
		}
		defer resp.Body.Close()

		if resp.StatusCode == http.StatusUnauthorized && attempt < maxAttempts-1 {
			fmt.Println("Access token expired or invalid. Attempting refresh...")
			if err := c.tokenManager.RefreshToken(); err != nil {
				return nil, fmt.Errorf("failed to refresh token: %w", err)
			}
			continue
		}

		if resp.StatusCode != http.StatusOK {
			return nil, fmt.Errorf("API request failed with status code: %d", resp.StatusCode)
		}

		if err := json.NewDecoder(resp.Body).Decode(&apiResponse); err != nil {
			return nil, fmt.Errorf("failed to decode API response: %w", err)
		}

		if len(apiResponse) == 0 {
			return nil, nil // No data found
		}

		return &apiResponse[0], nil
	}
	return nil, err
}
