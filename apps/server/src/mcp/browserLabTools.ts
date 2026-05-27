export const BROWSER_LAB_MCP_TOOLS: ReadonlyArray<{
  readonly name: string;
  readonly description: string;
}> = [
  { name: "browser_lab_list_tabs", description: "List Browser Lab tabs." },
  { name: "browser_lab_get_active_tab", description: "Get the active Browser Lab tab." },
  { name: "browser_lab_create_tab", description: "Create a Browser Lab tab." },
  { name: "browser_lab_select_tab", description: "Select a Browser Lab tab." },
  { name: "browser_lab_close_tab", description: "Close a Browser Lab tab." },
  { name: "browser_lab_navigate", description: "Navigate the active or selected Browser Lab tab." },
  { name: "browser_lab_back", description: "Go back in the active or selected Browser Lab tab." },
  {
    name: "browser_lab_forward",
    description: "Go forward in the active or selected Browser Lab tab.",
  },
  { name: "browser_lab_reload", description: "Reload the active or selected Browser Lab tab." },
  {
    name: "browser_lab_wait_for_load",
    description: "Wait for a Browser Lab tab to finish loading.",
  },
  { name: "browser_lab_snapshot", description: "Capture a sanitized page snapshot." },
  { name: "browser_lab_screenshot", description: "Capture a page screenshot." },
  { name: "browser_lab_click", description: "Click at page coordinates or a selector." },
  { name: "browser_lab_type", description: "Type text into the page." },
  { name: "browser_lab_press", description: "Press a key in the page." },
  { name: "traffic_lens_query_requests", description: "Query captured Traffic Lens requests." },
  { name: "traffic_lens_get_request", description: "Get Traffic Lens request details by id." },
  { name: "traffic_lens_clear_requests", description: "Clear captured Traffic Lens requests." },
  { name: "traffic_lens_replay_request", description: "Replay a captured request." },
  { name: "traffic_lens_list_paused_requests", description: "List paused Traffic Lens requests." },
  { name: "traffic_lens_continue_paused_request", description: "Continue a paused request." },
  { name: "traffic_lens_drop_paused_request", description: "Drop a paused request." },
  { name: "traffic_lens_list_rules", description: "List Browser Lab runtime rules." },
  { name: "traffic_lens_upsert_rule", description: "Create or update a Browser Lab runtime rule." },
  { name: "traffic_lens_delete_rule", description: "Delete a Browser Lab runtime rule." },
  { name: "traffic_lens_set_rule_enabled", description: "Enable or disable a Browser Lab rule." },
  { name: "traffic_lens_list_overrides", description: "List Browser Lab response overrides." },
  { name: "traffic_lens_upsert_override", description: "Create or update a response override." },
  { name: "traffic_lens_delete_override", description: "Delete a response override." },
  {
    name: "traffic_lens_set_override_enabled",
    description: "Enable or disable a response override.",
  },
  { name: "traffic_lens_list_findings", description: "List Traffic Lens findings." },
  { name: "browser_lab_get_cookies", description: "Read cookies for a Browser Lab tab." },
  { name: "browser_lab_get_local_storage", description: "Read localStorage for an origin." },
  { name: "browser_lab_set_local_storage_item", description: "Set a localStorage item." },
  { name: "browser_lab_delete_local_storage_item", description: "Delete a localStorage item." },
  { name: "browser_lab_get_session_storage", description: "Read sessionStorage for a tab origin." },
  { name: "browser_lab_set_session_storage_item", description: "Set a sessionStorage item." },
  { name: "browser_lab_delete_session_storage_item", description: "Delete a sessionStorage item." },
];

export function truncateBrowserLabToolResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  const maxLength = 120_000;
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} characters`;
}
