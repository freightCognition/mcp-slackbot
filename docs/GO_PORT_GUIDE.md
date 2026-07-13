# Building `risk-slackbot-go`: A Go Port of mcp-slackbot

## Context

The current Bun + `@slack/bolt` Slack bot at `/Users/fakebizprez/Developer/repositories/mcp-slackbot` runs on Socket Mode, but the combination is **officially unsupported**. Known Bun bugs cause `JSGlobalProxy is not a constructor` errors and WebSocket parse failures on every event — these are presently swallowed by Bolt's error handler but represent latent production risk.

Go has first-class Socket Mode support via `github.com/slack-go/slack/socketmode` with zero compatibility caveats. This plan describes how to scaffold a new project (`risk-slackbot-go`) that ports the existing `/risk` carrier risk assessment wizard 1:1 to Go, preserving the LibSQL persistence layer, Docker Compose deployment topology, and all existing behavior.

**Intended outcome:** a Go binary that is a drop-in replacement for the current bot — same `/risk [DOT_NUMBER]` slash command, same 4-step modal wizard, same MyCarrierPortal API integration, same channel broadcast, same Intellivite flow, same `/health` endpoint, same LibSQL token + audit log persistence.

---

## Library Choices (decided)

| Concern | Library | Version | Why |
|---|---|---|---|
| Slack Socket Mode | `github.com/slack-go/slack` + `.../socketmode` | v0.23.0 (Apr 2026) | 5K+ stars, native `socketmode` subpackage, full Events API + interactivity + slash command support, used as basis for `slack-io/slacker`. Requires Go 1.25. |
| Event routing | `socketmode.SocketmodeHandler` (in same package) | — | Lets us register handlers per event type/interaction type/slash command — closest analogue to Bolt's `app.command()` / `app.action()` / `app.view()`. Marked experimental but stable in practice. |
| LibSQL client | `github.com/tursodatabase/libsql-client-go` | latest (deprecated but functional) | Matches existing docker-compose HTTP libsql server on port 8081. Implements `database/sql`. Deprecated upstream — track migration to `tursodatabase/go-libsql` if Turso Cloud is ever adopted, but for self-hosted HTTP server this driver is still correct. |
| HTTP client (MCP API) | `net/http` + small wrapper | stdlib | No axios analogue needed; stdlib + a 50-line `doRequest` helper handles retries + token refresh. |
| Logging | `log/slog` | stdlib (Go 1.21+) | Structured JSON logging matches Pino's output shape. Add custom handler for Sentry breadcrumbs + redaction. |
| Sentry | `github.com/getsentry/sentry-go` | latest | Direct equivalent to `@sentry/bun`. |
| Config | `github.com/joho/godotenv` | latest | `.env` loading parity. |
| Testing | `testing` + `net/http/httptest` | stdlib | Table-driven tests; `httptest.Server` replaces the axios response queue. |

**Rejected:**
- `slack-io/slacker`: great for chat-command bots but its abstractions (CommandDefinition, parameters parsing) don't fit a modal-heavy workflow with view push/update/submission. Direct `slack-go/slack` is cleaner here.
- `tursodatabase/go-libsql`: requires CGO and is oriented toward embedded replicas; overkill for the HTTP-server architecture we already deploy.

---

## Repository Layout

