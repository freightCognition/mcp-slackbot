# Slack App Manifest Reference

The App Manifest is a configuration file (YAML, JSON, or TypeScript) that defines how a Slack app behaves. It's used to create, configure, and distribute apps.

## Complete Manifest Structure

```yaml
_metadata:
  major_version: 1
  minor_version: 0

display_information:
  name: "My Slack App"
  description: "A brief description of the app"
  long_description: "A detailed description of the app's features..."
  background_color: "#2c2d30"

features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false

  bot_user:
    display_name: "MyBot"
    always_online: true

  shortcuts:
    - name: "Create Task"
      type: global
      callback_id: "create_task_shortcut"
      description: "Create a new task"

    - name: "Analyze Message"
      type: message
      callback_id: "analyze_message_shortcut"
      description: "Analyze this message"

  slash_commands:
    - command: "/mycommand"
      url: "https://example.com/slack/commands"
      description: "Execute my command"
      usage_hint: "[argument]"
      should_escape: false

  unfurl_domains:
    - "example.com"
    - "app.example.com"

settings:
  event_subscriptions:
    request_url: "https://example.com/slack/events"
    bot_events:
      - message.channels
      - message.im
      - message.groups
      - app_home_opened
      - app_mention
      - reaction_added
    user_events:
      - message.im

  interactivity:
    is_enabled: true
    request_url: "https://example.com/slack/interactivity"
    message_menu_options_url: "https://example.com/slack/options"

  org_deploy_enabled: false
  socket_mode_enabled: true
  token_rotation_enabled: false

  incoming_webhooks:
    enabled: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - channels:read
      - chat:write
      - commands
      - groups:history
      - groups:read
      - im:history
      - im:read
      - im:write
      - reactions:read
      - users:read
    user:
      - channels:read
      - search:read

  redirect_urls:
    - "https://example.com/oauth/callback"

  token_management_enabled: true
```

---

## Section Details

### Metadata

```yaml
_metadata:
  major_version: 1
  minor_version: 0
```

Specifies the manifest schema version.

---

### Display Information

```yaml
display_information:
  name: "App Name"
  description: "Short description"
  long_description: "Detailed description..."
  background_color: "#2c2d30"
```

| Field | Required | Max Length | Description |
|-------|----------|------------|-------------|
| `name` | Yes | 35 chars | App name shown to users |
| `description` | Yes | 140 chars | Brief description |
| `long_description` | No | 4000 chars | Detailed description |
| `background_color` | No | Hex value | Background color (3 or 6 digits) |

---

### Features

#### App Home

```yaml
features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
```

| Field | Description |
|-------|-------------|
| `home_tab_enabled` | Enable custom Home tab |
| `messages_tab_enabled` | Enable Messages tab |
| `messages_tab_read_only_enabled` | Make Messages tab read-only |

#### Bot User

```yaml
features:
  bot_user:
    display_name: "MyBot"
    always_online: true
```

| Field | Max Length | Description |
|-------|------------|-------------|
| `display_name` | 80 chars | Bot display name |
| `always_online` | - | Always show as online |

#### Shortcuts

```yaml
features:
  shortcuts:
    - name: "Shortcut Name"
      type: global  # or "message"
      callback_id: "shortcut_callback"
      description: "What this shortcut does"
```

| Field | Max Length | Description |
|-------|------------|-------------|
| `name` | 24 chars | Shortcut name |
| `type` | - | "global" or "message" |
| `callback_id` | 255 chars | Unique identifier |
| `description` | 150 chars | Description shown to users |

**Limits:** Maximum 10 shortcuts per app

#### Slash Commands

```yaml
features:
  slash_commands:
    - command: "/mycommand"
      url: "https://example.com/commands"
      description: "Command description"
      usage_hint: "[optional] [arguments]"
      should_escape: false
```

| Field | Max Length | Description |
|-------|------------|-------------|
| `command` | 32 chars | Command trigger (including /) |
| `url` | 3000 chars | Request URL (not needed for Socket Mode) |
| `description` | 2000 chars | Command description |
| `usage_hint` | 1000 chars | Usage hint text |
| `should_escape` | - | Escape special characters |

**Limits:** Maximum 50 slash commands per app

#### Unfurl Domains

```yaml
features:
  unfurl_domains:
    - "example.com"
    - "subdomain.example.com"
```

**Limits:** Maximum 5 unfurl domains

---

### Settings

#### Event Subscriptions

```yaml
settings:
  event_subscriptions:
    request_url: "https://example.com/events"
    bot_events:
      - message.channels
      - message.im
      - app_home_opened
    user_events:
      - message.channels
```

**Common Bot Events:**

| Event | Description | Required Scope |
|-------|-------------|----------------|
| `message.channels` | Messages in public channels | `channels:history` |
| `message.groups` | Messages in private channels | `groups:history` |
| `message.im` | Direct messages to bot | `im:history` |
| `message.mpim` | Multi-person DMs | `mpim:history` |
| `app_home_opened` | User opens App Home | - |
| `app_mention` | Bot is mentioned | `app_mentions:read` |
| `reaction_added` | Reaction added | `reactions:read` |
| `reaction_removed` | Reaction removed | `reactions:read` |
| `team_join` | User joins workspace | `users:read` |
| `member_joined_channel` | User joins channel | `channels:read` |

#### Interactivity

