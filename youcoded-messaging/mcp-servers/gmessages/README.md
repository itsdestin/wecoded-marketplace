# gmessages MCP Server

An MCP (Model Context Protocol) server that provides SMS/RCS messaging capabilities through Google Messages. It connects to the Google Messages web interface using the [mautrix-gmessages](https://go.mau.fi/mautrix-gmessages) library, allowing Claude to read and send text messages.

## Features

- Check pairing/connection status
- Initiate Google account (Gaia) pairing via emoji verification
- List recent conversations
- Read messages from a specific conversation (by contact name or ID)
- Search across all messages
- Retrieve recent messages since a given time
- Send SMS/RCS messages

## Prerequisites

- **Go 1.26+** (or the version specified in `go.mod`)
- **Google Messages** set up on your Android phone
- A paired Google Messages web session (the server handles pairing via Gaia auth cookies)

## Build

Native build (for local development):

```bash
cd youcoded-messaging/mcp-servers/gmessages
go build -o gmessages-mcp .
```

Windows program shipped in this repo (`gmessages.exe`). Rebuild it with exactly this command (works from Linux or Windows; same settings as the original build: 64-bit Windows, no C compiler, no extra flags):

```bash
cd youcoded-messaging/mcp-servers/gmessages
CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -buildmode=exe -o gmessages.exe .
go version -m gmessages.exe   # confirm the module versions you expect are embedded
```

Rebuild and commit the exe whenever `go.mod` changes (for example a security bump): users run the committed exe, so a dependency update does nothing until it is rebuilt. Check with `go run golang.org/x/vuln/cmd/govulncheck@latest -mode=binary gmessages.exe`.

## MCP Server Configuration

Add to your Claude configuration (e.g., `~/.claude.json`):

```json
{
  "mcpServers": {
    "gmessages": {
      "type": "stdio",
      "command": "/path/to/gmessages-mcp"
    }
  }
}
```

## Pairing

1. Start the server and call `gmessages_status` to check connection state.
2. If not paired, call `gmessages_pair` with your Google auth cookies from `messages.google.com` (or place them in `data/cookies.json` next to the binary).
3. Confirm the matching emoji on your phone to complete pairing.

## Chrome Extension

The `chrome-extension/` directory contains a helper extension for extracting Google auth cookies from your browser session at `messages.google.com`. Load it as an unpacked extension in Chrome to simplify cookie retrieval for pairing.
