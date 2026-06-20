import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type * as z4 from "zod/v4/core";

type BrowserLabInputSchema = Record<string, z4.$ZodType>;
type BrowserLabToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

interface BrowserLabToolCallResult {
  [key: string]: unknown;
  content: BrowserLabToolContent[];
}

interface BrowserLabMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: BrowserLabInputSchema;
}

const defaultScreenshotMimeType = "image/png";
const imageMimeTypePattern = /^image\/[a-z0-9][a-z0-9.+-]*$/i;
const base64CharactersPattern = /^[a-z0-9+/]+={0,2}$/i;
const fenrirImageArtifactIdPattern = /^[a-z0-9_-]{1,128}$/i;
const fenrirImageUriPrefix = "fenrir-image://";

const optionalTabId = z
  .string()
  .describe("Browser Lab tab id. Omit to use the active tab.")
  .optional();
const profileId = z
  .string()
  .min(1)
  .describe(
    "Browser Lab profile id. Use traffic_lens_list_profiles first when you need a logged-in or account-specific browser session.",
  );
const optionalProfileId = profileId.optional();
const url = z
  .string()
  .describe(
    "Absolute URL to open, for example http://localhost:8082, https://example.com, or file:///Users/alice/page.html.",
  );
const headers = z.record(z.string(), z.string()).describe("HTTP headers keyed by header name.");
const emptyInputSchema = {};
const tabInputSchema = { tabId: optionalTabId };
const imageHandleInputSchema = {
  uri: z
    .string()
    .min(1)
    .describe("Fenrir image handle to open, for example fenrir-image://browser-lab-..."),
};
const requiredTabInputSchema = {
  tabId: z.string().describe("Browser Lab tab id."),
};
const profileInputSchema = {
  name: z
    .string()
    .min(1)
    .describe("Human-readable profile name, for example GitHub Adrian or Stripe Test Admin."),
  partitionKey: z
    .string()
    .min(1)
    .describe(
      "Optional Electron session partition key. Omit for a persistent key derived from the profile name. Use persist:traffic-lens:<slug> when supplying your own key so cookies and storage survive restarts.",
    )
    .optional(),
  userAgentPreset: z
    .string()
    .min(1)
    .describe("Optional user-agent override for new desktop-mode tabs in this profile.")
    .optional(),
  proxyPreset: z
    .string()
    .nullable()
    .describe("Optional proxy preset identifier reserved for future Browser Lab proxy routing.")
    .optional(),
  notes: z
    .string()
    .nullable()
    .describe("Optional operator notes, such as which account is logged in.")
    .optional(),
};
const createProfileSchema = {
  id: z
    .string()
    .min(1)
    .describe("Optional stable profile id. Omit to let Browser Lab generate one.")
    .optional(),
  ...profileInputSchema,
};
const updateProfileSchema = {
  id: profileId,
  name: profileInputSchema.name.optional(),
  partitionKey: profileInputSchema.partitionKey.describe(
    "Optional new Electron session partition key. Changing it switches future tabs to a different cookie/storage jar and does not migrate existing browser state.",
  ),
  userAgentPreset: profileInputSchema.userAgentPreset,
  proxyPreset: profileInputSchema.proxyPreset,
  notes: profileInputSchema.notes,
};
const ruleScopeSchema = {
  tabId: optionalTabId,
  profileId: optionalProfileId.describe("Traffic Lens profile id."),
  hostPattern: z.string().describe("Host glob or pattern to match.").optional(),
  urlPattern: z.string().describe("URL glob or pattern to match.").optional(),
  method: z.string().describe("HTTP method to match, for example GET or POST.").optional(),
  resourceType: z.string().describe("Browser resource type to match.").optional(),
};
const headerMutationSchema = {
  set: headers.describe("Headers to set or replace."),
  remove: z.array(z.string()).describe("Header names to remove."),
};
const mockResponseSchema = {
  statusCode: z.number().describe("HTTP response status code."),
  headers,
  body: z.string().nullable().describe("Base64-encoded response body, or null for no body."),
};
const ruleInputSchema = {
  name: z.string().describe("Human-readable rule name."),
  enabled: z.boolean().describe("Whether the rule is active."),
  phase: z.enum(["beforeRequest", "beforeResponse"]).describe("Interception phase."),
  action: z.enum(["observe", "pause", "modify", "mockResponse", "drop"]).describe("Rule action."),
  scope: z.object(ruleScopeSchema),
  urlRewrite: z.string().describe("Replacement URL for modify actions.").optional(),
  headerMutation: z
    .object(headerMutationSchema)
    .describe("Header changes for modify actions.")
    .optional(),
  bodyReplace: z
    .string()
    .nullable()
    .describe("Base64-encoded replacement body for modify actions.")
    .optional(),
  mockResponse: z
    .object(mockResponseSchema)
    .describe("Mock response for mockResponse actions.")
    .optional(),
};
const upsertRuleSchema = {
  ...ruleInputSchema,
  id: z.string().describe("Existing rule id to update. Omit to create a new rule.").optional(),
  input: z
    .object(ruleInputSchema)
    .describe("Rule payload. Preferred shape is { id?: string, input: rulePayload }.")
    .optional(),
};
const overrideInputSchema = {
  name: z.string().describe("Human-readable override name."),
  enabled: z.boolean().describe("Whether the override is active."),
  match: z.object(ruleScopeSchema).describe("Request scope this override matches."),
  response: z.object(mockResponseSchema).describe("Mock response to serve when matched."),
  latencyMs: z.number().describe("Optional artificial response delay in milliseconds.").optional(),
  offline: z.boolean().describe("Whether to simulate an offline failure.").optional(),
};
const upsertOverrideSchema = {
  ...overrideInputSchema,
  id: z
    .string()
    .describe("Existing override id to update. Omit to create a new override.")
    .optional(),
  input: z
    .object(overrideInputSchema)
    .describe("Override payload. Preferred shape is { id?: string, input: overridePayload }.")
    .optional(),
};
const storageScopeSchema = {
  tabId: optionalTabId,
  profileId: optionalProfileId.describe(
    "Traffic Lens profile id. Omit to use the active tab profile.",
  ),
  origin: z
    .string()
    .describe(
      "Storage origin, for example http://localhost:8082. Omit to use the active tab origin.",
    )
    .optional(),
};
const storageSetSchema = {
  ...storageScopeSchema,
  key: z.string().describe("Storage key."),
  value: z.string().describe("Storage value."),
};
const storageDeleteSchema = {
  ...storageScopeSchema,
  key: z.string().describe("Storage key."),
};
const cookieForOriginSchema = {
  profileId,
  url: z
    .string()
    .describe(
      "Absolute URL for cookie scope, for example https://github.com/settings/profile. Browser Lab derives the origin from this URL.",
    ),
};
const setCookieForOriginSchema = {
  ...cookieForOriginSchema,
  name: z.string().min(1).describe("Cookie name."),
  value: z.string().describe("Cookie value."),
  domain: z.string().describe("Optional cookie domain. Omit for a host-only cookie.").optional(),
  path: z
    .string()
    .describe("Optional cookie path. Defaults to Electron's cookie behavior.")
    .optional(),
  secure: z.boolean().describe("Whether the cookie is Secure.").optional(),
  httpOnly: z.boolean().describe("Whether the cookie is HttpOnly.").optional(),
  sameSite: z
    .enum(["unspecified", "no_restriction", "lax", "strict"])
    .describe("Optional SameSite policy.")
    .optional(),
  expirationDate: z
    .number()
    .describe("Optional Unix epoch expiration time in seconds. Omit for a session cookie.")
    .optional(),
};
const deleteCookieForOriginSchema = {
  ...cookieForOriginSchema,
  name: z.string().min(1).describe("Cookie name to delete."),
};

