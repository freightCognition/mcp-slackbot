# MCP Slackbot Feature Spec: Enhanced Carrier Assessment Wizard

## Executive Summary
Transform the `/mcp` slash command from a simple text response into a multi-step modal wizard that enables carrier risk assessment, detailed profile review, and Intellivite invitation - all within Slack. Designed for team-based carrier vetting with channel-wide visibility.

---

## Current State
- **Command:** `/mcp [MC_NUMBER]`
- **Endpoint:** `POST /api/v1/Carrier/PreviewCarrier`
- **Response:** Text-based risk assessment with emoji indicators
- **File:** `app.js:172-362`
- **Issue:** Limited data, ugly text format, no workflow capability

---

## Target State: 4-Step Modal Wizard

### Step 1: Assessment Overview (Enhanced Current View)
**Purpose:** Quick go/no-go assessment with key carrier metrics

**Data to Display:**
| Field | Source | Notes |
|-------|--------|-------|
| Company Name | PreviewCarrier/GetCarrierData | |
| DOT / MC Number | PreviewCarrier/GetCarrierData | |
| Year Incorporated | GetCarrierData | **NEW** |
| Total Trucks | GetCarrierData | **NEW** |
| Overall Risk Score | RiskAssessmentDetails.TotalPoints | With emoji + level |
| Authority | RiskAssessmentDetails.Authority | Collapsible infractions |
| Insurance | RiskAssessmentDetails.Insurance | Collapsible infractions |
| Operation | RiskAssessmentDetails.Operation | Collapsible infractions |
| Safety | RiskAssessmentDetails.Safety | Collapsible infractions |
| Other | RiskAssessmentDetails.Other | Collapsible infractions |
| MyCarrierProtect | IsBlocked, FreightValidateStatus | Only if flags present |

**UI Elements:**
- Collapsible sections for infraction details (Slack Block Kit overflow menus)
- Next button → Step 2
- Decline button → Close + channel message

---

### Step 2: Detailed Risk Information
**Purpose:** Deep dive into risk factors for thorough due diligence

**Data to Display:**
| Field | Source |
|-------|--------|
| Incident Reports | GetCarrierIncidentReports API |
| Detailed Infractions | Full infraction list from RiskAssessmentDetails |
| Address Red Flags | GetCarrierData address analysis |

**UI Elements:**
- Collapsible sections per category
- Back button → Step 1
- Next button → Step 3
- Decline button → Close + channel message

---

### Step 3: Vehicle Information
**Purpose:** Review carrier's verified equipment

**Data to Display:**
| Field | Source |
|-------|--------|
| Vehicle List | GetCarrierVINVerifications API |
| VIN Details | Pass through whatever MCP returns |

**Empty State:** Display whatever MCP returns (they handle empty state)

**UI Elements:**
- Back button → Step 2
- Next button → Step 4
- Decline button → Close + channel message

---

### Step 4: Contacts & Intellivite
**Purpose:** Select contact and send carrier onboarding invitation

**Data to Display:**
| Field | Source |
|-------|--------|
| Contact List | GetCarrierContacts API |
| Verification Status | Per-contact from API |

**Actions:**
1. **Pick from Verified Contacts:** Dropdown of authorized contacts from MCP database
2. **Manual Entry:** Text input for email (triggers MCP phone verification on their end)
3. **Send Intellivite:** Calls EmailPacketInvitation API

**UI Elements:**
- Contact dropdown (verified contacts)
- Manual email input field
- Send Intellivite button
- Back button → Step 3
- Decline button → Close + channel message

---

## User Experience Flows

### Happy Path: Carrier Invitation
```
User: /mcp MC123456
  ↓
Bot: Opens modal with Step 1 (Assessment)
  ↓
User: Reviews risk, clicks Next
  ↓
Bot: Shows Step 2 (Details)
  ↓
User: Reviews infractions, clicks Next
  ↓
Bot: Shows Step 3 (Vehicles)
  ↓
User: Reviews VINs, clicks Next
  ↓
Bot: Shows Step 4 (Contacts)
  ↓
User: Selects contact from dropdown, clicks "Send Intellivite"
  ↓
Bot: Calls EmailPacketInvitation API
  ↓
Bot: Posts to channel: "✅ @user invited Carrier ABC (MC123456) via Intellivite. [View in MCP](link)"
```

