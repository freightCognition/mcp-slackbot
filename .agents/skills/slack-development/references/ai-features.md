# Slack AI Features for App Development

Slack provides specialized features for building AI-powered apps and agents that integrate with Large Language Models (LLMs). These features enable natural conversational interfaces within Slack.

**Important:** Slack does not provide an LLM. Developers must integrate their own LLM (OpenAI, Anthropic, Google, etc.).

---

## AI App Entry Points

### Split View (Assistant Container)

A side-by-side pane within the Slack client where users can have private conversations with AI apps while maintaining context of their current channel or thread.

**Key characteristics:**
- Private conversations alongside channel content
- No slash commands supported in split view
- Thread-based conversation organization
- Available only on paid plans

### Direct Messages

Standard DM channel between user and app.

### App Mentions

Users can @mention the AI app in channels.

---

## AI-Specific Features

### 1. Loading States

Display processing indicators while the LLM generates responses.

```javascript
// Bolt JS
await client.assistant.threads.setStatus({
  channel_id: channelId,
  thread_ts: threadTs,
  status: "is thinking...",
});

// Clear status
await client.assistant.threads.setStatus({
  channel_id: channelId,
  thread_ts: threadTs,
  status: "",
});
```

**Best Practices:**
- Show status immediately after receiving user input
- Use descriptive status messages ("Analyzing...", "Generating response...")
- Clear status before sending the final response

---

### 2. Suggested Prompts

Pre-defined conversation starters to help users interact with the AI.

```javascript
await client.assistant.threads.setSuggestedPrompts({
  channel_id: channelId,
  thread_ts: threadTs,
  prompts: [
    {
      title: "Summarize",
      message: "Summarize this conversation",
    },
    {
      title: "Action Items",
      message: "List the action items from this discussion",
    },
    {
      title: "Key Points",
      message: "What are the key points?",
    },
    {
      title: "Draft Response",
      message: "Draft a response to this message",
    },
  ],
});
```

**Limits:**
- Maximum 4 prompts
- Each prompt has title (button text) and message (sent when clicked)

---

### 3. Text Streaming

Deliver LLM responses progressively as they are generated.

```javascript
// 1. Start the stream
const { stream_id } = await client.chat.startStream({
  channel: channelId,
  thread_ts: threadTs,
});

// 2. Append text chunks as LLM generates
for await (const chunk of llmResponse) {
  await client.chat.appendStream({
    stream_id: streamId,
    text: chunk,
  });
}

// 3. Stop the stream
await client.chat.stopStream({
  stream_id: streamId,
});
```

---

### 4. Thread Management

Organize conversations with descriptive titles.

```javascript
await client.assistant.threads.setTitle({
  channel_id: channelId,
  thread_ts: threadTs,
  title: "Analysis: Q4 Sales Report",
});
```

---

## AI Event Flow

### Thread Initialization

```javascript
app.event("assistant_thread_started", async ({ event, client }) => {
  const { channel_id, thread_ts, context } = event;

  await client.assistant.threads.setSuggestedPrompts({
    channel_id,
    thread_ts,
    prompts: [
      { title: "Help", message: "What can you help me with?" },
      { title: "Analyze", message: "Analyze the current context" },
    ],
  });
});
```

### User Message Handling

```javascript
app.message(async ({ message, client }) => {
  if (message.bot_id) return;

  const { channel, ts, thread_ts, text } = message;
  const threadTs = thread_ts || ts;

  // 1. Set loading status
  await client.assistant.threads.setStatus({
    channel_id: channel,
    thread_ts: threadTs,
    status: "is thinking...",
  });

  try {
    // 2. Get conversation history
    const history = await client.conversations.replies({
      channel: channel,
      ts: threadTs,
      limit: 10,
    });

    // 3. Call your LLM
    const llmResponse = await callLLM(history.messages, text);

    // 4. Clear status and send response
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status: "",
    });

    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: llmResponse,
    });
  } catch (error) {
    await client.assistant.threads.setStatus({
      channel_id: channel,
      thread_ts: threadTs,
      status: "",
    });

    await client.chat.postMessage({
      channel: channel,
      thread_ts: threadTs,
      text: "Sorry, I encountered an error. Please try again.",
    });
  }
});
```

---

## Integration Points

### Reacji-Triggered Analysis

```javascript
app.event("reaction_added", async ({ event, client }) => {
  if (event.reaction === "robot_face") {
    const result = await client.conversations.history({
      channel: event.item.channel,
      latest: event.item.ts,
      inclusive: true,
      limit: 1,
    });

    const message = result.messages[0];
    const analysis = await callLLM(message.text);

    await client.chat.postMessage({
      channel: event.item.channel,
      thread_ts: event.item.ts,
      text: analysis,
    });
  }
});
```

### Message Shortcuts

```javascript
app.shortcut("analyze_message", async ({ ack, shortcut, client }) => {
  await ack();

  const messageText = shortcut.message.text;
  const analysis = await callLLM(messageText);

  await client.views.open({
    trigger_id: shortcut.trigger_id,
    view: {
      type: "modal",
      title: { type: "plain_text", text: "AI Analysis" },
      blocks: [
        {
          type: "section",
          text: { type: "mrkdwn", text: analysis },
        },
      ],
    },
  });
});
```

---

## Constraints

### Platform Constraints

- **Paid plans required** for some AI features
- **No slash commands** in split-view containers
- **Workspace guests** cannot access AI-enabled apps

### Security

- Validate and sanitize user inputs
- Implement guardrails in LLM prompts
- Monitor for data exfiltration attempts
- Use system prompts to establish boundaries

### Performance

- Set status within 3 seconds
- Stream long responses
- Cache appropriately
- Handle timeouts

---

## Required Scopes

| Scope | Purpose |
|-------|---------|
| chat:write | Send messages |
| im:history | Read DM history |
| assistant.threads.read | Read thread context |
| assistant.threads.write | Set status, prompts, titles |

---

## Sources

- [AI Features Documentation](https://docs.slack.dev/ai/)
- [Developing AI Apps](https://docs.slack.dev/ai/developing-ai-apps)