export const BROWSER_LAB_MCP_TOOLS = [
  {
    name: "browser_lab_list_tabs",
    description: "List Browser Lab tabs.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "browser_lab_get_active_tab",
    description: "Get the active Browser Lab tab.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "browser_lab_create_tab",
    description:
      "Create a Browser Lab tab, optionally in a specific persistent profile. Pass profileId to reuse that profile's cookies, localStorage, and session partition for account-specific development.",
    inputSchema: { url: url.optional(), profileId: optionalProfileId },
  },
  {
    name: "browser_lab_create_tab_in_profile",
    description:
      "Create a Browser Lab tab in a named persistent profile. Use this when the task needs a known logged-in account or preloaded cookies/storage. Call traffic_lens_list_profiles first to discover available profile ids.",
    inputSchema: { url: url.optional(), profileId },
  },
  {
    name: "browser_lab_select_tab",
    description: "Select and show a Browser Lab tab.",
    inputSchema: requiredTabInputSchema,
  },
  {
    name: "browser_lab_close_tab",
    description: "Close a Browser Lab tab.",
    inputSchema: requiredTabInputSchema,
  },
  {
    name: "browser_lab_navigate",
    description:
      "Navigate the active or selected Browser Lab tab to an absolute URL, including file:// URLs for local files.",
    inputSchema: { tabId: optionalTabId, url },
  },
  {
    name: "browser_lab_back",
    description: "Go back in the active or selected Browser Lab tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "browser_lab_forward",
    description: "Go forward in the active or selected Browser Lab tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "browser_lab_reload",
    description: "Reload the active or selected Browser Lab tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "browser_lab_wait_for_load",
    description: "Wait for a Browser Lab tab to finish loading.",
    inputSchema: {
      tabId: optionalTabId,
      timeoutMs: z.number().describe("Timeout in milliseconds. Defaults to 15000.").optional(),
    },
  },
  {
    name: "browser_lab_snapshot",
    description: "Capture a sanitized page snapshot for the active or selected tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "browser_lab_screenshot",
    description: "Capture a page screenshot for the active or selected tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "browser_lab_open_image",
    description: "Open a Browser Lab fenrir-image:// handle and return the image content.",
    inputSchema: imageHandleInputSchema,
  },
  {
    name: "browser_lab_click",
    description:
      "Click in the active or selected page. Provide either a CSS selector or both x and y viewport coordinates.",
    inputSchema: {
      tabId: optionalTabId,
      selector: z.string().describe("CSS selector to click.").optional(),
      x: z.number().describe("Viewport x coordinate.").optional(),
      y: z.number().describe("Viewport y coordinate.").optional(),
    },
  },
  {
    name: "browser_lab_type",
    description:
      "Type text into the active or selected page, optionally focusing a CSS selector first.",
    inputSchema: {
      tabId: optionalTabId,
      selector: z.string().describe("CSS selector to focus before typing.").optional(),
      text: z.string().describe("Text to type."),
    },
  },
  {
    name: "browser_lab_press",
    description: "Press a keyboard key in the active or selected page.",
    inputSchema: {
      tabId: optionalTabId,
      key: z.string().describe("Electron keyCode, for example Enter, Escape, Tab, or ArrowDown."),
    },
  },
  {
    name: "traffic_lens_query_requests",
    description: "Query captured Traffic Lens requests.",
    inputSchema: {
      tabId: optionalTabId,
      host: z.string().describe("Filter by request host.").optional(),
      method: z.string().describe("Filter by HTTP method.").optional(),
      statusCode: z.number().describe("Filter by response status code.").optional(),
      search: z.string().describe("Text search over captured request data.").optional(),
      limit: z.number().describe("Maximum rows to return.").optional(),
      offset: z.number().describe("Pagination offset.").optional(),
    },
  },
  {
    name: "traffic_lens_get_request",
    description: "Get Traffic Lens request details by numeric id.",
    inputSchema: { id: z.number().describe("Captured request numeric id.") },
  },
  {
    name: "traffic_lens_clear_requests",
    description: "Clear captured Traffic Lens requests, optionally scoped to a tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "traffic_lens_replay_request",
    description: "Replay a captured or manually specified HTTP request from the server process.",
    inputSchema: {
      trafficId: z.number().describe("Captured request numeric id to replay.").optional(),
      method: z.string().describe("HTTP method."),
      url,
      headers,
      body: z.string().nullable().describe("Base64-encoded request body, or null.").optional(),
    },
  },
  {
    name: "traffic_lens_list_paused_requests",
    description: "List paused Traffic Lens requests.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "traffic_lens_continue_paused_request",
    description: "Continue a paused request, optionally modifying it.",
    inputSchema: {
      pauseId: z.string().describe("Paused request id."),
      url: url.optional(),
      headers: headers.optional(),
      body: z.string().nullable().describe("Base64-encoded replacement body, or null.").optional(),
      statusCode: z.number().describe("Response status code for beforeResponse pauses.").optional(),
    },
  },
  {
    name: "traffic_lens_drop_paused_request",
    description: "Drop a paused request.",
    inputSchema: { pauseId: z.string().describe("Paused request id.") },
  },
  {
    name: "traffic_lens_list_profiles",
    description:
      "List Browser Lab profiles. Each profile maps to an Electron session partition, so tabs opened with its profileId share that profile's cookies, localStorage, cache, and login state across Browser Lab restarts.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "traffic_lens_create_profile",
    description:
      "Create a persistent Browser Lab profile for an account, persona, tenant, or test environment. Omit partitionKey to let Browser Lab derive a persistent session key from the name; then open tabs with browser_lab_create_tab_in_profile or browser_lab_create_tab profileId.",
    inputSchema: createProfileSchema,
  },
  {
    name: "traffic_lens_update_profile",
    description:
      "Update Browser Lab profile metadata. Use this to rename a profile, annotate which account is logged in, or change the user-agent for future tabs. Changing partitionKey switches future tabs to a different cookie/storage jar and does not migrate existing state.",
    inputSchema: updateProfileSchema,
  },
  {
    name: "traffic_lens_delete_profile",
    description:
      "Delete a Browser Lab profile. The default profile cannot be deleted, and Browser Lab refuses deletion while tabs for the profile are still open.",
    inputSchema: { id: profileId },
  },
  {
    name: "traffic_lens_list_rules",
    description: "List Browser Lab runtime rules.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "traffic_lens_upsert_rule",
    description: "Create or update a Browser Lab runtime rule.",
    inputSchema: upsertRuleSchema,
  },
  {
    name: "traffic_lens_delete_rule",
    description: "Delete a Browser Lab runtime rule.",
    inputSchema: { id: z.string().describe("Rule id.") },
  },
  {
    name: "traffic_lens_set_rule_enabled",
    description: "Enable or disable a Browser Lab rule.",
    inputSchema: {
      id: z.string().describe("Rule id."),
      enabled: z.boolean().describe("Next enabled state."),
    },
  },
  {
    name: "traffic_lens_list_overrides",
    description: "List Browser Lab response overrides.",
    inputSchema: emptyInputSchema,
  },
  {
    name: "traffic_lens_upsert_override",
    description: "Create or update a response override.",
    inputSchema: upsertOverrideSchema,
  },
  {
    name: "traffic_lens_delete_override",
    description: "Delete a response override.",
    inputSchema: { id: z.string().describe("Override id.") },
  },
  {
    name: "traffic_lens_set_override_enabled",
    description: "Enable or disable a response override.",
    inputSchema: {
      id: z.string().describe("Override id."),
      enabled: z.boolean().describe("Next enabled state."),
    },
  },
  {
    name: "traffic_lens_list_findings",
    description: "List Traffic Lens findings.",
    inputSchema: {
      tabId: optionalTabId,
      kind: z
        .enum([
          "missing-security-header",
          "weak-cookie-flag",
          "cors-wildcard",
          "mixed-content",
          "jwt-exposed-in-storage",
          "sourcemap-exposed",
        ])
        .describe("Finding kind.")
        .optional(),
      severity: z.enum(["info", "low", "medium", "high"]).describe("Finding severity.").optional(),
      limit: z.number().describe("Maximum rows to return.").optional(),
    },
  },
  {
    name: "browser_lab_get_cookies",
    description: "Read cookies for a Browser Lab tab.",
    inputSchema: tabInputSchema,
  },
  {
    name: "traffic_lens_list_storage_origins",
    description:
      "List origins where Browser Lab has observed or captured cookies/localStorage/sessionStorage for a profile. Use this to discover which origins have saved state before inspecting profile storage.",
    inputSchema: { profileId },
  },
  {
    name: "traffic_lens_capture_storage_origin",
    description:
      "Capture the latest cookies and localStorage for a profile/origin into Traffic Lens history. If a matching tab is open, Browser Lab also captures live sessionStorage for that tab.",
    inputSchema: {
      profileId,
      origin: z
        .string()
        .describe("Origin to capture, for example https://github.com or http://localhost:3000."),
      tabId: optionalTabId,
    },
  },
  {
    name: "traffic_lens_get_cookies_for_origin",
    description:
      "Read cookies from a Browser Lab profile for a specific origin without needing an open tab. Useful for verifying that a saved account profile has the expected login cookies before opening tabs.",
    inputSchema: {
      profileId,
      origin: z.string().describe("Origin to read cookies for, for example https://github.com."),
    },
  },
  {
    name: "traffic_lens_set_cookie_for_origin",
    description:
      "Set a cookie directly in a Browser Lab profile's persistent session partition for the supplied URL. Use this to seed or repair profile login/test state before opening a tab in that profile.",
    inputSchema: setCookieForOriginSchema,
  },
  {
    name: "traffic_lens_delete_cookie_for_origin",
    description:
      "Delete a cookie from a Browser Lab profile's persistent session partition for the supplied URL.",
    inputSchema: deleteCookieForOriginSchema,
  },
  {
    name: "browser_lab_get_local_storage",
    description:
      "Read localStorage for an origin. Pass profileId and origin to inspect a profile's persistent storage without relying on whichever tab is active.",
    inputSchema: storageScopeSchema,
  },
  {
    name: "browser_lab_set_local_storage_item",
    description:
      "Set a localStorage item for an origin. Pass profileId and origin to seed a specific Browser Lab profile before opening account-specific tabs.",
    inputSchema: storageSetSchema,
  },
  {
    name: "browser_lab_delete_local_storage_item",
    description: "Delete a localStorage item for an origin, optionally scoped to a profile.",
    inputSchema: storageDeleteSchema,
  },
  {
    name: "browser_lab_clear_local_storage",
    description: "Clear all localStorage entries for an origin, optionally scoped to a profile.",
    inputSchema: storageScopeSchema,
  },
  {
    name: "browser_lab_get_session_storage",
    description: "Read sessionStorage for a tab origin.",
    inputSchema: storageScopeSchema,
  },
  {
    name: "browser_lab_set_session_storage_item",
    description: "Set a sessionStorage item.",
    inputSchema: storageSetSchema,
  },
  {
    name: "browser_lab_delete_session_storage_item",
    description: "Delete a sessionStorage item.",
    inputSchema: storageDeleteSchema,
  },
] satisfies ReadonlyArray<BrowserLabMcpTool>;

