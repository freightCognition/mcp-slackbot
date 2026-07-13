# Common Slack App Patterns

Production-ready patterns for building robust Slack applications.

---

## Error Handling Patterns

### Safe Response Helper

Wrap all respond calls to prevent unhandled errors:

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

### Ephemeral Error Messages

Show errors only to the user who triggered them:

```javascript
app.command("/lookup", async ({ command, ack, respond, logger }) => {
  await ack();

  try {
    const result = await doLookup(command.text);
    await respond({
      response_type: "in_channel",
      text: result,
    });
  } catch (error) {
    logger.error("Lookup failed:", error);
    await respond({
      response_type: "ephemeral",
      text: "An error occurred. Please try again.",
    });
  }
});
```

### Global Error Handler

Catch all unhandled errors:

```javascript
app.error(async ({ error, logger, body }) => {
  logger.error("Unhandled error:", {
    error: error.message,
    stack: error.stack,
    user: body?.user?.id,
    team: body?.team?.id,
    type: body?.type,
  });

  // Report to monitoring service
  await reportToMonitoring(error, body);
});
```

---

## Input Validation Patterns

### Command Argument Validation

```javascript
app.command("/lookup", async ({ command, ack, respond }) => {
  await ack();

  const query = command.text.trim();

  // Validate required argument
  if (!query) {
    await respond({
      response_type: "ephemeral",
      text: "Usage: `/lookup [query]`\nPlease provide a search term.",
    });
    return;
  }

  // Validate format (e.g., DOT number)
  if (!/^\d+$/.test(query)) {
    await respond({
      response_type: "ephemeral",
      text: "Invalid format. Please provide a numeric ID.",
    });
    return;
  }

  // Process valid input
  const result = await performLookup(query);
  await respond(result);
});
```

### Modal Input Validation

```javascript
app.view("form_modal", async ({ ack, view }) => {
  const values = view.state.values;
  const errors = {};

  // Email validation
  const email = values.email_block.email_input.value;
  if (!email.includes("@")) {
    errors.email_block = "Please enter a valid email address";
  }

  // Length validation
  const name = values.name_block.name_input.value;
  if (name.length < 2) {
    errors.name_block = "Name must be at least 2 characters";
  }

  // Return errors if any
  if (Object.keys(errors).length > 0) {
    await ack({
      response_action: "errors",
      errors,
    });
    return;
  }

  await ack();
  // Process valid submission
});
```

---

## Token Refresh Pattern

Handle expired API tokens with automatic refresh:

```javascript
let bearerToken = process.env.BEARER_TOKEN;
let refreshToken = process.env.REFRESH_TOKEN;
let isRefreshing = false;
let refreshPromise = null;

async function refreshTokens() {
  const response = await axios.post(TOKEN_ENDPOINT, {
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  bearerToken = response.data.access_token;
  if (response.data.refresh_token) {
    refreshToken = response.data.refresh_token;
  }

  return bearerToken;
}

async function apiCallWithRefresh(config) {
  try {
    return await axios({
      ...config,
      headers: {
        ...config.headers,
        Authorization: `Bearer ${bearerToken}`,
      },
    });
  } catch (error) {
    if (error.response?.status === 401) {
      // Prevent concurrent refresh attempts
      if (!isRefreshing) {
        isRefreshing = true;
        refreshPromise = refreshTokens().finally(() => {
          isRefreshing = false;
        });
      }

      await refreshPromise;

      // Retry with new token
      return axios({
        ...config,
        headers: {
          ...config.headers,
          Authorization: `Bearer ${bearerToken}`,
        },
      });
    }
    throw error;
  }
}
```

---

## Message Update Pattern

Update messages after processing:

```javascript
app.action("process_button", async ({ ack, body, client }) => {
  await ack();

  // Update message to show processing
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: "Processing...",
    blocks: [
      {
        type: "section",
        text: { type: "mrkdwn", text: "Processing your request..." },
      },
    ],
  });

  try {
    const result = await processRequest(body.actions[0].value);

    // Update with result
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Completed",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: `Result: ${result}` },
        },
      ],
    });
  } catch (error) {
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: "Error",
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: "An error occurred. Please try again." },
        },
      ],
    });
  }
});
```

---

## Multi-Step Modal Pattern

Create wizard-like flows:

```javascript
// Step 1: Open initial modal
app.shortcut("start_wizard", async ({ ack, shortcut, client }) => {
  await ack();

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      callback_id: "wizard_step1",
      title: { type: "plain_text", text: "Step 1 of 3" },
      submit: { type: "plain_text", text: "Next" },
      blocks: [
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "Name" },
          element: {
            type: "plain_text_input",
            action_id: "name_input",
          },
        },
      ],
    },
  });
});

// Step 2: Update to next step
app.view("wizard_step1", async ({ ack, view }) => {
  const name = view.state.values.name_block.name_input.value;

  await ack({
    response_action: "update",
    view: {
      type: "modal",
      callback_id: "wizard_step2",
      private_metadata: JSON.stringify({ name }),
      title: { type: "plain_text", text: "Step 2 of 3" },
      submit: { type: "plain_text", text: "Next" },
      blocks: [
        {
          type: "input",
          block_id: "email_block",
          label: { type: "plain_text", text: "Email" },
          element: {
            type: "email_text_input",
            action_id: "email_input",
          },
        },
      ],
    },
  });
});

// Step 3: Final step
app.view("wizard_step2", async ({ ack, view }) => {
  const metadata = JSON.parse(view.private_metadata);
  const email = view.state.values.email_block.email_input.value;

  await ack({
    response_action: "update",
    view: {
      type: "modal",
      callback_id: "wizard_complete",
      private_metadata: JSON.stringify({ ...metadata, email }),
      title: { type: "plain_text", text: "Step 3 of 3" },
      submit: { type: "plain_text", text: "Submit" },
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Review:*\nName: ${metadata.name}\nEmail: ${email}`,
          },
        },
      ],
    },
  });
});

