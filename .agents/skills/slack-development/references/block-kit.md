# Block Kit Reference

Block Kit is Slack's UI framework for building rich, interactive interfaces. Messages, modals, and App Home surfaces all use Block Kit.

## Limits

| Surface | Max Blocks |
|---------|------------|
| Messages | 50 |
| Modals | 100 |
| Home tabs | 100 |

---

## Blocks

### Section Block

Primary content display block.

```json
{
  "type": "section",
  "block_id": "section_1",
  "text": {
    "type": "mrkdwn",
    "text": "*Section title*\nSome description text"
  },
  "accessory": {
    "type": "button",
    "text": { "type": "plain_text", "text": "Click" },
    "action_id": "button_1"
  }
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "section" |
| `text` | text object | No* | 3000 chars |
| `block_id` | string | No | 255 chars |
| `fields` | array | No* | 10 items, 2000 chars each |
| `accessory` | element | No | - |
| `expand` | boolean | No | - |

*Either `text` or `fields` required

#### Section with Fields

```json
{
  "type": "section",
  "fields": [
    { "type": "mrkdwn", "text": "*Status:*\nActive" },
    { "type": "mrkdwn", "text": "*Priority:*\nHigh" },
    { "type": "mrkdwn", "text": "*Created:*\nJan 15, 2026" },
    { "type": "mrkdwn", "text": "*Assignee:*\n<@U12345>" }
  ]
}
```

---

### Actions Block

Container for interactive elements.

```json
{
  "type": "actions",
  "block_id": "actions_1",
  "elements": [
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Approve" },
      "style": "primary",
      "action_id": "approve"
    },
    {
      "type": "button",
      "text": { "type": "plain_text", "text": "Deny" },
      "style": "danger",
      "action_id": "deny"
    }
  ]
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "actions" |
| `elements` | array | Yes | 25 items |
| `block_id` | string | No | 255 chars |

---

### Input Block

Form inputs for modals and Home tabs only.

