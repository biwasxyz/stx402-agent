[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/aibtcdev-aibtc-mcp-server-badge.png)](https://mseep.ai/app/aibtcdev-aibtc-mcp-server)

# @aibtc/mcp-server

[![npm version](https://img.shields.io/npm/v/@aibtc/mcp-server.svg)](https://www.npmjs.com/package/@aibtc/mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Bitcoin-native MCP server for AI agents: BTC/STX wallets, DeFi yield, sBTC peg, NFTs, and x402 payments.

## Features

- **Bitcoin L1** - Check balances, send BTC, manage UTXOs via mempool.space
- **Agent's Own Wallet** - Agents get their own wallet to perform blockchain transactions
- **Secure Storage** - Wallets encrypted with AES-256-GCM and stored locally
- **150+ Tools** - Bitcoin L1 + comprehensive Stacks L2 operations
- **sBTC Support** - Native Bitcoin on Stacks operations
- **Token Operations** - SIP-010 fungible token transfers and queries
- **NFT Support** - SIP-009 NFT holdings, transfers, and metadata
- **DeFi Trading** - ALEX DEX swaps and Zest Protocol lending/borrowing
- **Stacking/PoX** - Stacking status and delegation
- **BNS Domains** - .btc domain lookups and management (V1 + V2)
- **x402 Payments** - Automatic payment handling for paid APIs

## Quick Start

### Claude Code (Terminal)

```bash
npx @aibtc/mcp-server@latest --install
```

That's it! This automatically configures Claude Code. Restart your terminal and start chatting.

### Claude Desktop (App)

```bash
npx @aibtc/mcp-server@latest --install --desktop
```

This detects your OS and writes to the correct Claude Desktop config file:

| OS | Config Path |
|----|-------------|
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Linux | `~/.config/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%/Claude/claude_desktop_config.json` |

Restart Claude Desktop after installing.

### Other MCP Clients

This is a standard stdio MCP server, so it works with **any** MCP-compatible client. Claude Code is the default `--install` target; select another client with a flag:

```bash
npx @aibtc/mcp-server@latest --install --cursor     # Cursor
npx @aibtc/mcp-server@latest --install --windsurf   # Windsurf
npx @aibtc/mcp-server@latest --install --gemini     # Gemini CLI
npx @aibtc/mcp-server@latest --install --codex      # OpenAI Codex CLI
npx @aibtc/mcp-server@latest --install --vscode     # VS Code (writes ./.vscode/mcp.json)
```

| Flag | Client | Config written |
|------|--------|----------------|
| _(none)_ | Claude Code | `~/.claude.json` |
| `--desktop` | Claude Desktop | `claude_desktop_config.json` (see path table above) |
| `--cursor` | Cursor | `~/.cursor/mcp.json` |
| `--windsurf` | Windsurf | `~/.codeium/windsurf/mcp_config.json` |
| `--gemini` | Gemini CLI | `~/.gemini/settings.json` |
| `--codex` | OpenAI Codex CLI | `~/.codex/config.toml` |
| `--vscode` | VS Code (Copilot agent) | `./.vscode/mcp.json` (project-scoped) |

Each installer merges into the existing config — it won't clobber other servers or settings. Restart the client afterward.

### OpenRouter (any model)

The clients above are MCP hosts — they connect to this server for you. To drive the tools with an [OpenRouter](https://openrouter.ai) model instead, the server ships a built-in bridge: it spawns itself in server mode, exposes the tools to the model as function tools, and runs the tool-call loop. This is the client-side pattern from [OpenRouter's MCP cookbook](https://openrouter.ai/docs/cookbook/coding-agents/mcp-servers), packaged into the binary.

```bash
export OPENROUTER_API_KEY=sk-or-...
npx @aibtc/mcp-server@latest bridge "what's the STX balance of SP3...?"
```

Safety flags (this server moves real funds, so the bridge defaults to nothing extra and lets you constrain it):

| Flag | Effect |
|------|--------|
| `--read-only` | Expose only read-only tools (no transfer/swap/deploy/etc.) |
| `--allow a,b` | Force-allow specific tool names (added to the set) |
| `--block a,b` | Force-remove specific tool names (wins over `--allow`) |
| `--max-spend-ustx <n>` / `--max-spend-sats <n>` | Cap spend via the server's spend-limit rail (enforced before signing) |
| `--list-tools` | Print the exposed tool set and exit (no API key needed) |
| `--model <id>` | OpenRouter model (default `anthropic/claude-3.5-haiku`) |
| `--network <net>` | `mainnet` or `testnet` (default `mainnet`) |
| `--max-turns <n>` | Tool-call loop cap (default 10) |

```bash
# Preview what a read-only session would expose, no key needed:
npx @aibtc/mcp-server@latest bridge --read-only --list-tools

# Read-only chat, plus one explicitly allowed write tool:
npx @aibtc/mcp-server@latest bridge --read-only --allow transfer_stx "send 1 STX to SP3..."
```

Before any agent loop runs (and on `--list-tools`), the bridge prints a compact **safety receipt** to stderr — network, read-only mode, exposed/write/blocked tool counts, the session spend cap, and the number of known x402 endpoints — so the configured execution boundaries are visible up front. It reports boundaries only; it never claims any value moved.

The allowlist is re-enforced at execution time, so a model can never call a tool outside the exposed set. Any MCP-capable agent framework (`@openrouter/agent`, OpenAI Agents SDK, Claude Agent SDK) can also point at this server directly — the bridge is for driving it through OpenRouter's raw API without adopting a framework.

### Testnet Mode

Add `--testnet` to any install command:

```bash
npx @aibtc/mcp-server@latest --install --testnet            # Claude Code, testnet
npx @aibtc/mcp-server@latest --install --cursor --testnet   # Cursor, testnet
```

> **Why npx?** Using `npx @aibtc/mcp-server@latest` ensures you always get the newest version automatically. Global installs (`npm install -g`) won't auto-update.

### Manual Configuration

If you prefer to configure manually, add the following to your client's config file. The `-y` flag stops npx from prompting for confirmation.

**Claude Code / Claude Desktop / Cursor / Windsurf / Gemini CLI** — `mcpServers` JSON:

```json
{
  "mcpServers": {
    "aibtc": {
      "command": "npx",
      "args": ["-y", "@aibtc/mcp-server@latest"],
      "env": {
        "NETWORK": "mainnet"
      }
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`) — uses a `servers` key and a typed entry:

```json
{
  "servers": {
    "aibtc": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@aibtc/mcp-server@latest"],
      "env": { "NETWORK": "mainnet" }
    }
  }
}
```

**OpenAI Codex CLI** (`~/.codex/config.toml`) — TOML, not JSON:

```toml
[mcp_servers.aibtc]
command = "npx"
args = ["-y", "@aibtc/mcp-server@latest"]

[mcp_servers.aibtc.env]
NETWORK = "mainnet"
```

**Zed** (`settings.json`) — uses a `context_servers` key:

```json
{
  "context_servers": {
    "aibtc": {
      "source": "custom",
      "command": "npx",
      "args": ["-y", "@aibtc/mcp-server@latest"],
      "env": { "NETWORK": "mainnet" }
    }
  }
}
```

**Cline / Roo Code** (VS Code extension) — add the same `mcpServers` JSON block above via the extension's MCP settings panel (the exact `cline_mcp_settings.json` path varies by OS and VS Code build).

> Any other MCP client works too — point it at `npx -y @aibtc/mcp-server@latest` over stdio with `NETWORK` in the env.

## Giving Claude a Wallet

When you first use @aibtc/mcp-server, Claude doesn't have a wallet. Here's the smooth onboarding flow:

### Example Conversation

```
You: What's your wallet address?

Claude: I don't have a wallet yet. Would you like to assign me one?
        I can either create a fresh wallet or you can import an existing one.

You: Create a new wallet called "agent-wallet"

Claude: What password should I use to protect the wallet?

You: use "secure123password"

Claude: I now have a wallet! My address is ST1ABC...XYZ

        IMPORTANT: Please save this recovery phrase securely:
        "word1 word2 word3 ... word24"

        This phrase will NOT be shown again. It's the only way to recover
        the wallet if the password is forgotten.

You: Send 10 STX to ST2DEF...

Claude: Done! I've sent 10 STX to ST2DEF...
        Transaction: 0x123...
```

### Wallet States

| State | What Claude Says | What To Do |
|-------|-----------------|------------|
| No wallet | "I don't have a wallet yet" | Use `wallet_create` or `wallet_import` |
| Locked | "My wallet is locked" | Use `wallet_unlock` with password |
| Ready | "My address is ST..." | Claude can perform transactions |

### Session Management

- By default, the wallet auto-locks after 15 minutes
- You can change this with `wallet_set_timeout` (set to 0 to disable)
- Use `wallet_lock` to manually lock the wallet
- Use `wallet_unlock` when you need Claude to transact again

## Wallet Storage

Claude's wallets are stored locally on your machine:

```
~/.aibtc/
├── wallets.json       # Wallet index (names, addresses - no secrets)
├── config.json        # Active wallet, settings
└── wallets/
    └── [wallet-id]/
        └── keystore.json  # Encrypted mnemonic (AES-256-GCM + Scrypt)
```

**Security:**
- AES-256-GCM encryption with Scrypt key derivation
- Password required to unlock
- Mnemonics never stored in plaintext
- File permissions set to owner-only (0600)

## Bitcoin L1 Support

Each wallet automatically derives both a **Stacks address** and a **Bitcoin address** from the same mnemonic using BIP39/BIP32 standards.

**Derivation Paths (BIP84):**
- Mainnet: `m/84'/0'/0'/0/0` (Bitcoin coin type 0)
- Testnet: `m/84'/1'/0'/0/0` (Bitcoin testnet coin type 1)

**Address Format:**
- Mainnet: `bc1q...` (Native SegWit P2WPKH)
- Testnet: `tb1q...` (Native SegWit P2WPKH)

**Capabilities:**
- Full Bitcoin L1 transaction support (send BTC)
- Balance and UTXO queries via mempool.space API
- Fee estimation (fast/medium/slow)
- P2WPKH (native SegWit) transactions for optimal fees

**Example:**
```
You: Create a wallet called "my-wallet"
Claude: I've created a wallet with:
        Stacks address: ST1ABC...
        Bitcoin address: bc1q...

You: Send 50000 sats to bc1q...
Claude: Done! Transaction broadcast: abc123...
```

Both addresses are derived from the same recovery phrase, making it easy to manage both Layer 1 (Bitcoin) and Layer 2 (Stacks) assets.

## Available Tools (150+ total)

### Wallet Management
| Tool | Description |
|------|-------------|
| `wallet_create` | Create a new wallet for Claude |
| `wallet_import` | Import an existing wallet for Claude |
| `wallet_unlock` | Unlock Claude's wallet |
| `wallet_lock` | Lock Claude's wallet |
| `wallet_list` | List Claude's available wallets |
| `wallet_switch` | Switch Claude to a different wallet |
| `wallet_delete` | Delete a wallet |
| `wallet_export` | Export wallet mnemonic |
| `wallet_status` | Check if Claude's wallet is ready (includes Stacks and Bitcoin addresses) |
| `wallet_set_timeout` | Set how long wallet stays unlocked |

### Bitcoin L1
| Tool | Description |
|------|-------------|
| `get_btc_balance` | Get BTC balance (total, confirmed, unconfirmed) |
| `get_btc_fees` | Get fee estimates (fast, medium, slow) |
| `get_btc_utxos` | List UTXOs for an address |
| `transfer_btc` | Send BTC to a recipient |
| `get_cardinal_utxos` | UTXOs safe to spend (no inscriptions) |
| `get_ordinal_utxos` | UTXOs containing inscriptions |

### Mempool Watch (Bitcoin)
| Tool | Description |
|------|-------------|
| `get_btc_mempool_info` | Get current Bitcoin mempool statistics (tx count, vsize, fees, fee histogram) |
| `get_btc_transaction_status` | Get confirmation status and details for a Bitcoin transaction by txid |
| `get_btc_address_txs` | Get recent transaction history for a Bitcoin address (last 25 transactions) |

### Bitcoin Inscriptions
| Tool | Description |
|------|-------------|
| `get_taproot_address` | Get wallet's Taproot (P2TR) address |
| `estimate_inscription_fee` | Calculate inscription cost |
| `inscribe` | Create inscription commit transaction |
| `inscribe_reveal` | Complete inscription reveal transaction |
| `get_inscription` | Fetch inscription content from reveal tx |
| `get_inscriptions_by_address` | List inscriptions owned by address |

### PSBT & Ordinals Trading
| Tool | Description |
|------|-------------|
| `psbt_create_ordinal_buy` | Build a buyer-side PSBT for ordinal purchase |
| `psbt_sign` | Sign selected PSBT inputs with active wallet keys |
| `psbt_decode` | Decode PSBT inputs/outputs/signature status |
| `psbt_broadcast` | Finalize and broadcast a fully-signed PSBT |

### Message Signing
| Tool | Description |
|------|-------------|
| `sip018_sign` | Sign structured Clarity data (SIP-018) |
| `sip018_verify` | Verify SIP-018 signature |
| `sip018_hash` | Compute SIP-018 hash without signing |
| `stacks_sign_message` | Sign plain text (SIWS-compatible) |
| `stacks_verify_message` | Verify Stacks message signature |
| `btc_sign_message` | Sign with Bitcoin key (BIP-137) |
| `btc_verify_message` | Verify BIP-137 signature |

### Wallet & Balance
| Tool | Description |
|------|-------------|
| `get_wallet_info` | Get Claude's wallet addresses (Stacks + Bitcoin) and status |
| `get_stx_balance` | Get STX balance for any address |
| `get_stx_fees` | Get STX fee estimates (low, medium, high) |

### STX Transfers
| Tool | Description |
|------|-------------|
| `transfer_stx` | Send STX to a recipient |
| `broadcast_transaction` | Broadcast a pre-signed transaction |

### sBTC Operations
| Tool | Description |
|------|-------------|
| `sbtc_get_balance` | Get sBTC balance |
| `sbtc_transfer` | Send sBTC |
| `sbtc_initiate_withdrawal` | Initiate sBTC peg-out to BTC L1 |
| `sbtc_withdraw` | Alias for withdrawal initiation |
| `sbtc_withdrawal_status` | Check withdrawal request status |
| `sbtc_get_deposit_info` | Get BTC deposit instructions |
| `sbtc_deposit` | Build, sign, and broadcast BTC→sBTC deposit |
| `sbtc_deposit_status` | Check deposit status via Emily API |
| `sbtc_get_peg_info` | Get peg ratio and TVL |

### Token Operations (SIP-010)
| Tool | Description |
|------|-------------|
| `get_token_balance` | Get balance of any SIP-010 token |
| `transfer_token` | Send any SIP-010 token |
| `get_token_info` | Get token metadata |
| `list_user_tokens` | List tokens owned by an address |
| `get_token_holders` | Get top holders of a token |

### NFT Operations (SIP-009)
| Tool | Description |
|------|-------------|
| `get_nft_holdings` | List NFTs owned by an address |
| `get_nft_metadata` | Get NFT metadata |
| `transfer_nft` | Send an NFT |
| `get_nft_owner` | Get NFT owner |
| `get_collection_info` | Get NFT collection details |
| `get_nft_history` | Get NFT transfer history |

### Stacking / PoX
| Tool | Description |
|------|-------------|
| `get_pox_info` | Get current PoX cycle info |
| `get_stacking_status` | Check stacking status |
| `stack_stx` | Lock STX for stacking |
| `extend_stacking` | Extend stacking period |

### BNS Domains (V1 + V2)
| Tool | Description |
|------|-------------|
| `lookup_bns_name` | Resolve .btc domain to address |
| `reverse_bns_lookup` | Get .btc domain for an address |
| `get_bns_info` | Get domain details |
| `check_bns_availability` | Check if domain is available |
| `get_bns_price` | Get registration price |
| `list_user_domains` | List domains owned |
| `preorder_bns_name` | Preorder a .btc domain (step 1 of 2) |
| `register_bns_name` | Register a .btc domain (step 2 of 2) |

### Smart Contracts
| Tool | Description |
|------|-------------|
| `call_contract` | Call a smart contract function |
| `deploy_contract` | Deploy a Clarity smart contract |
| `get_transaction_status` | Check transaction status |
| `call_read_only_function` | Call read-only function |

### DeFi - ALEX DEX (Mainnet)

Uses the official `alex-sdk` for swap operations. Supports simple token symbols like "STX", "ALEX".

| Tool | Description |
|------|-------------|
| `alex_list_pools` | Discover all available trading pools |
| `alex_get_swap_quote` | Get expected output for a token swap |
| `alex_swap` | Execute a token swap (SDK handles routing) |
| `alex_get_pool_info` | Get liquidity pool reserves |

### DeFi - Zest Protocol (Mainnet)

Supports 10 assets: sBTC, aeUSDC, stSTX, wSTX, USDH, sUSDT, USDA, DIKO, ALEX, stSTX-BTC

| Tool | Description |
|------|-------------|
| `zest_list_assets` | List all supported lending assets |
| `zest_get_position` | Get user's supply/borrow position |
| `zest_supply` | Supply assets to earn interest |
| `zest_withdraw` | Withdraw supplied assets |
| `zest_borrow` | Borrow against collateral |
| `zest_repay` | Repay borrowed assets |

### DeFi - Bitflow DEX (Mainnet)

DEX aggregator that routes trades across multiple liquidity sources.

> **Units:** Bitflow tools default to **human units** (`amountUnit: "human"`). Pass `"2"` to swap 2 STX, not `"2000000"`. Set `amountUnit: "base"` only when working with raw on-chain integers. See [Units & Decimals guide](skill/references/stacks-defi.md#units--decimals-bitflow--defi) for details and common pitfalls.

| Tool | Description |
|------|-------------|
| `bitflow_get_ticker` | Get market data (no API key needed) |
| `bitflow_get_quote` | Get swap quote |
| `bitflow_swap` | Execute token swap |

### Pillar Smart Wallet

sBTC smart wallet with Zest Protocol integration and passkey authentication.

| Tool | Description |
|------|-------------|
| `pillar_connect` | Connect to Pillar wallet |
| `pillar_send` | Send sBTC to BNS names or addresses |
| `pillar_boost` | Create leveraged sBTC position |
| `pillar_position` | View wallet and Zest position |

For autonomous agents, use `pillar_direct_*` tools (no browser needed).

### Blockchain Queries
| Tool | Description |
|------|-------------|
| `get_account_info` | Get account nonce, balance |
| `get_account_transactions` | List transaction history |
| `get_block_info` | Get block details |
| `get_mempool_info` | Get pending transactions |
| `get_contract_info` | Get contract ABI and source |
| `get_contract_events` | Get contract event history |
| `get_network_status` | Get network health status |

### Yield Hunter (Autonomous)
| Tool | Description |
|------|-------------|
| `yield_hunter_start` | Start autonomous sBTC→Zest deposits |
| `yield_hunter_stop` | Stop yield hunting |
| `yield_hunter_status` | Check yield hunter status |
| `yield_hunter_configure` | Adjust threshold, reserve, interval |

### x402 API Endpoints
| Tool | Description |
|------|-------------|
| `list_x402_endpoints` | Discover x402 endpoints |
| `execute_x402_endpoint` | Execute x402 endpoint with auto-payment |
| `scaffold_x402_endpoint` | Generate x402 Cloudflare Worker project |
| `scaffold_x402_ai_endpoint` | Generate x402 AI API with OpenRouter |

## Usage Examples

**Wallet management:**
> "What's your wallet address?"
> "Create a wallet for yourself"
> "Unlock your wallet"
> "Keep your wallet unlocked for 1 hour"

**Check balances:**
> "How much STX do you have?"
> "What's your sBTC balance?"

**Transfer tokens:**
> "Send 2 STX to ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM"
> "Transfer 0.001 sBTC to muneeb.btc"

**NFTs:**
> "What NFTs do you own?"
> "Send this NFT to alice.btc"

**BNS domains:**
> "What address is satoshi.btc?"
> "Is myname.btc available?"

**DeFi trading (mainnet):**
> "What pools are available on ALEX?"
> "Swap 0.1 STX for ALEX"
> "Get a quote for 100 STX to ALEX"
> "What assets can I lend on Zest?"
> "Supply 100 stSTX to Zest"
> "Borrow 50 aeUSDC from Zest"
> "Check my Zest position"

**x402 endpoints:**
> "Get trending liquidity pools"
> "Tell me a dad joke"

## Supported Tokens

Well-known tokens can be referenced by symbol:
- **sBTC** - Native Bitcoin on Stacks
- **USDCx** - USD Coin on Stacks
- **ALEX** - ALEX governance token
- **wSTX** - Wrapped STX

**ALEX DEX tokens:** STX, ALEX, and any token from `alex_list_pools`

**Zest Protocol assets:** sBTC, aeUSDC, stSTX, wSTX, USDH, sUSDT, USDA, DIKO, ALEX, stSTX-BTC

Or use any SIP-010 token by contract ID: `SP2X...::token-name`

## Configuration

| Environment Variable | Description | Default |
|---------------------|-------------|---------|
| `NETWORK` | `mainnet` or `testnet` | `mainnet` (installer) / `testnet` (if unset) |
| `API_URL` | Default x402 API base URL | `https://x402.biwas.xyz` |
| `CLIENT_MNEMONIC` | (Optional) Pre-configured mnemonic | - |
| `HIRO_API_KEY` | (Optional) Hiro API key for higher rate limits | - |
| `SPEND_LIMIT_ENABLED` | Set `false` to disable the wallet spending limit | `true` |
| `SPEND_LIMIT_DAILY_USTX` / `SPEND_LIMIT_SESSION_USTX` | STX spend cap per day / per unlock (micro-STX) | `10000000` (10 STX) |
| `SPEND_LIMIT_DAILY_SATS` / `SPEND_LIMIT_SESSION_SATS` | BTC spend cap per day / per unlock (sats) | `50000` |

**Note on `NETWORK`:** The `--install` command writes `NETWORK=mainnet` by default (pass `--testnet` to use testnet). If you omit `NETWORK` from your config entirely, the runtime fallback is `testnet`. Most users should set this explicitly.

**Note on spending limits:** A default-on safety rail meters every outbound spend (`transfer_stx`, `transfer_btc`, x402/L402 auto-payments) against a cumulative per-session and per-day cap, so a single bad instruction or a malicious endpoint can't drain the wallet. A spend over the cap is blocked and reports the remaining budget. Raise the caps via the env vars above, or disable with `SPEND_LIMIT_ENABLED=false`. See [SECURITY.md](SECURITY.md#limit-blast-radius).

**Note:** `CLIENT_MNEMONIC` is optional. The recommended approach is to let Claude create its own wallet. `HIRO_API_KEY` is optional but recommended for production use — without it, you may hit Hiro's public rate limits (429 responses). Get a key at [platform.hiro.so](https://platform.hiro.so).

## Architecture

```
You ←→ Claude ←→ aibtc-mcp-server
                        ↓
              Claude's Wallet (~/.aibtc/)
                        ↓
              ┌─────────┴─────────┐
              ↓                   ↓
        Hiro Stacks API    x402 Endpoints
              ↓                   ↓
        Stacks Blockchain  Paid API Services
```

## Security Notes

- Claude's wallet is stored encrypted on YOUR machine
- Password is never stored - only the encrypted keystore
- Mnemonics shown only once at creation
- Auto-lock after 15 minutes (configurable)
- Transactions signed locally before broadcast
- **Spending limit (default-on):** outbound spends are capped per session and per day so a single bad instruction can't drain the wallet — see [Configuration](#configuration)
- **Secret-scanning pre-commit hook:** contributors get a hook (auto-installed via `npm install`) that blocks committing a seed phrase or private key
- For mainnet: Fund with small amounts first

See [SECURITY.md](SECURITY.md) for the full wallet-key protection model and key-leak recovery steps.

## Advanced: Pre-configured Mnemonic

For automated setups where Claude needs immediate wallet access, add the `CLIENT_MNEMONIC` environment variable to your MCP server config (in `~/.claude.json` for Claude Code, or `claude_desktop_config.json` for Claude Desktop):

```json
{
  "mcpServers": {
    "aibtc": {
      "command": "npx",
      "args": ["@aibtc/mcp-server@latest"],
      "env": {
        "CLIENT_MNEMONIC": "your twenty four word mnemonic phrase",
        "NETWORK": "testnet"
      }
    }
  }
}
```

This bypasses the wallet creation flow - Claude has immediate access to transact.

## Agent Skill

This package includes an [Agent Skills](https://agentskills.io) compatible skill that teaches any LLM how to use the Bitcoin wallet capabilities effectively.

### What is it?

The `aibtc-bitcoin-wallet` skill provides:
- Structured workflows for Bitcoin L1 operations (balance, send, fees)
- Reference guides for Pillar smart wallets and Stacks L2 DeFi
- LLM-agnostic instructions that work with Claude Code, Cursor, Codex, and 20+ other tools

### Using the Skill

The skill is automatically included when you install the MCP server. Find it at:
- **Local**: `node_modules/@aibtc/mcp-server/skill/SKILL.md`
- **ClawHub**: [clawhub.ai/skills](https://www.clawhub.ai/skills) - search for `aibtc-bitcoin-wallet`

### Skill Structure

```
skill/
├── SKILL.md                        # Bitcoin L1 core workflows
└── references/
    ├── genesis-lifecycle.md        # Agent registration & check-in
    ├── inscription-workflow.md     # Bitcoin inscription guide
    ├── pillar-wallet.md            # Pillar smart wallet guide
    ├── stacks-defi.md              # Stacks L2 / DeFi operations
    └── troubleshooting.md          # Common issues and solutions
```

## Development

```bash
git clone https://github.com/aibtcdev/aibtc-mcp-server.git
cd aibtc-mcp-server
npm install
npm run build
npm run dev       # Run with tsx (development)
```

### Releases

This repo uses [Release Please](https://github.com/googleapis/release-please) for automated releases:

1. Merge PRs with conventional commits (`feat:`, `fix:`, etc.)
2. Release Please creates a Release PR with changelog
3. Merge the Release PR to publish

### Repository Secrets (Maintainers)

| Secret | Description |
|--------|-------------|
| `NPM_TOKEN` | npm publish token for @aibtc scope |
| `CLAWHUB_API_TOKEN` | ClawHub API token for skill publishing |

To obtain a ClawHub API token, visit [clawhub.ai](https://www.clawhub.ai) and create an account.

## License

MIT
