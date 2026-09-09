import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { createApiClient, API_URL, probeEndpoint, formatPaymentAmount, type ProbeResult, checkSufficientBalance, generateDedupKey, checkDedupCache, recordTransaction, X402_DEDUP_TTL_MS, NETWORK } from "../services/x402.service.js";
import {
  ALL_ENDPOINTS,
  searchEndpoints,
  formatEndpointsTable,
  getEndpointsBySource,
  getCategories,
} from "../endpoints/registry.js";
import { createJsonResponse, createErrorResponse } from "../utils/index.js";
import { X402_HEADERS } from "../utils/x402-protocol.js";
import type { HttpPaymentStatusResponse } from "@aibtc/tx-schemas/http";
import {
  extractPaymentIdFromPaymentSignature,
  extractTxidFromPaymentSignature,
  pollTransactionConfirmation,
} from "../utils/x402-recovery.js";
import { formatCanonicalPaymentStatus } from "../utils/x402-payment-state.js";
import { emitPaymentLog } from "../utils/x402-payment-logging.js";

const ALL_SOURCES = "x402.biwas.xyz, x402.aibtc.com, stx402.com, aibtc.com";

interface ParsedEndpointUrl {
  baseUrl: string;
  requestPath: string;
  fullUrl: string;
  params?: Record<string, string>;
}

/**
 * Parse and validate endpoint URL from either a full URL or path+apiUrl combination.
 * Merges any query parameters from the URL into the provided params.
 */
function parseEndpointUrl(options: {
  url?: string;
  path?: string;
  apiUrl?: string;
  params?: Record<string, string>;
}): ParsedEndpointUrl {
  const { url, path, apiUrl } = options;
  let params = options.params;

  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") {
      throw new Error("Only HTTPS URLs are allowed for x402 endpoints");
    }
    if (parsed.search) {
      const urlParams = Object.fromEntries(parsed.searchParams);
      params = { ...urlParams, ...params };
    }
    return {
      baseUrl: `${parsed.protocol}//${parsed.host}`,
      requestPath: parsed.pathname,
      fullUrl: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
      params,
    };
  }

  if (path) {
    if (apiUrl && !apiUrl.startsWith("https://")) {
      throw new Error("Only HTTPS URLs are allowed for x402 endpoints");
    }
    const baseUrl = apiUrl || API_URL;
    return {
      baseUrl,
      requestPath: path,
      fullUrl: `${baseUrl}${path}`,
      params,
    };
  }

  throw new Error("Either 'url' or 'path' parameter must be provided");
}

/**
 * Build the callWith object that echoes back original request params,
 * allowing the LLM to copy them into a follow-up execute_x402_endpoint call.
 */
function buildCallWith(options: {
  method: string;
  url?: string;
  path?: string;
  apiUrl?: string;
  params?: Record<string, string>;
  data?: Record<string, unknown>;
  asset?: string;
}): Record<string, unknown> {
  const callWith: Record<string, unknown> = { method: options.method, autoApprove: true };
  if (options.url) callWith.url = options.url;
  if (options.path) callWith.path = options.path;
  if (options.apiUrl) callWith.apiUrl = options.apiUrl;
  if (options.params && Object.keys(options.params).length > 0) callWith.params = options.params;
  if (options.data && Object.keys(options.data).length > 0) callWith.data = options.data;
  // Echo the asset so executing the quote pays in the asset that was quoted.
  if (options.asset) callWith.asset = options.asset;
  return callWith;
}

/**
 * Format an endpoint error into an MCP error response.
 * Provides a helpful hint for 404s and includes HTTP status for other errors.
 */