```
risk-slackbot-go/
├── cmd/
│   └── slackbot/
│       └── main.go                # Entry point: load env, init logger/sentry/db, start socket mode
├── internal/
│   ├── carrier/                   # MyCarrierPortal API client
│   │   ├── client.go              # apiCall() equivalent: HTTP wrapper with 401 retry
│   │   ├── auth.go                # Token refresh mutex + password-grant fallback
│   │   ├── types.go               # CarrierData, RiskAssessmentDetails, Infraction, etc.
│   │   ├── carrier.go             # fetchCarrierData, fetchCarrierIncidentReports, fetchVINs, fetchContacts, sendIntellivite
│   │   └── carrier_test.go
│   ├── risk/                      # Risk classification + text formatting
│   │   ├── risk.go                # GetRiskLevelEmoji, GetRiskLevel, NormalizeNullableText, FormatSlackLinks, FormatInfractionLine, ChunkLines
│   │   └── risk_test.go
│   ├── wizard/                    # Wizard state machine + modal builders
│   │   ├── state.go               # sync.Map-backed WizardState + ActiveAssessments registry with TTL
│   │   ├── views.go               # BuildStep1View ... BuildStep4View, BuildSessionExpiredView, BuildChannelAssessmentBlocks
│   │   ├── handlers.go            # Slack command + action + view-submission handlers
│   │   └── wizard_test.go
│   ├── db/                        # LibSQL persistence
│   │   ├── db.go                  # InitDB, GetTokens, SaveTokens, LogAuditEntry
│   │   └── db_test.go
│   ├── logging/
│   │   └── logger.go              # slog handler with redaction + Sentry breadcrumb bridge
│   └── server/
│       └── health.go              # /health endpoint on :3001
├── tests/
│   └── fixtures/
│       ├── carrier-response.json       # COPIED VERBATIM from mcp-slackbot
│       └── carrier-high-risk.json      # COPIED VERBATIM from mcp-slackbot
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── .github/
│   └── workflows/
│       └── ci.yml                 # go test, go vet, golangci-lint
├── go.mod
├── go.sum
├── README.md
└── CLAUDE.md
```

---

## Critical Behavioral Contracts (must preserve)

These were extracted from `app.js` (~1,976 lines) and must port exactly:

### 1. Slash command
- `/risk <DOT_NUMBER>` where DOT_NUMBER matches `^\d{1,8}$`
- Validates input, checks `hasActiveAssessment(channel_id)` (5-minute TTL), opens loading modal, sets active assessment, fetches carrier data, broadcasts channel message, updates modal to Step 1.

### 2. Modal callback IDs
- Steps 1–3: `callback_id: "carrier_wizard"`, step number tracked in `private_metadata` JSON
- Step 4: `callback_id: "carrier_wizard_step4"` (separate so view-submission handler can dispatch differently)
- Loading modal: `callback_id: "carrier_wizard_loading"`

### 3. Action IDs (must be preserved verbatim)
`wizard_next`, `wizard_back`, `wizard_vins_next`, `wizard_vins_prev`, `wizard_decline`, `select_contact`, `wizard_send_intellivite`

### 4. MyCarrierPortal API endpoints
Base URL from `CARRIER_API_URL` env (default `https://api.mycarrierpackets.com`). All POST:
- `/api/v1/Carrier/GetCarrierData` — body has MC number
- `/api/v1/Carrier/GetCarrierRiskAssessment` — called in parallel with above
- `/api/v1/Carrier/GetCarrierIncidentReports?docketNumber={mc}`
- `/api/v1/Carrier/GetCarrierVINVerifications?docketNumber={mc}`
- `/api/v1/Carrier/GetCarrierContacts?docketNumber={mc}`
- `/api/v1/Carrier/EmailPacketInvitation?docketNumber={mc}&carrierEmail={email}`

### 5. Token refresh flow
- 401 from any call → trigger refresh under mutex (Go: `sync.Mutex` + a `sync.Once`-style guard or a channel-based gate)
- POST to `TOKEN_ENDPOINT_URL` with `grant_type=refresh_token&refresh_token=...` (form-encoded)
- On `400 invalid_grant`: fall back to `grant_type=password&username=CLIENT_ID&password=CLIENT_SECRET`
- On success: update in-memory tokens, call `SaveTokens()` to DB (DB failure logged but does not invalidate tokens), retry original request once

### 6. Risk tier mapping (`internal/risk/risk.go`)
| Points | Emoji | Level |
|---|---|---|
| 0–124 | 🟢 | Low |
| 125–249 | 🟡 | Medium |
| 250–999 | 🟠 | Review Required |
| ≥1000 | 🔴 | Fail |

### 7. Block Kit specifics
- Step 4 contact selector: `static_select`, max 10 options, label format `"Name - email"`, value = email. **Respect Slack's 75-char limit** on option label/value (truncate if needed).
- Infraction list pagination: `chunkLines()` splits with `maxLines=5, maxChars=1800` per context block.
- VIN pagination: `VIN_PAGE_SIZE=10`, page state stored in `wizardState[wizardId].vinPage`.

