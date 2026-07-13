---
name: "slack-development"
description: "Comprehensive guide for building Slack applications using the Bolt SDK, Block Kit, Socket Mode, and AI features. This skill should be used when creating slash commands, handling events, building interactive modals, designing Block Kit UIs, configuring app manifests, or developing AI-powered Slack bots."
---

# Slack Development Skill

Build robust, interactive Slack applications using the Bolt SDK with Socket Mode, Block Kit UI framework, and AI capabilities.

## When to Use This Skill

Use this skill when:
- Creating or modifying Slack applications
- Implementing slash commands, shortcuts, or interactive components
- Building Block Kit messages, modals, or App Home surfaces
- Handling Slack events (messages, reactions, app mentions)
- Integrating AI/LLM capabilities into Slack apps
- Configuring app manifests for new Slack apps
- Debugging Slack-specific issues
- Setting up Socket Mode connections

## Quick Reference

### App Initialization (Socket Mode)

```javascript
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

(async () => {
  await app.start();
  console.log("Bolt app is running!");
})();
```

### Required Environment Variables

| Variable | Description | Format |
|----------|-------------|--------|
| `SLACK_BOT_TOKEN` | Bot OAuth token | `xoxb-*` |
| `SLACK_APP_TOKEN` | App-level token for Socket Mode | `xapp-*` |
| `SLACK_SIGNING_SECRET` | Verifies incoming requests | String |

### Listener Methods

| Method | Purpose | Requires `ack()` |
|--------|---------|------------------|
| `app.command(name, fn)` | Slash commands | Yes |
| `app.message([pattern,] fn)` | Message events | No |
| `app.event(type, fn)` | Events API | No |
| `app.action(id, fn)` | Interactive components | Yes |
| `app.shortcut(id, fn)` | Global/message shortcuts | Yes |
| `app.view(id, fn)` | Modal submissions | Yes |

### Critical Pattern: Acknowledge First

All interactive handlers MUST call `ack()` within 3 seconds:

```javascript
app.command("/mycommand", async ({ command, ack, respond }) => {
  await ack();  // MUST be first
  // Then process...
  await respond("Response here");
});
```

## Core Concepts

### Slash Commands

```javascript
app.command("/lookup", async ({ command, ack, respond, client }) => {
  await ack();

  const query = command.text;
  if (!query) {
    await respond({
      response_type: "ephemeral",
      text: "Please provide an argument: `/lookup [query]`",
    });
    return;
  }

  // Process and respond
  await respond(`Results for: ${query}`);
});
```

### Message Events

```javascript
// Pattern matching
app.message(/^(hi|hello|hey)/i, async ({ message, say }) => {
  await say(`Hello <@${message.user}>!`);
});

// All messages (filter bots in middleware)
app.message(async ({ message, say }) => {
  if (message.bot_id) return;
  await say("Got your message!");
});
```

### Interactive Components (Actions)

```javascript
app.action("approve_button", async ({ ack, body, client }) => {
  await ack();

  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: "Request approved!",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Request approved" },
      },
    ],
  });
});
```

### Modals

Opening a modal:

```javascript
app.shortcut("create_task", async ({ ack, shortcut, client }) => {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "task_modal",
      title: { type: "plain_text", text: "Create Task" },
      submit: { type: "plain_text", text: "Create" },
      blocks: [
        {
          type: "input",
          block_id: "task_name",
          label: { type: "plain_text", text: "Task Name" },
          element: {
            type: "plain_text_input",
            action_id: "task_name_input",
          },
        },
      ],
    },
  });
});
```

Handling submission:

```javascript
app.view("task_modal", async ({ ack, body, view, client }) => {
  await ack();

  const taskName = view.state.values.task_name.task_name_input.value;

  await client.chat.postMessage({
    channel: body.user.id,
    text: `Task "${taskName}" created!`,
  });
});
```

### App Home

```javascript
app.event("app_home_opened", async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      blocks: [
        {
          type: "header",
          text: { type: "plain_text", text: "Welcome!" },
        },
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `Hello <@${event.user}>!`,
          },
        },
      ],
    },
  });
});
```

## Error Handling

### Safe Response Helper

```javascript
async function safeRespond(respond, message, logger) {
  try {
    await respond(message);
  } catch (error) {
    logger.error("Failed to respond:", error);
  }
}
```

### Global Error Handler

```javascript
app.error(async ({ error, logger, body }) => {
  logger.error("Unhandled error:", error);
  // Report to monitoring service
});
```

