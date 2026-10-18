# Home devices, live events and camera pictures

Use these APIs only when the person asked for a page connected to their home or Tailscale
network. The app owns the connection and key; the page never receives a key. Never make a
password/token box inside the page or connect through a raw browser WebSocket.

## Manifest and the approved address

This Home Assistant connection supports controls, live events and cameras. Remove the camera
profile if no camera is needed. Use `lookup` for HTTP look-ups only; use `full` when controls
or the device's socket operations are needed, and explain that authority on approval.

```json
{
  "name": "Home",
  "description": "My Home Assistant devices",
  "icon": "page",
  "connections": [{
    "id": "ha", "kind": "device", "service": "Home Assistant",
    "address": "homeassistant.local:8123", "access": "full", "needsKey": true,
    "keyPage": "/profile/security",
    "keyHelp": { "steps": [
      "Sign in to Home Assistant and open your profile's Security page.",
      "Create a long-lived access token named YouCoded.",
      "Copy it into the app's approval card."
    ] },
    "socketHello": "{\"type\":\"auth\",\"access_token\":\"{{key}}\"}",
    "socketReady": "auth_ok", "socketAuthFailed": "auth_invalid",
    "videoProfile": {
      "targetPrefix": "camera.",
      "send": "{\"id\":1,\"type\":\"camera/webrtc/offer\",\"entity_id\":{{target}},\"offer\":{{offer}}}",
      "answer": "event.answer", "candidate": "event.candidate", "failed": "event.message"
    }
  }]
}
```

- `address` is a suggested home/Tailscale host or `host:port`, not a URL. The person may
  change it on the approval card. Only allowed devices appear in
  `window.youcoded.devices`: `const base = (window.youcoded.devices || {}).ha` gives the
  approved base URL. If absent, show an approval-needed state; never use the suggestion as
  a fallback. Build requests with `base + '/api/…'` through `youcoded.fetch`.
- `needsKey: false` is for devices that genuinely need no key. Key placement uses the same
  `keyIn`, `keyParam` and `keyScheme` rules as other key connections.
- The app sends `socketHello` with `{{key}}` replaced internally. The page must not send an
  authentication message of its own. The profile fields are approved with the connection;
  changing them asks again. For another device, check its actual protocol rather than
  copying Home Assistant's message types or video profile.
- Never combine `device` with `open`, even when the device needs no key. `socketDeny` can
  name additional lower-case message-type prefixes to refuse. It cannot weaken the app's
  built-in refusal of authentication/key/person-management messages.

## Live events

`const live = window.youcoded.socket(base + '/api/websocket', { onState, onMessages })`
opens an app-owned connection. Check the API exists first on older hosts.

- `onState(state, why)` reports connection state. Each `open` is a **fresh** connection:
  reset subscription state, wait for the device's authenticated reply (`auth_ok` here) in
  `onMessages`, then subscribe again. `open` alone does not mean authentication succeeded.
- `onMessages(texts)` receives an array of message strings; parse each with error handling.
  `live.send(JSON.stringify(message))` sends a device-protocol message and returns a boolean;
  it is refused unless the connection is open. The app applies its message rules separately.
- `live.close()` ends it. Close on page hide and reopen on return; hidden pages should not
  poll, parse event streams or redraw. The host also stops connections when the page closes.
  Keep a small visible reconnect/error state instead of pretending stale data is live.

## Camera video played by the app

With an approved `videoProfile`, call
`const video = window.youcoded.video('ha', 'camera.front_door', { onFrame, onState })`.
The target is a device entity id matching `targetPrefix`, not a stream URL. Check the API
exists first. The page receives pictures, not credentials or a network stream address.

- `onFrame(bitmap, ack)` receives an ImageBitmap. Size a canvas to the bitmap, draw with
  `canvas.getContext('2d').drawImage(bitmap, 0, 0)`, then call `ack()` in `finally` so the next
  picture can arrive. Release a bitmap with `bitmap.close()` when finished with it.
- `onState(state, why)` reports `starting`, `playing` or `stopped`. Show the supplied reason
  when playback stops; do not invent a camera/network failure cause.
- `video.stop()` ends playback. Stop it when hidden or no longer needed. Start only cameras
  the person is viewing; never build a hidden wall of active video streams.

For see-through pages, use the style kit's transparent-background guidance. The person's
Appearance setting and theme determine whether the theme background is visible; do not
force a solid surface over it or promise that every layout supports see-through glass.
