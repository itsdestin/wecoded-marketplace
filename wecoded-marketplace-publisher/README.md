# WeCoded Marketplace Publisher

Publish your plugins to the WeCoded marketplace — skills, commands, hooks, MCPs, agents, or any combination — without needing to know how plugins are structured.

## What it does

Run `/publish-to-marketplace`. The skill will:

1. Ask you what you made, in your own words
2. Find the pieces on your computer
3. Show you what it found and confirm with you
4. Package everything into a proper plugin
5. Detect any secrets you may have included and help you sanitize them
6. Let you review the final plugin before anything leaves your machine
7. Create a public GitHub repo under your account and open a PR to the marketplace

## Two paths

- **Community plugin** — you maintain it in your own GitHub repo; the marketplace lists it with a Community badge.
- **Request WeCoded adoption** — same community listing goes live, and WeCoded separately reviews whether to take it over. If accepted, WeCoded hosts and maintains an "Official" version; you lose control of the adopted version.

You decide after seeing the finished plugin.

## Requirements

- `gh` CLI installed and authenticated (`gh auth login`)
- A GitHub account
