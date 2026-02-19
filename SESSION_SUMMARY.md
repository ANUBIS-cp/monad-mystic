# Monad Mystic - Current State (Feb 18, 2026)

## Project Overview
Telegram bot on Monad blockchain for crypto price predictions. Users pay 0.1 MON or hold 250K $MYSTIC tokens for free predictions. Autonomous AI agent "Claw" makes predictions every 13 minutes using self-analysis and pattern learning.

## Tech Stack
- **Backend:** Node.js (CommonJS), Telegraf, SQLite (WAL mode), ethers.js v6
- **AI:** Groq API - llama-4-maverick-17b-128e-instruct (128 MoE experts)
- **Processes:** bot (index.js), claw-agent (claw-agent.js), agent-api (agent-api.js)
- **Server:** Ubuntu 24, pm2, GitHub: rayzelnoblesse5/monad-mystic

## Recent Major Changes (Feb 17-18)
1. ✅ Database race condition fixed (atomic UPDATE operations)
2. ✅ Upgraded to Maverick 128-expert model (from 8B instant)
3. ✅ Coin validation before payment (prevents invalid tickers)
4. ✅ Chog conversation memory (3-exchange history per user)
5. ✅ Self-analysis protocol (Claw reviews win rates before predicting)
6. ✅ Action diversity rule (prevents REACT spam loops)
7. ✅ Token optimization (13-min cycles, 800 max tokens)

## Current Configuration
- **Entry:** 0.1 MON → **Win:** 0.2 MON (paid) / 0.07 MON (Mystic holders)
- **Mystic threshold:** 250,000 tokens
- **Claw:** 13-min cycles, 9 predictions/day limit
- **Groq limits:** 500K tokens/day, 1K requests/day (~200/day usage = safe)
- **Models:** llama-4-maverick-17b-128e everywhere

## Critical Rules
- User is copy-paste only - give complete bash/Python commands
- Always test with `node -c` before `pm2 restart`
- Use Python one-liners for file edits (never vim/nano)
- Groq uses CommonJS (require), NOT ESM (import)
- SQLite in WAL mode (prevents locks)
- Verify Gemini/GPT claims before applying - they're often wrong

## Monitoring Points
- Maverick intelligence: Are predictions more conservative/realistic?
- Request count: Stay under 1K/day
- Action diversity: Is Claw still stuck in REACT loops?

## Key Files
- **bot/index.js** - Main Telegram bot, payment flow, commands
- **claw-agent.js** - Autonomous agent with self-analysis
- **agent-api.js** - Local API for agent predictions
- **bot/prophecy.js** - Validation, generation, verification
- **bot/blockchain.js** - Payment verification, payouts

## Full Context
Complete transcript: /mnt/transcripts/2026-02-17-16-39-16-groq-migration-chog-chat-db-fixes.txt
Instructions: AI_WORKFLOW.md in Project Knowledge