### Decline Flow
```
User: On any step, clicks Decline
  ↓
Bot: Closes modal
  ↓
Bot: Posts to channel: "👎 @username voted no on Carrier ABC (MC123456)"
```

### Navigation
- **Full back/next navigation** on all steps
- User can review any previous step before committing
- State preserved when navigating back

---

## Channel Behavior

### Visibility
- **All responses broadcast to channel** (not ephemeral)
- Encourages "wisdom by committee" decision making
- Team can see who's looking at which carriers

### Queueing
- **Primary goal:** Prevent channel noise, maintain team focus
- **Implementation:** If concurrent requests detected, show: "Another carrier assessment is in progress. Please try again shortly."
- **Fallback:** If queuing is complex, simple error message is acceptable

### Success Messages
```
✅ @user invited Carrier ABC Trucking (MC123456) via Intellivite
📧 Contact: john@carrier.com
🔗 View status in MCP: [link]
```

### Decline Messages
```
👎 @username voted no on Carrier ABC (MC123456)
```

---

## Data Persistence (LibSQL)

### Audit Log Table Schema
```sql
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timestamp TEXT NOT NULL DEFAULT (datetime('now')),
  slack_user_id TEXT NOT NULL,
  mc_number TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('invite', 'decline')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

**Minimal logging per user request:**
- Timestamp
- Slack User ID
- MC Number
- Action (invite/decline)

### Future: Recent Lookups (Nice-to-have)
```sql
CREATE TABLE IF NOT EXISTS recent_lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slack_user_id TEXT NOT NULL,
  mc_number TEXT NOT NULL,
  carrier_name TEXT,
  looked_up_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

---

## API Endpoints Required

| Endpoint | Purpose | Step |
|----------|---------|------|
| `GetCarrierData` | Comprehensive carrier profile | 1, 2 |
| `GetCarrierIncidentReports` | Incident history | 2 |
| `GetCarrierVINVerifications` | Vehicle list | 3 |
| `GetCarrierContacts` | Authorized contacts | 4 |
| `EmailPacketInvitation` | Send Intellivite | 4 |

### API URL
- **Current:** `https://mycarrierpacketsapi-stage.azurewebsites.net` (staging - verify if intentional)
- **Production:** `https://api.mycarrierpackets.com`
- **Recommendation:** Make configurable via `CARRIER_API_URL` env var

---

## Error Handling

### Principles
- **Verbose logging:** All API calls logged with Pino (request, response, timing)
- **User-facing errors:** Show meaningful messages in modal, not generic failures

### Error Scenarios
| Scenario | User Experience | Logging |
|----------|-----------------|---------|
| API timeout | Modal shows: "MCP API is slow. Please try again." | Log full error with request details |
| 401 Unauthorized | Auto-refresh token, retry (current behavior) | Log refresh attempt |
| 404 Not Found | Modal shows: "Carrier MC123456 not found in MCP database" | Log MC number and response |
| 500 Server Error | Modal shows: "MCP service error. Please try again later." | Log full response |
| Network Error | Modal shows: "Cannot reach MCP. Check your connection." | Log error details |

---

## Input/Output Specifications

### Input
- **Command:** `/mcp [MC_NUMBER]`
- **Format:** MC number only (no DOT support needed)
- **Validation:** Strip whitespace, validate format

### Output
- **Step 1-4:** Slack modal views
- **Channel messages:** For invites and declines
- **Logs:** Structured JSON (Pino)

---

## Permission Model

### Slack Permissions
- **No restrictions** - anyone who can use /mcp can proceed through all steps
- MCP backend handles approval workflow for non-approved carriers (emails go to manager)

### MCP Backend Behavior
- If carrier doesn't meet internal approval criteria, invite email routes to manager for approval
- No frontend gating needed - MCP handles this transparently

---

## Multi-Workspace Considerations