```json
{
  "type": "input",
  "block_id": "input_1",
  "label": { "type": "plain_text", "text": "Enter your name" },
  "element": {
    "type": "plain_text_input",
    "action_id": "name_input"
  },
  "hint": { "type": "plain_text", "text": "Your full name" },
  "optional": false
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "input" |
| `label` | plain_text | Yes | 2000 chars |
| `element` | input element | Yes | - |
| `block_id` | string | No | 255 chars |
| `hint` | plain_text | No | 2000 chars |
| `optional` | boolean | No | default: false |
| `dispatch_action` | boolean | No | default: false |

---

### Header Block

Large text header.

```json
{
  "type": "header",
  "block_id": "header_1",
  "text": { "type": "plain_text", "text": "Dashboard" }
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "header" |
| `text` | plain_text | Yes | 150 chars |
| `block_id` | string | No | 255 chars |

---

### Context Block

Secondary/contextual information.

```json
{
  "type": "context",
  "block_id": "context_1",
  "elements": [
    {
      "type": "image",
      "image_url": "https://example.com/avatar.png",
      "alt_text": "User"
    },
    {
      "type": "mrkdwn",
      "text": "Created by <@U12345> on Jan 15"
    }
  ]
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "context" |
| `elements` | array | Yes | 10 items |
| `block_id` | string | No | 255 chars |

---

### Divider Block

Visual separator.

```json
{
  "type": "divider",
  "block_id": "divider_1"
}
```

---

### Image Block

Standalone image.

```json
{
  "type": "image",
  "block_id": "image_1",
  "image_url": "https://example.com/image.png",
  "alt_text": "Description",
  "title": { "type": "plain_text", "text": "Image Title" }
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "image" |
| `image_url` | string | Yes | 3000 chars |
| `alt_text` | string | Yes | 2000 chars |
| `title` | plain_text | No | 2000 chars |
| `block_id` | string | No | 255 chars |

---

## Elements

### Button Element

```json
{
  "type": "button",
  "text": { "type": "plain_text", "text": "Click Me" },
  "action_id": "button_1",
  "value": "button_value",
  "style": "primary",
  "url": "https://example.com",
  "confirm": {
    "title": { "type": "plain_text", "text": "Confirm" },
    "text": { "type": "plain_text", "text": "Are you sure?" },
    "confirm": { "type": "plain_text", "text": "Yes" },
    "deny": { "type": "plain_text", "text": "No" }
  }
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "button" |
| `text` | plain_text | Yes | 75 chars |
| `action_id` | string | No | 255 chars |
| `value` | string | No | 2000 chars |
| `url` | string | No | 3000 chars |
| `style` | string | No | "primary" or "danger" |
| `confirm` | confirm object | No | - |
| `accessibility_label` | string | No | 75 chars |

**Styles:**
- Default (no style): Standard gray
- `primary`: Green - use for affirmative actions
- `danger`: Red - use for destructive actions

---

### Static Select Element

Dropdown menu with predefined options.

```json
{
  "type": "static_select",
  "action_id": "select_1",
  "placeholder": { "type": "plain_text", "text": "Select an option" },
  "initial_option": {
    "text": { "type": "plain_text", "text": "Option 1" },
    "value": "option_1"
  },
  "options": [
    {
      "text": { "type": "plain_text", "text": "Option 1" },
      "value": "option_1"
    },
    {
      "text": { "type": "plain_text", "text": "Option 2" },
      "value": "option_2"
    }
  ]
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "static_select" |
| `action_id` | string | Yes | 255 chars |
| `options` | array | Yes* | 100 items |
| `option_groups` | array | No* | 100 groups |
| `placeholder` | plain_text | No | 150 chars |
| `initial_option` | option | No | - |
| `confirm` | confirm object | No | - |

*Either `options` or `option_groups`

---

### Multi-Select Element

```json
{
  "type": "multi_static_select",
  "action_id": "multi_select_1",
  "placeholder": { "type": "plain_text", "text": "Select options" },
  "options": [
    { "text": { "type": "plain_text", "text": "A" }, "value": "a" },
    { "text": { "type": "plain_text", "text": "B" }, "value": "b" },
    { "text": { "type": "plain_text", "text": "C" }, "value": "c" }
  ],
  "max_selected_items": 2
}
```

---

### Plain Text Input Element

```json
{
  "type": "plain_text_input",
  "action_id": "text_input_1",
  "placeholder": { "type": "plain_text", "text": "Enter text..." },
  "initial_value": "Default text",
  "multiline": false,
  "min_length": 1,
  "max_length": 500,
  "focus_on_load": true
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "plain_text_input" |
| `action_id` | string | Yes | 255 chars |
| `placeholder` | plain_text | No | 150 chars |
| `initial_value` | string | No | - |
| `multiline` | boolean | No | default: false |
| `min_length` | number | No | 0-3000 |
| `max_length` | number | No | 1-3000 |
| `focus_on_load` | boolean | No | default: false |

---

### Date Picker Element

```json
{
  "type": "datepicker",
  "action_id": "date_1",
  "placeholder": { "type": "plain_text", "text": "Select date" },
  "initial_date": "2026-01-17"
}
```

---

### Time Picker Element

```json
{
  "type": "timepicker",
  "action_id": "time_1",
  "placeholder": { "type": "plain_text", "text": "Select time" },
  "initial_time": "13:00"
}
```

---

### Checkboxes Element

```json
{
  "type": "checkboxes",
  "action_id": "checkboxes_1",
  "options": [
    {
      "text": { "type": "mrkdwn", "text": "*Option A*" },
      "value": "a",
      "description": { "type": "plain_text", "text": "Description" }
    },
    {
      "text": { "type": "mrkdwn", "text": "*Option B*" },
      "value": "b"
    }
  ],
  "initial_options": [
    { "text": { "type": "mrkdwn", "text": "*Option A*" }, "value": "a" }
  ]
}
```

---

### Radio Buttons Element

```json
{
  "type": "radio_buttons",
  "action_id": "radio_1",
  "options": [
    { "text": { "type": "plain_text", "text": "Yes" }, "value": "yes" },
    { "text": { "type": "plain_text", "text": "No" }, "value": "no" },
    { "text": { "type": "plain_text", "text": "Maybe" }, "value": "maybe" }
  ]
}
```

---

### Overflow Menu Element

```json
{
  "type": "overflow",
  "action_id": "overflow_1",
  "options": [
    { "text": { "type": "plain_text", "text": "Edit" }, "value": "edit" },
    { "text": { "type": "plain_text", "text": "Delete" }, "value": "delete" },
    {
      "text": { "type": "plain_text", "text": "Open Link" },
      "value": "link",
      "url": "https://example.com"
    }
  ]
}
```

---

## Composition Objects

### Text Object

```json
// Plain text
{ "type": "plain_text", "text": "Hello", "emoji": true }

// Markdown
{ "type": "mrkdwn", "text": "*Bold* _italic_ `code`" }
```

**Markdown formatting:**

| Syntax | Result |
|--------|--------|
| `*bold*` | **bold** |
| `_italic_` | _italic_ |
| `~strike~` | ~~strike~~ |
| `` `code` `` | `code` |
| `<https://url\|text>` | [text](https://url) |
| `<@U12345>` | @user mention |
| `<#C12345>` | #channel link |
| `:emoji:` | emoji |

---

### Option Object

```json
{
  "text": { "type": "plain_text", "text": "Option Label" },
  "value": "option_value",
  "description": { "type": "plain_text", "text": "Description" },
  "url": "https://example.com"
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `text` | text object | Yes | 75 chars |
| `value` | string | Yes | 150 chars |
| `description` | plain_text | No | 75 chars |
| `url` | string | No | 3000 chars (overflow only) |

---

### Confirmation Dialog Object

```json
{
  "title": { "type": "plain_text", "text": "Confirm Action" },
  "text": { "type": "plain_text", "text": "Are you sure you want to proceed?" },
  "confirm": { "type": "plain_text", "text": "Yes, proceed" },
  "deny": { "type": "plain_text", "text": "Cancel" },
  "style": "danger"
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `title` | plain_text | Yes | 100 chars |
| `text` | text object | Yes | 300 chars |
| `confirm` | plain_text | Yes | 30 chars |
| `deny` | plain_text | Yes | 30 chars |
| `style` | string | No | "primary" or "danger" |

---

## Surfaces

### Modal View

```json
{
  "type": "modal",
  "callback_id": "modal_1",
  "title": { "type": "plain_text", "text": "Modal Title" },
  "submit": { "type": "plain_text", "text": "Submit" },
  "close": { "type": "plain_text", "text": "Cancel" },
  "private_metadata": "{\"key\":\"value\"}",
  "blocks": []
}
```

**Properties:**

| Field | Type | Required | Max |
|-------|------|----------|-----|
| `type` | string | Yes | "modal" |
| `title` | plain_text | Yes | 24 chars |
| `blocks` | array | Yes | 100 blocks |
| `callback_id` | string | No | 255 chars |
| `submit` | plain_text | No* | 24 chars |
| `close` | plain_text | No | 24 chars |
| `private_metadata` | string | No | 3000 chars |
| `notify_on_close` | boolean | No | - |
| `clear_on_close` | boolean | No | - |

*Required if input blocks present

**View Stack:** Up to 3 views simultaneously.

---

### Home Tab View

```json
{
  "type": "home",
  "callback_id": "home_1",
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Welcome!" }
    }
  ]
}
```

---

## Common Patterns

### Approval Message

```json
{
  "blocks": [
    {
      "type": "header",
      "text": { "type": "plain_text", "text": "Approval Request" }
    },
    {
      "type": "section",
      "fields": [
        { "type": "mrkdwn", "text": "*Requester:*\n<@U12345>" },
        { "type": "mrkdwn", "text": "*Amount:*\n$500" }
      ]
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Description:*\nTravel expenses" }
    },
    { "type": "divider" },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Approve" },
          "style": "primary",
          "action_id": "approve",
          "value": "req_123"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Deny" },
          "style": "danger",
          "action_id": "deny",
          "value": "req_123"
        }
      ]
    }
  ]
}
```

### Form Modal

```json
{
  "type": "modal",
  "callback_id": "form_modal",
  "title": { "type": "plain_text", "text": "Submit Report" },
  "submit": { "type": "plain_text", "text": "Submit" },
  "close": { "type": "plain_text", "text": "Cancel" },
  "blocks": [
    {
      "type": "input",
      "block_id": "title_block",
      "label": { "type": "plain_text", "text": "Report Title" },
      "element": {
        "type": "plain_text_input",
        "action_id": "title_input"
      }
    },
    {
      "type": "input",
      "block_id": "type_block",
      "label": { "type": "plain_text", "text": "Report Type" },
      "element": {
        "type": "static_select",
        "action_id": "type_select",
        "options": [
          { "text": { "type": "plain_text", "text": "Bug" }, "value": "bug" },
          { "text": { "type": "plain_text", "text": "Feature" }, "value": "feature" }
        ]
      }
    },
    {
      "type": "input",
      "block_id": "desc_block",
      "label": { "type": "plain_text", "text": "Description" },
      "element": {
        "type": "plain_text_input",
        "action_id": "desc_input",
        "multiline": true
      }
    }
  ]
}
```

### Interactive Message with Select

```json
{
  "text": "Select an option",
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "Choose a priority level:"
      },
      "accessory": {
        "type": "static_select",
        "action_id": "priority_select",
        "placeholder": { "type": "plain_text", "text": "Select priority" },
        "options": [
          { "text": { "type": "plain_text", "text": "Low" }, "value": "low" },
          { "text": { "type": "plain_text", "text": "Medium" }, "value": "medium" },
          { "text": { "type": "plain_text", "text": "High" }, "value": "high" },
          { "text": { "type": "plain_text", "text": "Urgent" }, "value": "urgent" }
        ]
      }
    }
  ]
}
```

---

## All Block Types

| Block | Purpose |
|-------|---------|
| Actions | Container for interactive elements |
| Context | Secondary contextual info |
| Divider | Visual separator |
| File | Displays remote files |
| Header | Large text heading |
| Image | Displays images |
| Input | Form input container (modals/Home) |
| Rich Text | Complex formatted content |
| Section | Primary content display |
| Video | Video content |

## All Element Types

| Element | Purpose |
|---------|---------|
| Button | Clickable button |
| Checkboxes | Multi-select checkboxes |
| Date picker | Date selection |
| Datetime picker | Date and time selection |
| Email input | Email address input |
| File input | File upload |
| Image | Inline image |
| Multi-select menu | Multiple option selection |
| Number input | Numeric input |
| Overflow menu | Dropdown menu |
| Plain-text input | Text input |
| Radio button group | Single selection |
| Rich text input | Formatted text input |
| Select menu | Single option selection |
| Time picker | Time selection |
| URL input | URL input |

---

## Sources

- [Block Kit Documentation](https://docs.slack.dev/block-kit/)
- [Block Kit Blocks](https://docs.slack.dev/reference/block-kit/blocks/)
- [Block Kit Elements](https://docs.slack.dev/reference/block-kit/block-elements/)
- [Composition Objects](https://docs.slack.dev/reference/block-kit/composition-objects/)