```yaml
settings:
  interactivity:
    is_enabled: true
    request_url: "https://example.com/interactivity"
    message_menu_options_url: "https://example.com/options"
```

| Field | Description |
|-------|-------------|
| `is_enabled` | Enable interactive components |
| `request_url` | URL for interactive events |
| `message_menu_options_url` | URL for external data sources |

#### Socket Mode

```yaml
settings:
  socket_mode_enabled: true
```

When enabled, event subscriptions use WebSocket instead of HTTP.

#### Other Settings

```yaml
settings:
  org_deploy_enabled: false      # Enterprise Grid org-wide
  token_rotation_enabled: false  # Automatic token rotation
  incoming_webhooks:
    enabled: true
```

---

### OAuth Configuration

#### Scopes

```yaml
oauth_config:
  scopes:
    bot:
      - chat:write
      - commands
      - im:history
    user:
      - channels:read
```

**Common Bot Scopes:**

| Scope | Description |
|-------|-------------|
| `app_mentions:read` | View messages that mention the app |
| `channels:history` | View messages in public channels |
| `channels:read` | View public channel info |
| `chat:write` | Send messages as the app |
| `commands` | Add slash commands |
| `groups:history` | View messages in private channels |
| `groups:read` | View private channel info |
| `im:history` | View messages in DMs |
| `im:read` | View DM info |
| `im:write` | Start DMs with users |
| `reactions:read` | View reactions |
| `reactions:write` | Add reactions |
| `users:read` | View user info |
| `files:write` | Upload files |
| `files:read` | View files |

**Common User Scopes:**

| Scope | Description |
|-------|-------------|
| `channels:read` | View channels (as user) |
| `search:read` | Search messages (as user) |
| `users:read` | View user profiles (as user) |

#### Redirect URLs

```yaml
oauth_config:
  redirect_urls:
    - "https://example.com/oauth/callback"
    - "https://staging.example.com/oauth/callback"
```

**Limits:** Maximum 1000 redirect URLs

---

## Manifest Examples

### Minimal Bot App

```yaml
_metadata:
  major_version: 1

display_information:
  name: "Simple Bot"
  description: "A simple Slack bot"

features:
  bot_user:
    display_name: "SimpleBot"
    always_online: false

settings:
  socket_mode_enabled: true

oauth_config:
  scopes:
    bot:
      - chat:write
```

### Slash Command App

```yaml
_metadata:
  major_version: 1

display_information:
  name: "Command App"
  description: "App with slash commands"

features:
  bot_user:
    display_name: "CommandBot"

  slash_commands:
    - command: "/lookup"
      description: "Look up information"
      usage_hint: "[query]"

    - command: "/status"
      description: "Check status"

settings:
  socket_mode_enabled: true

oauth_config:
  scopes:
    bot:
      - commands
      - chat:write
```

### Full-Featured AI App

```yaml
_metadata:
  major_version: 1

display_information:
  name: "AI Assistant"
  description: "AI-powered assistant for Slack"
  long_description: |
    An intelligent assistant that helps with tasks,
    answers questions, and integrates with your tools.

features:
  app_home:
    home_tab_enabled: true
    messages_tab_enabled: true

  bot_user:
    display_name: "AI Assistant"
    always_online: true

  shortcuts:
    - name: "Analyze"
      type: message
      callback_id: "analyze_message"
      description: "Analyze this message with AI"

    - name: "Quick Question"
      type: global
      callback_id: "quick_question"
      description: "Ask a quick question"

  slash_commands:
    - command: "/ask"
      description: "Ask the AI assistant"
      usage_hint: "[your question]"

settings:
  event_subscriptions:
    bot_events:
      - app_home_opened
      - app_mention
      - message.im
      - reaction_added

  interactivity:
    is_enabled: true

  socket_mode_enabled: true

oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - chat:write
      - commands
      - im:history
      - im:read
      - im:write
      - reactions:read
      - users:read
```

---

## JSON Format

The same manifest can be written in JSON:

```json
{
  "_metadata": {
    "major_version": 1
  },
  "display_information": {
    "name": "My App",
    "description": "App description"
  },
  "features": {
    "bot_user": {
      "display_name": "MyBot",
      "always_online": false
    }
  },
  "settings": {
    "socket_mode_enabled": true
  },
  "oauth_config": {
    "scopes": {
      "bot": ["chat:write", "commands"]
    }
  }
}
```

---

## Creating Apps from Manifest

### Via Slack API

```bash
curl -X POST https://slack.com/api/apps.manifest.create \
  -H "Authorization: Bearer xoxp-your-token" \
  -H "Content-Type: application/json" \
  -d '{"manifest": {...}}'
```

### Via Slack CLI

```bash
slack create my-app --manifest manifest.yaml
```

### Via Web UI

1. Go to https://api.slack.com/apps
2. Click "Create New App"
3. Choose "From an app manifest"
4. Select workspace
5. Paste manifest (YAML or JSON)
6. Review and create

---

## Token Types

| Token | Prefix | Purpose |
|-------|--------|---------|
| Bot Token | `xoxb-` | App acting as bot user |
| User Token | `xoxp-` | Acting on behalf of user |
| App Token | `xapp-` | Socket Mode connections |

---

## Sources

- [App Manifest Reference](https://docs.slack.dev/reference/app-manifest)
- [OAuth Scopes Reference](https://docs.slack.dev/reference/scopes)
- [Events Reference](https://docs.slack.dev/reference/events)