// Complete wizard
app.view("wizard_complete", async ({ ack, body, view, client }) => {
  await ack();

  const data = JSON.parse(view.private_metadata);

  // Process final submission
  await client.chat.postMessage({
    channel: body.user.id,
    text: `Registration complete for ${data.name}!`,
  });
});
```

---

## Health Check Pattern

Expose health endpoint for container orchestration:

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
      handler: async (req, res) => {
        const health = {
          status: "ok",
          timestamp: new Date().toISOString(),
          uptime: process.uptime(),
        };

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(health));
      },
    },
  ],
});
```

---

## Graceful Shutdown Pattern

```javascript
const signals = ["SIGTERM", "SIGINT"];

signals.forEach((signal) => {
  process.on(signal, async () => {
    console.log(`Received ${signal}, shutting down gracefully...`);

    try {
      await app.stop();
      console.log("App stopped successfully");
      process.exit(0);
    } catch (error) {
      console.error("Error during shutdown:", error);
      process.exit(1);
    }
  });
});
```

---

## Rate Limiting Pattern

Prevent abuse with per-user rate limiting:

```javascript
const rateLimits = new Map();
const RATE_LIMIT_MS = 1000;
const RATE_LIMIT_MAX = 5;

app.use(async ({ body, next, respond }) => {
  const userId = body.user?.id || body.user_id;
  if (!userId) {
    await next();
    return;
  }

  const now = Date.now();
  const userRequests = rateLimits.get(userId) || [];

  // Remove old requests
  const recentRequests = userRequests.filter(
    (time) => now - time < RATE_LIMIT_MS
  );

  if (recentRequests.length >= RATE_LIMIT_MAX) {
    if (respond) {
      await respond({
        response_type: "ephemeral",
        text: "Too many requests. Please slow down.",
      });
    }
    return;
  }

  recentRequests.push(now);
  rateLimits.set(userId, recentRequests);

  await next();
});
```

---

## Structured Logging Pattern

```javascript
const pino = require("pino");

const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  formatters: {
    level: (label) => ({ level: label }),
  },
});

app.command("/cmd", async ({ command, ack, respond }) => {
  await ack();

  logger.info({
    event: "command_received",
    command: command.command,
    user: command.user_id,
    team: command.team_id,
    text: command.text,
  });

  try {
    const result = await processCommand(command);
    
    logger.info({
      event: "command_success",
      command: command.command,
      user: command.user_id,
    });

    await respond(result);
  } catch (error) {
    logger.error({
      event: "command_error",
      command: command.command,
      user: command.user_id,
      error: error.message,
      stack: error.stack,
    });

    await respond({
      response_type: "ephemeral",
      text: "An error occurred.",
    });
  }
});
```

---

## Approval Workflow Pattern

```javascript
// Send approval request
app.command("/request", async ({ command, ack, client }) => {
  await ack();

  await client.chat.postMessage({
    channel: "approvers-channel",
    text: `New request from <@${command.user_id}>`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "Approval Request" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Requester:*\n<@${command.user_id}>` },
          { type: "mrkdwn", text: `*Request:*\n${command.text}` },
        ],
      },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Approve" },
            style: "primary",
            action_id: "approve_request",
            value: JSON.stringify({
              requester: command.user_id,
              request: command.text,
            }),
          },
          {
            type: "button",
            text: { type: "plain_text", text: "Deny" },
            style: "danger",
            action_id: "deny_request",
            value: JSON.stringify({
              requester: command.user_id,
              request: command.text,
            }),
          },
        ],
      },
    ],
  });
});

// Handle approval
app.action("approve_request", async ({ ack, body, client }) => {
  await ack();

  const data = JSON.parse(body.actions[0].value);

  // Update original message
  await client.chat.update({
    channel: body.channel.id,
    ts: body.message.ts,
    text: "Request approved",
    blocks: [
      {
        type: "section",
        text: {
          type: "mrkdwn",
          text: `*Approved* by <@${body.user.id}>`,
        },
      },
    ],
  });

  // Notify requester
  await client.chat.postMessage({
    channel: data.requester,
    text: `Your request has been approved by <@${body.user.id}>!`,
  });
});
```

---

## Security Best Practices

### Never Log Tokens

```javascript
// BAD - never do this
logger.info({ token: process.env.SLACK_BOT_TOKEN });

// GOOD - log without sensitive data
logger.info({ tokenPresent: !!process.env.SLACK_BOT_TOKEN });
```

### Sanitize User Input

```javascript
function sanitizeInput(input) {
  if (typeof input !== "string") return "";
  
  // Remove control characters
  return input
    .replace(/[\x00-\x1F\x7F]/g, "")
    .trim()
    .slice(0, 1000); // Limit length
}
```

### Verify User Permissions

```javascript
async function isAdmin(client, userId) {
  try {
    const result = await client.users.info({ user: userId });
    return result.user.is_admin || result.user.is_owner;
  } catch {
    return false;
  }
}

app.command("/admin-cmd", async ({ command, ack, respond, client }) => {
  await ack();

  if (!(await isAdmin(client, command.user_id))) {
    await respond({
      response_type: "ephemeral",
      text: "This command requires admin privileges.",
    });
    return;
  }

  // Process admin command
});
```
