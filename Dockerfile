FROM golang:1.21-alpine AS builder

WORKDIR /app

COPY go.mod go.sum ./
RUN go mod download

COPY . .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o mcp-slackbot

FROM alpine:3.19

WORKDIR /app

COPY --from=builder /app/mcp-slackbot ./mcp-slackbot

EXPOSE 3001

CMD ["./mcp-slackbot"]
