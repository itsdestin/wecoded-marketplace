# Permissions walkthrough (reference)

This file documents the TCC grants Apple Services needs, what each one enables, and how to re-grant if revoked. `/apple-services-setup` pulls short excerpts from here into its user-facing copy.

## EventKit — Calendar

- **Granted to:** `apple-helper` binary
- **Enables:** read + write events across all calendars
- **First request:** macOS system dialog triggered by `requestFullAccessToEvents`
- **To re-grant:** System Settings → Privacy & Security → Calendars → toggle **apple-helper** on
- **macOS version:** requires 14.0+

## EventKit — Reminders

- **Granted to:** `apple-helper`
- **Enables:** read + write reminders across all lists
- **To re-grant:** System Settings → Privacy & Security → Reminders → toggle **apple-helper** on

## Contacts framework

- **Granted to:** `apple-helper`
- **Enables:** read + write contacts and groups
- **To re-grant:** System Settings → Privacy & Security → Contacts → toggle **apple-helper** on

## Automation — Notes

- **Granted to:** the *invoking* process (YouCoded.app, Terminal, iTerm — whichever is running Claude)
- **Enables:** AppleScript control of Notes.app
- **First request:** triggered by the first `tell application "Notes"` at setup
- **To re-grant:** System Settings → Privacy & Security → Automation → find your Claude host app → toggle **Notes** on

## Automation — Mail

- **Granted to:** the invoking process (same as Notes)
- **Enables:** AppleScript control of Mail.app
- **To re-grant:** System Settings → Privacy & Security → Automation → find your Claude host app → toggle **Mail** on

## iCloud Drive

- **Granted to:** no TCC needed
- **Requires:** iCloud Drive enabled in System Settings → your name → iCloud → iCloud Drive