export function truncateBrowserLabToolResult(value: unknown): string {
  const text = JSON.stringify(value, null, 2) ?? String(value);
  const maxLength = 120_000;
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n... truncated ${text.length - maxLength} characters`;
}

function normalizeBase64ImageData(value: string): string | null {
  const base64 = value.replace(/\s+/g, "");
  if (!base64 || !base64CharactersPattern.test(base64) || base64.length % 4 === 1) {
    return null;
  }

  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) {
    return null;
  }

  const canonicalInput = base64.replace(/=+$/g, "");
  const canonicalDecoded = bytes.toString("base64").replace(/=+$/g, "");
  return canonicalInput === canonicalDecoded ? base64 : null;
}

function normalizeImageMimeType(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) {
    return defaultScreenshotMimeType;
  }

  const mimeType = value.trim().toLowerCase();
  if (!imageMimeTypePattern.test(mimeType)) {
    throw new Error(`Browser Lab screenshot returned non-image MIME type '${value}'.`);
  }
  return mimeType;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function normalizeFenrirImageArtifactId(value: unknown): string | null {
  const raw = asString(value);
  if (!raw) {
    return null;
  }
  const artifactId = raw.startsWith(fenrirImageUriPrefix)
    ? raw.slice(fenrirImageUriPrefix.length)
    : raw;
  return fenrirImageArtifactIdPattern.test(artifactId) ? artifactId : null;
}

function formatBrowserLabScreenshotResult(result: unknown): BrowserLabToolCallResult {
  if (!result || typeof result !== "object") {
    throw new Error("Browser Lab screenshot returned an invalid result.");
  }

  const record = result as {
    readonly artifactId?: unknown;
    readonly data?: unknown;
    readonly mimeType?: unknown;
    readonly name?: unknown;
    readonly uri?: unknown;
  };
  if (typeof record.data !== "string") {
    throw new Error("Browser Lab screenshot returned no image data.");
  }

  const data = normalizeBase64ImageData(record.data);
  if (!data) {
    throw new Error("Browser Lab screenshot returned empty or invalid image data.");
  }

  const mimeType = normalizeImageMimeType(record.mimeType);
  const artifactId =
    normalizeFenrirImageArtifactId(record.artifactId) ??
    normalizeFenrirImageArtifactId(record.uri) ??
    `browser-lab-${randomUUID()}`;
  const uri = `fenrir-image://${artifactId}`;
  const name = asString(record.name) ?? "browser-lab-screenshot.png";

  return {
    content: [
      {
        type: "image",
        data,
        mimeType,
      },
      {
        type: "text",
        text: `Fenrir image handle: ${uri}`,
      },
    ],
    structuredContent: {
      fenrirImageHandles: [
        {
          id: artifactId,
          uri,
          name,
          mimeType,
        },
      ],
    },
  };
}

export function formatBrowserLabToolResult(
  toolName: string,
  result: unknown,
): BrowserLabToolCallResult {
  if (toolName === "browser_lab_screenshot" || toolName === "browser_lab_open_image") {
    return formatBrowserLabScreenshotResult(result);
  }

  return {
    content: [{ type: "text", text: truncateBrowserLabToolResult(result) }],
  };
}