### 8. Channel broadcast
On successful `/risk`, post a non-ephemeral message to the channel with `BuildChannelAssessmentBlocks(carrierData, mcNumber, userId)` — user mention `<@U…>`, MC/DOT/trucks/drivers fields, risk summary with emoji, category breakdown context block.

---

## LibSQL Implementation

### Schema (unchanged from JS)
```sql
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY,
  bearer_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL,
  slack_user_id TEXT NOT NULL,
  mc_number TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('invite','decline')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Go driver setup (`internal/db/db.go`)
```go
import (
    "database/sql"
    _ "github.com/tursodatabase/libsql-client-go/libsql"
)

func InitDB(ctx context.Context, libsqlURL string) (*DB, error) {
    // libsqlURL: http://localhost:8081 (matches current docker-compose libsql service)
    db, err := sql.Open("libsql", libsqlURL)
    if err != nil { return nil, err }
    if err := db.PingContext(ctx); err != nil { return nil, err }
    if _, err := db.ExecContext(ctx, schemaSQL); err != nil { return nil, err }
    return &DB{conn: db}, nil
}
```

### Exported functions (mirror JS contracts)
```go
func (d *DB) GetTokens(ctx context.Context) (bearer, refresh string, err error)
func (d *DB) SaveTokens(ctx context.Context, bearer, refresh string) error
func (d *DB) LogAuditEntry(ctx context.Context, slackUserID, mcNumber, action string) error
```

### Health endpoint reporting
`/health` returns:
```json
{
  "status": "ok",
  "timestamp": "ISO8601",
  "socketMode": true,
  "database": "connected" | "unavailable",
  "sentry": "ok" | "unconfigured"
}
```
DB health is a non-blocking startup check; failures are logged but the bot still starts (parity with JS behavior).

---

## Socket Mode Wiring (`cmd/slackbot/main.go` core)

```go
api := slack.New(
    botToken,
    slack.OptionAppLevelToken(appToken),
    slack.OptionLog(slogToStdlog(logger)),
)
client := socketmode.New(api)
h := socketmode.NewSocketmodeHandler(client)

// Slash command
h.HandleSlashCommand("/risk", wizard.HandleRiskCommand(deps))

// Block actions (button clicks, static_select)
h.HandleInteractionBlockAction("wizard_next",            wizard.HandleNext(deps))
h.HandleInteractionBlockAction("wizard_back",            wizard.HandleBack(deps))
h.HandleInteractionBlockAction("wizard_vins_next",       wizard.HandleVinsNext(deps))
h.HandleInteractionBlockAction("wizard_vins_prev",       wizard.HandleVinsPrev(deps))
h.HandleInteractionBlockAction("wizard_decline",         wizard.HandleDecline(deps))
h.HandleInteractionBlockAction("select_contact",         wizard.HandleSelectContact(deps))
h.HandleInteractionBlockAction("wizard_send_intellivite",wizard.HandleSendIntellivite(deps))

// View submissions
h.HandleInteraction(slack.InteractionTypeViewSubmission, wizard.HandleViewSubmission(deps))
// internally routes by callback_id: "carrier_wizard" vs "carrier_wizard_step4"

// View closed
h.HandleInteraction(slack.InteractionTypeViewClosed, wizard.HandleViewClosed(deps))

go h.RunEventLoop()
// then start /health server on :3001 in main goroutine
```

Note: `slack-go` does not have a single "view-submission-by-callback-id" router — we dispatch inside one handler by reading `callback.View.CallbackID`. Document this clearly in `handlers.go`.

### Acknowledgement contract
Every interaction must call `client.Ack(*evt.Request, payload)` within 3 seconds. For view-submission responses (push/update/clear/errors), build a `ViewSubmissionResponse` via:
- `slack.NewUpdateViewSubmissionResponse(view)`
- `slack.NewPushViewSubmissionResponse(view)`
- `slack.NewErrorsViewSubmissionResponse(map[string]string{"block_id": "error message"})`
- `slack.NewClearViewSubmissionResponse()`

Pass the result as the second argument to `client.Ack(*evt.Request, response)`. For slow ops (API calls), Ack first with a pending view (loading modal), then call `api.UpdateView(...)` from a goroutine after the API returns — Socket Mode removes the 3-second hard wall for follow-up `views.update` but the initial Ack must still be prompt.

---

## State Management

In-memory parity with JS:

```go
type WizardEntry struct {
    CarrierData      *carrier.CarrierData
    MCNumber         string
    ChannelID        string
    IncidentReports  []carrier.Incident
    VINVerifications []carrier.VINVerif
    VINPage          int
    SelectedEmail    string
    CreatedAt        time.Time
}