### Current Scope
- Single workspace (#Operations channel)
- All features work for single workspace

### Future Distribution (Open Source)
Design patterns to enable:
- Workspace-specific MCP credentials (env vars per workspace)
- Workspace-specific LibSQL databases or table prefixes
- No hardcoded workspace IDs

---

## Implementation Phases

### Phase 1: Foundation
**Scope:** Enhanced Step 1 with modal UI
- [ ] Switch from text response to Slack modal
- [ ] Replace PreviewCarrier with GetCarrierData for more fields
- [ ] Add year incorporated, total trucks
- [ ] Implement collapsible sections for infractions
- [ ] Add Decline button with channel message
- [ ] Add LibSQL audit logging table
- [ ] Make API URL configurable via env var

**Files Modified:**
- `app.js` - Complete rewrite of /mcp handler
- `db.js` - Add audit_log table and functions

### Phase 2: Wizard Steps 2-3
**Scope:** Details and Vehicles pages
- [ ] Add GetCarrierIncidentReports API call
- [ ] Build Step 2 modal view (detailed risk/infractions)
- [ ] Add GetCarrierVINVerifications API call
- [ ] Build Step 3 modal view (vehicles)
- [ ] Implement back/next navigation between all steps
- [ ] Track wizard state across modal updates

**Files Modified:**
- `app.js` - Add action handlers for navigation

### Phase 3: Intellivite Integration
**Scope:** Contacts and invitation flow
- [ ] Add GetCarrierContacts API call
- [ ] Build Step 4 modal view with contact dropdown
- [ ] Add manual email input with helper text about verification
- [ ] Integrate EmailPacketInvitation API
- [ ] Post success message with link to MCP portal
- [ ] Log invites to audit_log

**Files Modified:**
- `app.js` - Add invite action handler

### Phase 4: Polish & Channel Features
**Scope:** Queuing, error handling, nice-to-haves
- [ ] Implement request queuing (or graceful "try again" fallback)
- [ ] Enhance error messages with verbose user feedback
- [ ] Add recent lookups table (nice-to-have)
- [ ] Production API URL verification and switch
- [ ] Comprehensive logging review

**Files Modified:**
- `app.js` - Queue logic
- `db.js` - Recent lookups table (optional)

---

## Slack Block Kit Considerations

### Modal Limits
- **Title:** 24 characters max
- **Submit/Close buttons:** 24 characters max
- **Text blocks:** 3000 characters max
- **Total blocks:** 100 max per view

### Collapsible Pattern
Use `overflow` menu or `button` + view_update pattern:
```javascript
{
  type: "section",
  text: { type: "mrkdwn", text: "*Authority:* 🟢 Low Risk" },
  accessory: {
    type: "button",
    text: { type: "plain_text", text: "Details" },
    action_id: "show_authority_details"
  }
}
```

### Navigation Pattern
```javascript
{
  type: "actions",
  elements: [
    { type: "button", text: { type: "plain_text", text: "← Back" }, action_id: "wizard_back" },
    { type: "button", text: { type: "plain_text", text: "Next →" }, action_id: "wizard_next", style: "primary" },
    { type: "button", text: { type: "plain_text", text: "Decline" }, action_id: "wizard_decline", style: "danger" }
  ]
}
```

---

## Verification & Testing

### Manual Testing Checklist
- [ ] `/mcp MC123456` opens modal with Step 1
- [ ] Step 1 shows all required fields with real data
- [ ] Collapsible sections expand/collapse correctly
- [ ] Next button advances to Step 2
- [ ] Back button returns to previous step
- [ ] Decline button closes modal and posts channel message
- [ ] Step 4 contact dropdown populated from API
- [ ] Manual email entry accepted
- [ ] Intellivite send succeeds and posts confirmation
- [ ] Audit log records invites and declines
- [ ] Error messages display on API failures
- [ ] Logging captures all API calls

### Integration Tests
- [ ] Mock MCP API responses for each endpoint
- [ ] Test token refresh during wizard flow
- [ ] Test concurrent request handling
- [ ] Test empty state scenarios (no VINs, no contacts)

---

## Open Questions

1. **Staging URL:** Is `mycarrierpacketsapi-stage.azurewebsites.net` intentional or should it be production?
2. **Concurrency:** Is simple "try again" message acceptable, or is true queuing required?
3. **Recent lookups:** Implement now or defer to post-MVP?

---

## Decisions Finalized

| Question | Decision |
|----------|----------|
| Concurrency handling | Simple "try again shortly" message for MVP |
| Recent lookups feature | Deferred to post-MVP |
| Staging vs Production URL | Verify and make configurable |

---

## Next Steps

1. Review and approve this spec
2. Begin Phase 1 implementation
3. Test with staging API to verify URL
4. Iterate based on team feedback
