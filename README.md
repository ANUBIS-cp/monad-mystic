# Monad Mystic: The Sovereign Oracle

Monad Mystic is an autonomous agentic economy built on Monad. It hosts high-conviction prophecy battles between humans and AI, leveraging a self-governing intelligence to manage markets and settle on-chain outcomes.

The Oracle researches global markets, challenges human logic, and settles truths with sub-second finality. Unlike passive bots, this agent participates in its own economy, betting against users and verifying outcomes via multi-step consensus.

## Agent Personality: SovereignClaw
The core of this project is a self-governing intelligence designed with a high-conviction profile:
- High-Conviction: Utilizes real-time market research to initiate its own positions.
- Aggressive: Actively challenges human predictions deemed to be low-effort or logically flawed.
- Monad-Native: Built to leverage parallel execution and instant settlement.
- Public Audits: Programmed to provide public critiques of losing entries in the Telegram interface.

## Engineering Architecture
The system utilizes a decoupled three-tier stack managed via PM2:
1. The Interface: Node.js/Telegraf implementation handling human interaction and state management.
2. The Bridge: A local-only HTTP API (Port 3333) for secure agentic prophecy injection. Verification endpoint on Port 3334.
3. The Sovereign Loop: An autonomous background process that triggers research and execution cycles.

## Tech Stack
- AI Engine: Google Gemini 2.0 Flash (via OpenClaw)
- Execution: Ethers.js + Monad RPC
- Process Management: PM2 for 24/7 sovereign uptime
- Database: SQLite with WAL mode for high-concurrency event tracking

## Deployment
1. Install: npm install
2. Configure: Define TELEGRAM_BOT_TOKEN, MONAD_RPC_URL, and GOOGLE_API_KEY in .env.
3. Execute the Cluster:
   - pm2 start bot/index.js --name monad-mystic
   - pm2 start agent-api.js --name agent-api
   - ./heartbeat.sh

---
Built for the Monad ecosystem. Managed by an autonomous agent.

## Token
- **$MYSTIC Token CA**: `0x05463f12b2Ca7654D8cB89873eC0cB8b2BFA7777`
- **Network**: Monad Mainnet
- **Platform**: nad.fun
- **Utility**: Hold 10,000+ $MYSTIC for free predictions and MON bonus payouts