type Store struct {
    mu       sync.RWMutex
    wizards  map[string]*WizardEntry      // key: wizardId
    active   map[string]ActiveAssessment  // key: channelId, 5-min TTL
}
```

- `wizardId` format: `wiz_<unixnano>_<rand4hex>` (same shape as JS for log greppability)
- Active-assessment TTL enforced inside `HasActiveAssessment(channelID)` (lazy expiration on read — same as JS)
- Background goroutine prunes expired entries every 60s to bound memory
- **Restart implication is unchanged**: in-progress wizards lost on restart, just like the JS version. Document this in CLAUDE.md.

---

## Logging & Redaction (`internal/logging/logger.go`)

`slog.Handler` wrapper that:
1. Emits JSON to stdout
2. Redacts attributes matching `(password|token|secret|api[_-]?key|authorization|cookie|cred|bearer|refresh|signing|client[_-]?secret)` (case-insensitive)
3. Truncates string values >256 chars with `…`
4. On level ≥ Info, bridges to Sentry as a breadcrumb (when `sentry.CurrentHub()` is configured)
5. Maps levels: Error/Fatal → `sentry.LevelError`, Warn → `LevelWarning`, Info → `LevelInfo`, Debug → `LevelDebug`

Base attributes: `{service: "risk-slackbot-go"}`. Allowlist (never redacted): `event, endpoint, status, method, channel, user, team, signal, wizardId, mcNumber, dotNumber, page, reason, enabled, source, duration_ms, attempt`.

---

## Environment Variables

`.env.example` — identical to current project so existing `.env` files port over:
```
# MyCarrierPortal API
BEARER_TOKEN=
REFRESH_TOKEN=
TOKEN_ENDPOINT_URL=https://api.mycarrierpackets.com/token
CLIENT_ID=
CLIENT_SECRET=
CARRIER_API_URL=https://api.mycarrierpackets.com

# Slack
SLACK_BOT_TOKEN=
SLACK_SIGNING_SECRET=
SLACK_APP_TOKEN=

# Persistence
LIBSQL_URL=http://localhost:8081

# Logging
LOG_LEVEL=info

# Sentry (optional)
SENTRY_DSN=
SENTRY_ENVIRONMENT=
SENTRY_RELEASE=
SENTRY_TRACES_SAMPLE_RATE=0.1
```

`SLACK_SIGNING_SECRET` is kept in the file for parity but **is not needed** in Socket Mode (Slack signs Web API responses, not WebSocket frames). Document this.

---

## Dockerfile (multi-stage, scratch-friendly)

```dockerfile
FROM golang:1.25-alpine AS build
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /out/slackbot ./cmd/slackbot

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/slackbot /slackbot
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["/slackbot", "-healthcheck"]   # add a -healthcheck flag that curls localhost:3001/health
ENTRYPOINT ["/slackbot"]
```

`CGO_ENABLED=0` works because `libsql-client-go` is pure Go over HTTP. Final image is tiny (~15 MB).

## docker-compose.yml
Mirror the existing topology exactly — `libsql` service (Turso `sqld`) on port 8081 + the slackbot service depending on it. Memory limits, env var pass-through, networks, volumes all preserved from the current project.

---

## Testing Strategy

### Unit tests (parity with `tests/app.test.js`)
- `internal/risk/risk_test.go` — table-driven tests for all four risk tiers, normalize/format helpers, chunking
- `internal/wizard/views_test.go` — view-builder tests using **the same fixtures** copied verbatim into `tests/fixtures/`
- `internal/wizard/state_test.go` — concurrent access, TTL expiration
- `internal/carrier/client_test.go` — 401 retry, token refresh mutex (no concurrent refresh), password-grant fallback. Use `httptest.Server` to script responses.

### Integration scripts (parity with `tests/test_token.js`, `test_refresh.js`, `test_preview.js`)
Place under `cmd/` as separate small binaries: `cmd/token-test`, `cmd/refresh-test`, `cmd/preview`. These hit real APIs and are excluded from CI (`//go:build integration`).

