# Bolt for JavaScript Patterns & Best Practices

## App Initialization

### Socket Mode (Recommended)

```javascript
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
});

(async () => {
  await app.start();
  console.log("Bolt app is running in Socket Mode!");
})();
```

**Advantages:**
- No public URL required
- Real-time event delivery
- Simpler firewall configuration
- Better for development and enterprise scenarios

**Requirements:**
- Bolt for JavaScript v3.0.0+
- Socket Mode enabled in app configuration
- App-level token (xapp-*)

### HTTP Mode

```javascript
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
});

(async () => {
  await app.start(process.env.PORT || 3000);
  console.log("Bolt app is running!");
})();
```

### Custom SocketModeReceiver with OAuth

```javascript
const { App, SocketModeReceiver } = require("@slack/bolt");

const receiver = new SocketModeReceiver({
  appToken: process.env.SLACK_APP_TOKEN,
  clientId: process.env.SLACK_CLIENT_ID,
  clientSecret: process.env.SLACK_CLIENT_SECRET,
  stateSecret: process.env.SLACK_STATE_SECRET,
  scopes: ["chat:write", "commands"],
});

const app = new App({
  receiver,
});
```

### App Configuration Options

| Option | Type | Description |
|--------|------|-------------|
| `token` | string | Bot token for Web API calls |
| `signingSecret` | string | Verifies incoming Slack events |
| `socketMode` | boolean | Enable WebSocket connection |
| `appToken` | string | App-level token for Socket Mode |
| `authorize` | function | Multi-team token determination |
| `logger` | Logger | Custom logger implementation |
| `logLevel` | LogLevel | DEBUG, INFO, WARN, ERROR |
| `ignoreSelf` | boolean | Ignore app's own messages (default: true) |
| `developerMode` | boolean | DEBUG logging + Socket Mode |

---

## Listener Methods

| Method | Purpose | Required Acknowledgment |
|--------|---------|-------------------------|
| `app.event(eventType, fn)` | Listens for Events API events | No |
| `app.message([pattern,] fn)` | Convenience method for message events | No |
| `app.action(actionId, fn)` | Responds to Block Kit interactions | Yes (`ack()`) |
| `app.shortcut(callbackId, fn)` | Handles global/message shortcuts | Yes (`ack()`) |
| `app.view(callbackId, fn)` | Processes modal submissions | Yes (`ack()`) |
| `app.command(commandName, fn)` | Listens for slash commands | Yes (`ack()`) |
| `app.options(actionId, fn)` | Handles external data requests | Yes (`ack()`) |

### Listener Function Arguments

All listeners receive these arguments:

| Argument | Description |
|----------|-------------|
| `payload` | The unwrapped event content |
| `say` | Function to send messages (message, event, action, command) |
| `ack` | Acknowledge receipt (required for interactive components) |
| `client` | Web API client with associated token |
| `respond` | Responds via response_url when available |
| `context` | Event context with app data |
| `body` | Complete request body |
| `logger` | Application logger instance |

---

## Slash Commands

### Basic Command

```javascript
app.command("/hello", async ({ command, ack, respond }) => {
  await ack();
  await respond(`Hello, <@${command.user_id}>!`);
});
```

### Command with Arguments

```javascript
app.command("/lookup", async ({ command, ack, respond, client }) => {
  await ack();

  const args = command.text.split(" ");
  const query = args[0];

  if (!query) {
    await respond({
      response_type: "ephemeral",
      text: "Please provide a search term: `/lookup <term>`",
    });
    return;
  }

  // Process command...
  await respond(`Looking up: ${query}`);
});
```

### RegExp Matching

```javascript
app.command(/\/task-.*/, async ({ command, ack, respond }) => {
  await ack();
  // Handles /task-create, /task-delete, /task-list, etc.
});
```

---

## Message Events

### Listen to All Messages

```javascript
app.message(async ({ message, say }) => {
  console.log(`Message: ${message.text}`);
});
```

### Pattern Matching

```javascript
app.message("hello", async ({ message, say }) => {
  await say(`Hey there <@${message.user}>!`);
});
```

