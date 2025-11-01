package handlers

import (
	"log"

	"github.com/slack-go/slack/socketmode"
)

// EventHandler currently logs unhandled socket mode events. It can be extended to
// support interactive components or events in the future.
type EventHandler struct{}

// NewEventHandler constructs an EventHandler instance.
func NewEventHandler() *EventHandler {
	return &EventHandler{}
}

// Handle processes a generic socket mode event.
func (h *EventHandler) Handle(evt socketmode.Event) {
	log.Printf("received unsupported event type: %s", evt.Type)
}
