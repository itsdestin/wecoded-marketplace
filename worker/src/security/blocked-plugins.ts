// The plugin off-switch list (security runbook §5, approved 2026-11-05).
//
// Every installed copy of a plugin named here is turned off by the app the next time it checks
// (at launch, then hourly): YouCoded unhooks it from Claude Code, keeps the person's settings for
// it, marks its Library card "Turned off" and shows a one-time notice. It also disappears from the
// store, and the app refuses to install or update it.
//
// WHY a list in the code and not a database table or an admin button: turning plugins off on
// everyone's computer is the most powerful thing this server can do. A code change is reviewed,
// recorded in history with its reason, and deploys on merge within minutes — fast enough for a bad
// day, and impossible to flip by someone who only stole a sign-in. Removing an id turns the plugin
// back on for everyone who still has it (the app re-registers it).
//
// `id` is the catalog id exactly as the app stores it (e.g. "tab-tidy", or "<bundle>/<member>").
// `reason` is optional plain words for people; the app shows one fixed sentence today.
export interface BlockedPlugin {
  id: string;
  reason?: string;
}

export const BLOCKED_PLUGINS: readonly BlockedPlugin[] = [
  // Example: { id: "tab-tidy", reason: "Sent browsing history to an unknown server." },
];