### RegExp Matching

```javascript
app.message(/^(hi|hello|hey).*$/i, async ({ message, say }) => {
  await say({
    text: `Hi <@${message.user}>! How can I help?`,
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `Hi <@${message.user}>! :wave: How can I help you today?`,
        },
      },
    ],
  });
});
```

---

## Action Handlers

### Button Action

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
        text: { type: "mrkdwn", text: "Request has been approved" },
      },
    ],
  });
});
```

### Action with Constraints

```javascript
app.action(
  { action_id: /^select_.*/, block_id: "options_block" },
  async ({ ack, action, respond }) => {
    await ack();
    await respond(`You selected: ${action.selected_option.value}`);
  }
);
```

---

## Shortcuts

### Global Shortcut

```javascript
app.shortcut("create_task", async ({ ack, shortcut, client }) => {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "task_modal",
      title: { type: "plain_text", text: "Create Task" },
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
      submit: { type: "plain_text", text: "Create" },
    },
  });
});
```

### Message Shortcut

```javascript
app.shortcut("share_message", async ({ ack, shortcut, client }) => {
  await ack();

  const messageText = shortcut.message.text;
  // Process message shortcut...
});
```

---

## View Submissions (Modals)

### Basic Submission

```javascript
app.view("task_modal", async ({ ack, body, view, client }) => {
  await ack();

  const user = body.user.id;
  const taskName = view.state.values.task_name.task_name_input.value;

  await client.chat.postMessage({
    channel: user,
    text: `Task "${taskName}" created successfully!`,
  });
});
```

### With Validation Errors

```javascript
app.view("validated_modal", async ({ ack, view }) => {
  const values = view.state.values;
  const email = values.email_block.email_input.value;

  if (!email.includes("@")) {
    await ack({
      response_action: "errors",
      errors: {
        email_block: "Please enter a valid email address",
      },
    });
    return;
  }

  await ack();
  // Process valid submission
});
```

### Update View on Submission

```javascript
app.view("step1_modal", async ({ ack, view }) => {
  await ack({
    response_action: "update",
    view: {
      type: "modal",
      callback_id: "step2_modal",
      title: { type: "plain_text", text: "Step 2" },
      blocks: [/* Step 2 blocks */],
      submit: { type: "plain_text", text: "Complete" },
    },
  });
});
```

---

## Events

### App Home Opened

```javascript
app.event("app_home_opened", async ({ event, client }) => {
  await client.views.publish({
    user_id: event.user,
    view: {
      type: "home",
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Welcome, <@${event.user}>!*`,
          },
        },
      ],
    },
  });
});
```

### User Joined Team

```javascript
app.event("team_join", async ({ event, client }) => {
  await client.chat.postMessage({
    channel: event.user.id,
    text: "Welcome to the team!",
  });
});
```

### Reaction Added

```javascript
app.event("reaction_added", async ({ event, client }) => {
  if (event.reaction === "white_check_mark") {
    // Handle task completion...
  }
});
```

---

## Middleware

### Global Middleware

```javascript
// Logging middleware
app.use(async ({ payload, next, logger }) => {
  logger.info(`Received event: ${payload.type}`);
  await next();
});

// Authentication middleware
app.use(async ({ context, next, client }) => {
  try {
    const userInfo = await client.users.info({ user: context.userId });
    context.user = userInfo.user;
    await next();
  } catch (error) {
    // Handle auth error
  }
});

// Rate limiting middleware
const rateLimits = new Map();

app.use(async ({ body, next }) => {
  const userId = body.user?.id || body.user_id;
  const now = Date.now();
  const lastRequest = rateLimits.get(userId) || 0;

  if (now - lastRequest < 1000) {
    return; // Rate limited
  }

  rateLimits.set(userId, now);
  await next();
});
```

### Listener Middleware

```javascript
// Filter bot messages
async function noBotMessages({ message, next }) {
  if (!message.bot_id) {
    await next();
  }
}

// Admin only
async function adminOnly({ context, next, respond }) {
  const adminUsers = ["U12345", "U67890"];
  if (adminUsers.includes(context.userId)) {
    await next();
  } else {
    await respond("Sorry, this command is for admins only.");
  }
}

// Usage
app.message(noBotMessages, async ({ message, say }) => {
  await say("Hello human!");
});

app.command("/admin", adminOnly, async ({ ack, respond }) => {
  await ack();
  await respond("Admin command executed.");
});
```

### Built-in Middleware

**Global:**
- `ignoreSelf()` - Filters app's own events (enabled by default)
- `onlyActions`, `onlyCommands`, `onlyEvents`, `onlyOptions`, `onlyShortcuts`, `onlyViewActions`

**Listener:**
- `directMention()` - Filters messages without @-mention
- `matchCommandName(pattern)` - Pattern-matches command names
- `matchConstraints(constraint)` - Filters by block_id, action_id, callback_id
- `matchEventType(pattern)` - Filters by event type
- `matchMessage(pattern)` - Filters by message content
- `subtype(type)` - Filters by message subtype

---

## Context Object

All listeners have access to a `context` object for enriching requests:

```javascript
app.use(async ({ context, client, next }) => {
  const userInfo = await client.users.info({ user: context.userId });
  context.tz_offset = userInfo.user.tz_offset;
  await next();
});
```

---

## Response Patterns

### Using say()

```javascript
// Simple text
await say("Hello!");

// With blocks
await say({
  text: "Fallback text",
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: "*Hello!*" },
    },
  ],
});
```

### Using respond()

```javascript
// Replace original message
await respond({
  replace_original: true,
  text: "Updated message",
});

// Delete original message
await respond({
  delete_original: true,
});

// In-channel response (for slash commands)
await respond({
  response_type: "in_channel",
  text: "Everyone can see this!",
});

// Ephemeral response
await respond({
  response_type: "ephemeral",
  text: "Only you can see this",
});
```

### Using client

```javascript
// Post message
await client.chat.postMessage({
  channel: channelId,
  text: "Message content",
  blocks: [/* blocks */],
});

// Update message
await client.chat.update({
  channel: channelId,
  ts: messageTs,
  text: "Updated content",
});

// Post ephemeral
await client.chat.postEphemeral({
  channel: channelId,
  user: userId,
  text: "Only visible to you",
});
```

---

## Error Handling

### Listener-Level

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

### Global Error Handler

```javascript
app.error(async ({ error, logger, context, body }) => {
  logger.error("Unhandled error:", error);

  await reportError(error, {
    user: body?.user?.id,
    team: body?.team?.id,
    type: body?.type,
  });
});
```

### Safe Response Helper

```javascript
async function safeRespond(respond, message, logger) {
  try {
    await respond(message);
  } catch (error) {
    logger.error("Failed to respond:", error);
  }
}

// Usage
app.command("/cmd", async ({ ack, respond, logger }) => {
  await ack();
  await safeRespond(respond, "Response message", logger);
});
```

### HTTPReceiver-Specific Handlers

| Handler | Purpose |
|---------|---------|
| `dispatchErrorHandler` | Unexpected path requests |
| `processEventErrorHandler` | Middleware/authorization exceptions |
| `unhandledRequestHandler` | Unacknowledged Slack requests |
| `unhandledRequestTimeoutMillis` | Default 3001ms |

---

## Custom Routes (Health Checks)

```javascript
const { App } = require("@slack/bolt");

const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN,
  customRoutes: [
    {
      path: "/health",
      method: ["GET"],
      handler: (req, res) => {
        res.writeHead(200);
        res.end(JSON.stringify({ status: "ok" }));
      },
    },
  ],
});
```

---

## Graceful Shutdown

```javascript
const signals = ["SIGTERM", "SIGINT"];

signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down...`);
    await app.stop();
    process.exit(0);
  });
});
```

---

## Sources

- [Bolt JS Documentation](https://docs.slack.dev/tools/bolt-js/)
- [Bolt JS Reference](https://docs.slack.dev/tools/bolt-js/reference/)