function formatEndpointError(
  error: unknown,
  endpointLabel: string
): { content: Array<{ type: "text"; text: string }>; isError: true } {
  let message = "Unknown error";
  const axiosError = error as { response?: { status?: number; data?: unknown } };
  if (axiosError.response) {
    if (axiosError.response.status === 404) {
      message = `Endpoint not found: ${endpointLabel}. Use list_x402_endpoints to see available endpoints.`;
    } else {
      message = `HTTP ${axiosError.response.status}: ${JSON.stringify(axiosError.response.data)}`;
    }
  } else if (error instanceof Error) {
    message = error.message;
  }
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

/**
 * Format a probe result into an MCP JSON response.
 * Shared by execute_x402_endpoint (safe mode) and probe_x402_endpoint.
 */
function formatProbeResponse(
  result: ProbeResult,
  method: string,
  fullUrl: string,
  callWithOptions: Parameters<typeof buildCallWith>[0],
  messagePrefix?: string
): ReturnType<typeof createJsonResponse> {
  if (result.type === 'free') {
    return createJsonResponse({
      type: 'free',
      endpoint: `${method} ${fullUrl}`,
      message: 'This endpoint is free (no payment required)',
      response: result.data,
    });
  }

  // Derive the message from the same asset the machine-readable block reports.
  // These used to disagree — the text said "29 STX" while payment.asset was
  // USDCx — because the formatter treated every unknown token as STX (#613).
  const formattedCost = formatPaymentAmount(result.amount, result.asset);
  const prefix = messagePrefix ?? 'No payment made. ';
  const alternatives = (result.accepts ?? []).filter((o) => o.asset !== result.asset);
  const altNote =
    alternatives.length > 0
      ? ` This endpoint also accepts ${alternatives
          .map((o) => `${o.formatted}${o.payable ? '' : ' [not payable by this client]'}`)
          .join(', ')} — pass the \`asset\` parameter to pay with one of those instead.`
      : '';
  return createJsonResponse({
    type: 'payment_required',
    endpoint: `${method} ${fullUrl}`,
    message: `${prefix}This endpoint costs ${formattedCost}. To execute and pay, call execute_x402_endpoint with autoApprove: true and the parameters shown in callWith below.${altNote}`,
    payment: {
      amount: result.amount,
      asset: result.asset,
      ...(result.symbol && { symbol: result.symbol }),
      recipient: result.recipient,
      network: result.network,
    },
    ...(result.accepts && result.accepts.length > 0 && { accepts: result.accepts }),
    callWith: buildCallWith(callWithOptions),
  });
}

export function registerEndpointTools(server: McpServer): void {
  // List x402 endpoints
  server.registerTool(
    "list_x402_endpoints",
    {
      description: `List known x402 API endpoints from ${ALL_SOURCES}.

The agent can:
1. Execute x402 endpoints from these sources (paid API calls with automatic payment handling)
2. Execute direct Stacks transactions (transfer STX, call contracts, deploy contracts)

Sources:
- x402.biwas.xyz: DeFi analytics, market data, wallet analysis, Zest/ALEX protocols
- x402.aibtc.com: AI inference, OpenRouter integration, Stacks utilities, hashing, storage
- stx402.com: AI services, cryptography, storage, utilities, agent registry
- aibtc.com: Inbox messaging system`,
      inputSchema: {
        source: z
          .enum(["x402.biwas.xyz", "x402.aibtc.com", "stx402.com", "aibtc.com", "all"])
          .optional()
          .default("all")
          .describe("Filter by API source"),
        category: z
          .string()
          .optional()
          .describe("Filter by category (use without value to see available categories)"),
        search: z
          .string()
          .optional()
          .describe("Search endpoints by keyword (searches path, description, category)"),
        showFreeOnly: z
          .boolean()
          .optional()
          .describe("Only show free endpoints (no payment required)"),
        showPaidOnly: z
          .boolean()
          .optional()
          .describe("Only show paid endpoints (require x402 payment)"),
      },
    },
    async ({ source, category, search, showFreeOnly, showPaidOnly }) => {
      try {
        let endpoints = ALL_ENDPOINTS;

        if (source && source !== "all") {
          endpoints = getEndpointsBySource(source);
        }

        if (showFreeOnly) {
          endpoints = endpoints.filter((ep) => ep.cost === "FREE");
        } else if (showPaidOnly) {
          endpoints = endpoints.filter((ep) => ep.cost !== "FREE");
        }

        if (category) {
          endpoints = endpoints.filter(
            (ep) => ep.category.toLowerCase() === category.toLowerCase()
          );
        }

        if (search) {
          const searchResults = searchEndpoints(search);
          endpoints = endpoints.filter((ep) => searchResults.includes(ep));
        }

        if (endpoints.length === 0) {
          const categories = getCategories();
          return {
            content: [
              {
                type: "text" as const,
                text: `No endpoints found matching your criteria.

Available categories: ${categories.join(", ")}

Sources: ${ALL_SOURCES}

If you're looking to perform a direct blockchain action (transfer STX, call a contract), those are available via separate tools.`,
              },
            ],
          };
        }

        const formatted = formatEndpointsTable(endpoints);
        const sourceInfo =
          source === "all"
            ? `Sources: ${ALL_SOURCES}`
            : `Source: ${source}`;
        return {
          content: [
            {
              type: "text" as const,
              text: `# Available x402 Endpoints (${endpoints.length} total)\n\n${sourceInfo}\nDefault API: ${API_URL}\n${formatted}\n\n---\nUse execute_x402_endpoint to call any of these endpoints.`,
            },
          ],
        };
      } catch (error) {
        return createErrorResponse(error);
      }
    }
  );

  // Execute x402 endpoint
  server.registerTool(
    "execute_x402_endpoint",
    {
      description: `Execute an x402 API endpoint. Payment is handled automatically.

Supported sources:
- x402.biwas.xyz (default): Use path like "/api/pools/trending"
- x402.aibtc.com (mainnet) / x402.aibtc.dev (testnet): Use apiUrl="https://x402.aibtc.com" with path like "/inference/openrouter/chat"
- stx402.com: Use apiUrl="https://stx402.com" with path like "/ai/dad-joke"
- aibtc.com (mainnet) / aibtc.dev (testnet): Use apiUrl="https://aibtc.com" with path like "/api/inbox/{address}"
- Any x402-compatible URL: Use url parameter with full endpoint URL

Use list_x402_endpoints to discover available endpoints.

For aibtc.com inbox messages, use send_inbox_message_direct instead — it signs a standard sBTC transfer and settles directly through the x402 facilitator.`,
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .default("GET")
          .describe("HTTP method"),
        url: z
          .string()
          .url()
          .optional()
          .describe("Full endpoint URL (e.g., 'https://stx402.com/ai/dad-joke'). Takes precedence over path+apiUrl."),
        path: z
          .string()
          .optional()
          .describe("API endpoint path (e.g., '/api/pools/trending'). Required if url is not provided."),
        apiUrl: z
          .string()
          .url()
          .optional()
          .describe("API base URL. Known sources: x402.biwas.xyz, x402.aibtc.com, stx402.com, aibtc.com. Defaults to configured API_URL."),
        params: z
          .record(z.string(), z.string())
          .optional()
          .describe("Query parameters for GET requests"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Request body for POST/PUT requests"),
        autoApprove: z
          .boolean()
          .optional()
          .default(false)
          .describe("Skip cost probe and execute immediately. When false (default), probes first and returns cost info for paid endpoints. When true, executes atomically like before. Free endpoints always execute transparently."),
        asset: z
          .string()
          .optional()
          .describe(
            "Which asset to pay with when the endpoint accepts several. Accepts a symbol (\"sBTC\", \"STX\") or a full contract identifier. Defaults to the first asset this client can pay. Only STX and sBTC can be signed; requesting any other asset returns an error listing what is accepted."
          ),
      },
    },
    async ({ method, url, path, apiUrl, params, data, autoApprove, asset }) => {
      let fullUrl = "";
      // Hoisted so the catch can record a broadcast payment for dedup — a
      // failed settlement still spends real funds (#630).
      let dedupKey: string | null = null;

      try {
        const parsed = parseEndpointUrl({ url, path, apiUrl, params });
        fullUrl = parsed.fullUrl;
        params = parsed.params;

        if (!autoApprove) {
          const probeResult = await probeEndpoint({ method, url: fullUrl, params, data, asset });
          return formatProbeResponse(probeResult, method, fullUrl, { method, url, path, apiUrl, params, data, asset });
        }

        // autoApprove=true: check dedup cache before any network request, then execute
        // with a single request. Balance validation happens inside the onBeforePayment
        // callback when the interceptor receives the 402, eliminating the separate probe.
        dedupKey = generateDedupKey(method, fullUrl, params, data);
        const existingTxid = await checkDedupCache(dedupKey);
        if (existingTxid) {
          const windowSeconds = Math.round(X402_DEDUP_TTL_MS / 1000);
          const pending = existingTxid.startsWith("pending:");
          return createJsonResponse({
            endpoint: `${method} ${fullUrl}`,
            // Deliberately says "broadcast", not "paid": the entry is written
            // whenever a payment was signed and broadcast, including when
            // settlement then reported an error. Claiming it succeeded would
            // be wrong in exactly the cases the caller most needs to check.
            message: `An identical request already broadcast a payment within the last ${windowSeconds} seconds. This prevents accidental duplicate payments.`,
            // A prior attempt whose txid was never observable is recorded with a
            // synthetic marker. Report it as null rather than leaking the marker,
            // which is not a chain txid and must not be treated as one.
            txid: pending ? null : existingTxid,
            ...(pending && {
              txidNote:
                "The earlier payment was broadcast but its txid was not observable in the response. " +
                "Query get_account_transactions to find the settled txid before paying again.",
            }),
            note: `The earlier payment may have settled even if it reported an error — verify it before retrying. Wait ${windowSeconds}s or vary the endpoint/params to force a new transaction.`,
          });
        }

        const api = await createApiClient(parsed.baseUrl, {
          toolName: "execute_x402_endpoint",
          asset,
          onBeforePayment: async (requirements) => {
            // Non-sponsored: sender pays its own gas, so validate STX for the
            // fee too (sponsored=false is the default, passed explicitly here).
            await checkSufficientBalance(requirements.account, requirements.amount, requirements.asset, false);
          },
        });
        const response = await api.request({ method, url: parsed.requestPath, params, data });

        const paymentResponseHeader = response.headers?.["payment-response"];
        let paymentResponseTxid: string | undefined;
        if (typeof paymentResponseHeader === "string") {
          try {
            const settlement = JSON.parse(
              Buffer.from(paymentResponseHeader, "base64").toString("utf8")
            ) as { transaction?: unknown };
            if (typeof settlement.transaction === "string" && settlement.transaction.length > 0) {
              paymentResponseTxid = settlement.transaction;
            }
          } catch {
            // Ignore malformed settlement headers and continue with other txid sources.
          }
        }

        const paymentBodyTxid = (response.data as { payment?: { txid?: unknown } })?.payment?.txid;
        const rawTxid = (response.data as { txid?: string; payment_txid?: string })?.txid ||
                     (response.data as { payment_txid?: string })?.payment_txid ||
                     paymentResponseTxid ||
                     (typeof paymentBodyTxid === "string" ? paymentBodyTxid : undefined) ||
                     response.headers?.['x-transaction-id'] ||
                     undefined;

        // Detect whether a payment was made by checking for the payment-signature
        // header added by the x402 interceptor. This is more reliable than checking
        // for a txid, which some endpoints may not return.
        const paymentSigHeader = (response as { config?: { headers?: Record<string, string> } })
          .config?.headers?.[X402_HEADERS.PAYMENT_SIGNATURE];
        const paymentAttempted = Boolean(paymentSigHeader);

        // Never invent a placeholder txid when payment was attempted but the
        // response doesn't expose one — a fake string actively misleads
        // downstream tooling and operators (see #487). Surface txid: null
        // with an explicit recovery hint so the caller can discover the
        // real txid via get_account_transactions.
        const txid: string | null = rawTxid ?? null;

        // Keep dedup tracking active even when the txid is not yet
        // observable, using a synthetic pending marker that cannot be
        // confused for a real chain txid.
        if (paymentAttempted) {
          await recordTransaction(dedupKey, txid ?? `pending:${dedupKey}`);
        }

        // Build the txid response fields per the behavior matrix:
        //   payment attempted + observable txid → { txid: "0x..." }
        //   payment attempted + unobservable     → { txid: null, txidNote: "..." }
        //   no payment + observable txid         → { txid: "0x..." }
        //   no payment + no txid                 → {}
        const txidFields = paymentAttempted
          ? {
              txid,
              ...(txid === null && {
                txidNote:
                  "Payment broadcast; real txid not yet observable in response. " +
                  "Query get_account_transactions to discover the settled txid for verification or recovery.",
              }),
            }
          : txid !== null
            ? { txid }
            : {};

        return createJsonResponse({
          endpoint: `${method} ${fullUrl}`,
          response: response.data,
          ...txidFields,
        });
      } catch (error) {
        const label = fullUrl || url || path || "unknown";

        // Txid recovery: when payment was attempted but settlement failed,
        // extract the txid from the payment-signature header (set by the axios
        // interceptor in x402.service.ts) and return it so the agent can verify.
        const axiosError = error as {
          config?: { headers?: Record<string, string> };
          response?: { status?: number; data?: unknown };
          x402PaymentStatus?: unknown;
          x402PaymentDecision?: { summary?: string };
        };
        const canonicalStatus = axiosError.x402PaymentStatus as
          | HttpPaymentStatusResponse
          | undefined;

        // The presence of this header means the interceptor signed and
        // broadcast a payment. That spends real funds whether or not
        // settlement succeeded, so record it for dedup before returning any
        // error — otherwise an identical retry passes the dedup guard and pays
        // a second time for an invoice already settled on chain (#630).
        // Mirrors the success path, including the synthetic pending marker
        // used when the txid is not yet observable.
        const paymentSigHeader = axiosError.config?.headers?.[X402_HEADERS.PAYMENT_SIGNATURE];
        if (paymentSigHeader && dedupKey) {
          const broadcastTxid = extractTxidFromPaymentSignature(paymentSigHeader);
          await recordTransaction(dedupKey, broadcastTxid ?? `pending:${dedupKey}`);
        }

        if (canonicalStatus) {
          const baseError = formatEndpointError(error, label);
          const fallbackTxid = paymentSigHeader
            ? extractTxidFromPaymentSignature(paymentSigHeader)
            : null;
          const fallbackPaymentId = paymentSigHeader
            ? extractPaymentIdFromPaymentSignature(paymentSigHeader)
            : null;

          let text =
            baseError.content[0].text +
            `\n\nCanonical payment status:\n${formatCanonicalPaymentStatus(canonicalStatus)}`;

          if (axiosError.x402PaymentDecision?.summary) {
            text += `\n\nGuidance: ${axiosError.x402PaymentDecision.summary}`;
          }

          if (fallbackPaymentId && fallbackPaymentId !== canonicalStatus.paymentId) {
            text += `\n\nRequest paymentId: ${fallbackPaymentId}`;
          }

          if (fallbackTxid && fallbackTxid !== canonicalStatus.txid) {
            const confirmation = await pollTransactionConfirmation(fallbackTxid, NETWORK);
            text +=
              `\n\nOperational fallback only:\n` +
              `  txid: ${confirmation.txid}\n` +
              `  status: ${confirmation.status}\n` +
              `  explorer: ${confirmation.explorer}`;
          }

          return {
            ...baseError,
            content: [{ type: "text" as const, text }],
          };
        }

        if (paymentSigHeader) {
          const txid = extractTxidFromPaymentSignature(paymentSigHeader);
          const fallbackPaymentId = extractPaymentIdFromPaymentSignature(paymentSigHeader);
          if (txid) {
            // Poll briefly to get current status
            const confirmation = await pollTransactionConfirmation(txid, NETWORK);
            emitPaymentLog("payment.fallback_used", {
              tool: "execute_x402_endpoint",
              paymentId: fallbackPaymentId,
              status: confirmation.status,
              action: "txid_recovery",
              compatShimUsed: false,
            });
            const baseError = formatEndpointError(error, label);
            return {
              ...baseError,
              content: [
                {
                  type: "text" as const,
                  text: baseError.content[0].text +
                    `\n\nCanonical payment status was unavailable, so only txid recovery fallback is available.\n` +
                    `Transaction recovery info:\n` +
                    `  txid: ${confirmation.txid}\n` +
                    `  status: ${confirmation.status}\n` +
                    `  explorer: ${confirmation.explorer}`,
                },
              ],
            };
          }
        }

        return formatEndpointError(error, label);
      }
    }
  );

  // Probe x402 endpoint (discover cost without paying)
  server.registerTool(
    "probe_x402_endpoint",
    {
      description: `Probe an x402 API endpoint to discover its cost WITHOUT making payment.

This tool is useful for:
- Discovering the cost of a paid endpoint before executing
- Checking if an endpoint is free or requires payment
- Presenting costs to users for approval before paying

For free endpoints, returns the response data directly.
For paid endpoints, returns payment details (amount, asset, recipient) without executing payment.

After probing a paid endpoint, use execute_x402_endpoint to actually execute and pay.

Supported sources:
- x402.biwas.xyz (default): Use path like "/api/pools/trending"
- x402.aibtc.com (mainnet) / x402.aibtc.dev (testnet): Use apiUrl="https://x402.aibtc.com" with path like "/inference/openrouter/chat"
- stx402.com: Use apiUrl="https://stx402.com" with path like "/ai/dad-joke"
- aibtc.com (mainnet) / aibtc.dev (testnet): Use apiUrl="https://aibtc.com" with path like "/api/inbox/{address}"
- Any x402-compatible URL: Use url parameter with full endpoint URL`,
      inputSchema: {
        method: z
          .enum(["GET", "POST", "PUT", "DELETE"])
          .default("GET")
          .describe("HTTP method"),
        url: z
          .string()
          .url()
          .optional()
          .describe("Full endpoint URL (e.g., 'https://stx402.com/ai/dad-joke'). Takes precedence over path+apiUrl."),
        path: z
          .string()
          .optional()
          .describe("API endpoint path (e.g., '/api/pools/trending'). Required if url is not provided."),
        apiUrl: z
          .string()
          .url()
          .optional()
          .describe("API base URL. Known sources: x402.biwas.xyz, x402.aibtc.com, stx402.com, aibtc.com. Defaults to configured API_URL."),
        params: z
          .record(z.string(), z.string())
          .optional()
          .describe("Query parameters for GET requests"),
        data: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Request body for POST/PUT requests"),
        asset: z
          .string()
          .optional()
          .describe(
            "Quote the cost in this asset when the endpoint accepts several. Accepts a symbol (\"sBTC\", \"STX\") or a full contract identifier. Defaults to the first asset this client can pay; the full accepts[] list is always returned."
          ),
      },
    },
    async ({ method, url, path, apiUrl, params, data, asset }) => {
      let fullUrl = "";

      try {
        const parsed = parseEndpointUrl({ url, path, apiUrl, params });
        fullUrl = parsed.fullUrl;
        params = parsed.params;

        const result = await probeEndpoint({ method, url: fullUrl, params, data, asset });
        return formatProbeResponse(result, method, fullUrl, { method, url, path, apiUrl, params, data, asset });
      } catch (error) {
        return formatEndpointError(error, fullUrl || "unknown");
      }
    }
  );
}