### Fixtures — copy directly
`tests/fixtures/carrier-response.json` and `carrier-high-risk.json` are pure JSON and portable as-is. Unmarshal into the Go `carrier.CarrierData` struct in tests to verify field mapping is correct.

---

## Build Steps (execution order)

1. **Bootstrap**: `go mod init github.com/freightcognition/risk-slackbot-go`, add deps (`slack-go/slack`, `libsql-client-go`, `getsentry/sentry-go`, `joho/godotenv`).
2. **`internal/risk`**: port the pure helper functions first. Easiest to test, no Slack dependency.
3. **`internal/carrier/types.go`**: define Go structs matching the JSON fixtures (use `json:"CompanyName"` tags etc.). Verify by unmarshalling both fixtures in a test.
4. **`internal/carrier/client.go` + `auth.go`**: HTTP wrapper, 401 retry, token-refresh mutex.
5. **`internal/db`**: schema + token/audit functions.
6. **`internal/logging`**: slog handler with redaction + Sentry bridge.
7. **`internal/wizard/state.go`**: store with TTL pruning.
8. **`internal/wizard/views.go`**: all four step builders + session-expired + channel-broadcast.
9. **`internal/wizard/handlers.go`**: slash command, all 7 actions, view-submission dispatcher, view-closed cleanup.
10. **`internal/server/health.go`**: `/health` on port 3001.
11. **`cmd/slackbot/main.go`**: wire everything, register handlers, start socket mode + health server.
12. **Dockerfile + docker-compose.yml**: containerization.
13. **CI**: `.github/workflows/ci.yml` runs `go test`, `go vet`, `golangci-lint`.

---

## Critical Files to Read While Porting

- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/app.js` — source of truth for all behavior. Read line ranges as you port each module (state mgmt: 216–242; API: 245–391; token refresh: 1097–1248; `/risk` handler: 1251+; view builders are interleaved).
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/db.js` — exact SQL schema and function signatures.
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/logger.js` — redaction patterns and Sentry breadcrumb integration.
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/tests/fixtures/*.json` — copy verbatim; defines the API response shape contract.
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/tests/app.test.js` — informs what behaviors must remain regression-tested.
- `/Users/fakebizprez/Developer/repositories/mcp-slackbot/docker-compose.yml` — libsql service config to mirror.

---

## Verification (end-to-end)

1. **Unit tests**: `go test ./...` — all green; coverage on `internal/risk` and `internal/wizard/views` should be ≥90%.
2. **Local docker-compose up**: `docker compose up -d` starts both libsql and slackbot. `curl localhost:3001/health` returns `database: connected`.
3. **Slack workspace test**:
   - Install bot to a dev workspace (reuse existing Slack app credentials — no Slack-side changes needed; the bot speaks the same Socket Mode protocol).
   - Run `/risk 12345` (or a known-valid DOT number). Verify:
     - Loading modal appears
     - Step 1 populates with carrier data
     - Channel broadcast posts with correct emoji + risk tier
     - `wizard_next` advances to Step 2 (incidents)
     - `wizard_next` advances to Step 3 (VINs), pagination works
     - `wizard_next` advances to Step 4 (contacts)
     - Selecting a contact + clicking "Send Intellivite" sends invite, posts success to channel, closes modal
     - `wizard_decline` from any step posts decline message and closes modal
4. **Token refresh test**: temporarily set `BEARER_TOKEN` to an invalid value. First `/risk` call should trigger refresh, persist new tokens to libsql (verify via `curl http://localhost:8081`), and complete successfully.
5. **Concurrency test**: open two `/risk 12345` in same channel within 5 min — second should be rejected with "active assessment in progress".
6. **Restart test**: `docker compose restart slackbot` mid-wizard — verify tokens survive (queried from libsql), and that an in-progress wizard correctly shows "session expired" if user tries to interact with stale modal.
7. **Sentry test** (if DSN configured): trigger an error path, confirm event appears in Sentry with breadcrumbs from prior info-level logs.