### Listener-Level Handling

```javascript
app.command("/risky", async ({ ack, respond, logger }) => {
  await ack();

  try {
    await riskyOperation();
    await respond("Success!");
  } catch (error) {
    logger.error("Command failed:", error);
    await respond({
      response_type: "ephemeral",
      text: "An error occurred. Please try again.",
    });
  }
});
```

## Block Kit Quick Reference

### Block Limits

- Messages: Up to 50 blocks
- Modals/Home tabs: Up to 100 blocks

### Essential Blocks

**Section** - Primary content display:
```json
{
  "type": "section",
  "text": { "type": "mrkdwn", "text": "*Title*\nDescription" }
}
```

**Actions** - Interactive elements container:
```json
{
  "type": "actions",
  "elements": [
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Click" },
      "action_id": "button_1"
    }
  ]
}
```

**Input** - Form fields (modals/Home only):
```json
{
  "type": "input",
  "block_id": "input_1",
  "label": { "type": "plain_text", "text": "Enter text" },
  "element": {
    "type": "plain_text_input",
    "action_id": "text_input"
  }
}
```

### Button Styles

- No style: Standard gray
- `"style": "primary"`: Green - affirmative actions
- `"style": "danger"`: Red - destructive actions

### Text Formatting (mrkdwn)

| Syntax | Result |
|--------|--------|
| `*bold*` | **bold** |
| `_italic_` | _italic_ |
| `~strike~` | ~~strike~~ |
| `` `code` `` | `code` |
| `<@U12345>` | @user mention |
| `<#C12345>` | #channel link |

## Middleware

### Global Middleware

```javascript
app.use(async ({ payload, next, logger }) => {
  logger.info(`Received: ${payload.type}`);
  await next();
});
```

### Listener Middleware

```javascript
async function noBotMessages({ message, next }) {
  if (!message.bot_id) {
    await next();
  }
}

app.message(noBotMessages, async ({ message, say }) => {
  await say("Hello human!");
});
```

### Admin-Only Commands

```javascript
async function adminOnly({ context, next, respond }) {
  const adminUsers = ["U12345", "U67890"];
  if (adminUsers.includes(context.userId)) {
    await next();
  } else {
    await respond("This command is for admins only.");
  }
}

app.command("/admin", adminOnly, async ({ ack, respond }) => {
  await ack();
  await respond("Admin command executed.");
});
```

## Reference Files

Detailed documentation is organized in reference files:

| File | Contents |
|------|----------|
| `references/bolt-patterns.md` | Complete Bolt SDK patterns, listeners, middleware |
| `references/block-kit.md` | All blocks, elements, composition objects, surfaces |
| `references/app-manifest.md` | Manifest structure, scopes, events, examples |
| `references/ai-features.md` | Loading states, streaming, suggested prompts |
| `references/common-patterns.md` | Production patterns, error handling, security |

To search for specific topics:
```
grep -n "modal" references/*.md
grep -n "button" references/block-kit.md
grep -n "socket" references/bolt-patterns.md
```

## Best Practices Checklist

### Development
- [ ] Use Socket Mode for development (no public URL required)
- [ ] Always `ack()` interactive components within 3 seconds
- [ ] Process heavy work asynchronously after acknowledging
- [ ] Implement both listener-level and global error handlers

### Block Kit
- [ ] Keep modals glanceable - avoid excessive inputs
- [ ] Use primary/danger button styles sparingly (one per group)
- [ ] Always provide fallback `text` for accessibility
- [ ] Test on mobile - Block Kit is responsive

### Security
- [ ] Never log tokens
- [ ] Sanitize user inputs to prevent injection
- [ ] Implement token rotation for production
- [ ] Verify request signatures (Bolt handles automatically)

### Performance
- [ ] Respond within 3 seconds to avoid retries
- [ ] Use message updates instead of new messages when appropriate
- [ ] Cache user data to reduce API calls
- [ ] Batch API calls where possible

## Common Issues

### "dispatch_failed" error
Ensure `ack()` is called within 3 seconds of receiving the interaction.

### Modal not opening
Check that `trigger_id` is valid (expires in 3 seconds) and the view structure is correct.

### Socket Mode not connecting
Verify `SLACK_APP_TOKEN` (xapp-*) is set and Socket Mode is enabled in app settings.

### Events not received
Check event subscriptions in app manifest and ensure required scopes are granted.
