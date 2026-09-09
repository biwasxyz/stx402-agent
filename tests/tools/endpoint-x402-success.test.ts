import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateApiClient = vi.fn();
const mockCheckSufficientBalance = vi.fn();
const mockGenerateDedupKey = vi.fn(() => "dedup-key-success");
const mockCheckDedupCache = vi.fn(() => null);
const mockRecordTransaction = vi.fn();

vi.mock("../../src/services/x402.service.js", () => ({
  createApiClient: mockCreateApiClient,
  API_URL: "https://aibtc.com",
  probeEndpoint: vi.fn(),
  formatPaymentAmount: vi.fn((amount: string, asset: string) => `${amount} ${asset}`),
  checkSufficientBalance: mockCheckSufficientBalance,
  generateDedupKey: mockGenerateDedupKey,
  checkDedupCache: mockCheckDedupCache,
  recordTransaction: mockRecordTransaction,
  NETWORK: "mainnet",
}));

vi.mock("../../src/utils/x402-recovery.js", () => ({
  extractPaymentIdFromPaymentSignature: vi.fn(() => null),
  extractTxidFromPaymentSignature: vi.fn(() => null),
  pollTransactionConfirmation: vi.fn(),
}));

const { registerEndpointTools } = await import("../../src/tools/endpoint.tools.js");

interface RegisteredTool {
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function createTrackingServer() {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool: vi.fn(
      (
        name: string,
        _config: { description: string; inputSchema: unknown },
        handler: RegisteredTool["handler"]
      ) => {
        tools.set(name, { handler });
      }
    ),
  };
  return { server, tools };
}

function buildOkResponse(opts: {
  data: unknown;
  paymentAttempted: boolean;
  headers?: Record<string, string>;
}) {
  const headers: Record<string, string> = {
    ...(opts.headers ?? {}),
  };
  if (opts.paymentAttempted) {
    headers["payment-signature"] = "encoded-payment-sig";
  }
  return {
    data: opts.data,
    headers,
    config: { headers },
  };
}

describe("execute_x402_endpoint success-path txid handling (#487 Gap 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the real txid when the upstream response exposes one", async () => {
    const realTxid = "0x9481360565e9aba28b7fe63f5a1aa931bdf877fa9974d291c5293eeae8c44706";
    const request = vi.fn().mockResolvedValue(
      buildOkResponse({
        data: { txid: realTxid, classifiedId: "abc-123" },
        paymentAttempted: true,
      })
    );
    mockCreateApiClient.mockResolvedValue({ request });

    const { server, tools } = createTrackingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerEndpointTools(server as any);
    const tool = tools.get("execute_x402_endpoint")!;

    const result = (await tool.handler({
      method: "POST",
      url: "https://aibtc.news/api/classifieds",
      autoApprove: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.txid).toBe(realTxid);
    expect(body.txidNote).toBeUndefined();
    expect(mockRecordTransaction).toHaveBeenCalledWith("dedup-key-success", realTxid);
  });

  it("reads the x402 V2 settlement txid from the payment-response header", async () => {
    const realTxid = "5d6598358e76fd30d3946c6a6b776f400dddfcfcd884b6aed5cfafeabe74cfb6";
    const paymentResponse = Buffer.from(
      JSON.stringify({ success: true, payer: "SPTEST", transaction: realTxid, network: "stacks:1" })
    ).toString("base64");
    const request = vi.fn().mockResolvedValue(
      buildOkResponse({
        data: { payment: { amount: "100", asset: "sBTC" } },
        paymentAttempted: true,
        headers: { "payment-response": paymentResponse },
      })
    );
    mockCreateApiClient.mockResolvedValue({ request });

    const { server, tools } = createTrackingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerEndpointTools(server as any);
    const tool = tools.get("execute_x402_endpoint")!;

    const result = (await tool.handler({
      method: "GET",
      url: "https://api.vibewatch.io/api/v1/public/stacks-index/pro/projects/bitflow-finance-af3b",
      autoApprove: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.txid).toBe(realTxid);
    expect(body.txidNote).toBeUndefined();
    expect(mockRecordTransaction).toHaveBeenCalledWith("dedup-key-success", realTxid);
  });

  it("reads the settlement txid from response.data.payment.txid", async () => {
    const realTxid = "a1b2c3d4e5f60123456789abcdef0123456789abcdef0123456789abcdef0123";
    const request = vi.fn().mockResolvedValue(
      buildOkResponse({
        data: { payment: { txid: realTxid, amount: "100", asset: "sBTC", network: "stacks:1" } },
        paymentAttempted: true,
      })
    );
    mockCreateApiClient.mockResolvedValue({ request });

    const { server, tools } = createTrackingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerEndpointTools(server as any);
    const tool = tools.get("execute_x402_endpoint")!;

    const result = (await tool.handler({
      method: "GET",
      url: "https://api.vibewatch.io/api/v1/public/stacks-index/pro/projects/bitflow-finance-af3b",
      autoApprove: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.txid).toBe(realTxid);
    expect(body.txidNote).toBeUndefined();
    expect(mockRecordTransaction).toHaveBeenCalledWith("dedup-key-success", realTxid);
  });
  it("returns txid: null with a recovery hint when payment confirmed but txid not observable", async () => {
    const request = vi.fn().mockResolvedValue(
      buildOkResponse({
        data: { classifiedId: "abc-456", paymentStatus: "settled" }, // no txid in body or headers
        paymentAttempted: true,
      })
    );
    mockCreateApiClient.mockResolvedValue({ request });

    const { server, tools } = createTrackingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerEndpointTools(server as any);
    const tool = tools.get("execute_x402_endpoint")!;

    const result = (await tool.handler({
      method: "POST",
      url: "https://aibtc.news/api/classifieds",
      autoApprove: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);

    // The fix: no fabricated placeholder, explicit null + actionable note
    expect(body.txid).toBeNull();
    expect(typeof body.txidNote).toBe("string");
    expect(body.txidNote).toContain("get_account_transactions");
    expect(result.content[0].text).not.toContain("unknown-txid-");

    // Dedup tracking still active under a synthetic pending marker
    expect(mockRecordTransaction).toHaveBeenCalledWith(
      "dedup-key-success",
      "pending:dedup-key-success"
    );
  });

  it("omits the txid field entirely when no payment was attempted and no txid is present", async () => {
    const request = vi.fn().mockResolvedValue(
      buildOkResponse({
        data: { ok: true },
        paymentAttempted: false,
      })
    );
    mockCreateApiClient.mockResolvedValue({ request });

    const { server, tools } = createTrackingServer();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerEndpointTools(server as any);
    const tool = tools.get("execute_x402_endpoint")!;

    const result = (await tool.handler({
      method: "GET",
      url: "https://aibtc.com/api/free-endpoint",
      autoApprove: true,
    })) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect("txid" in body).toBe(false);
    expect("txidNote" in body).toBe(false);
    expect(mockRecordTransaction).not.toHaveBeenCalled();
  });
});
