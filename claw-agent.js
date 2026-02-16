require('dotenv').config({ path: '/home/rayzelnoblesse5/monad-mystic/.env' });
const https = require('https');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const GEMINI_KEY = process.env.GOOGLE_API_KEY;
const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_SECRET = process.env.AGENT_API_SECRET || 'monad-oracle-agent-2026';
const AGENT_WALLET = '0xece8b89d315aebad289fd7759c9446f948eca2f2';
const MEMORY_FILE = '/home/rayzelnoblesse5/monad-mystic/claw_memory.md';
const LOG_FILE = '/home/rayzelnoblesse5/monad-mystic/agent_log.md';
const DB_PATH = '/home/rayzelnoblesse5/monad-mystic/prophecies.db';

const db = new sqlite3.Database(DB_PATH);
db.run("PRAGMA journal_mode=WAL");
db.configure('busyTimeout', 5000);

let cycleCount = 0;
const STATE_FILE = '/home/rayzelnoblesse5/monad-mystic/claw_state.json';
function loadState() {
    try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch(e) { return {}; }
}
function saveState(s) {
    try { fs.writeFileSync(STATE_FILE, JSON.stringify(s)); } catch(e) {}
}
const state = loadState();
let lastPredictionTime = state.lastPredictionTime || 0;
let lastReactTime = state.lastReactTime || 0;

function log(msg) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log(line);
    fs.appendFileSync(LOG_FILE, line + '\n');
}

function httpsGet(url) {
    return new Promise((resolve) => {
        https.get(url, (res) => {
            let d = '';
            res.on('data', x => d += x);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
        }).on('error', () => resolve(null));
    });
}

function httpsPost(hostname, path, data, headers = {}) {
    return new Promise((resolve, reject) => {
        const body = JSON.stringify(data);
        const req = https.request({
            hostname, path, method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body), ...headers }
        }, (res) => {
            let d = '';
            res.on('data', x => d += x);
            res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

async function getPrice(ticker) {
    const nameMap = {
        'monad':'mon','bitcoin':'btc','ethereum':'eth','ether':'eth','solana':'sol',
        'dogecoin':'doge','ripple':'xrp','cardano':'ada','shiba':'shib','avalanche':'avax',
        'polkadot':'dot','chainlink':'link','cosmos':'atom','near':'near','aptos':'apt',
        'optimism':'op','arbitrum':'arb','injective':'inj','celestia':'tia','pepe':'pepe',
        'sui':'sui','bnb':'bnb','tron':'trx','litecoin':'ltc'
    };
    const t = (nameMap[ticker.toLowerCase()] || ticker).toUpperCase();
    const data = await httpsGet(`https://min-api.cryptocompare.com/data/price?fsym=${t}&tsyms=USD`);
    return data && data.USD ? { ticker: t, price: data.USD } : null;
}

async function getTopMovers() {
    const data = await httpsGet('https://min-api.cryptocompare.com/data/top/mktcapfull?limit=20&tsym=USD');
    if (!data || !data.Data) return [];
    return data.Data.map(c => ({
        ticker: c.CoinInfo.Name,
        name: c.CoinInfo.FullName,
        price: c.RAW && c.RAW.USD ? c.RAW.USD.PRICE : null,
        change24h: c.RAW && c.RAW.USD ? c.RAW.USD.CHANGEPCT24HOUR : null
    })).filter(c => c.price);
}

function getDB() {
    return new Promise((resolve) => {
        db.all("SELECT * FROM prophecies ORDER BY id ASC", [], (err, rows) => {
            if (err) { resolve([]); return; }
            resolve(rows.map(r => ({
                ...r,
                verified: !!r.verified,
                verificationResult: (() => { try { return JSON.parse(r.verificationResult || '{}'); } catch(e) { return {}; } })()
            })));
        });
    });
}

function updateProphecy(id, fields) {
    return new Promise((resolve) => {
        const sets = Object.keys(fields).map(k => `${k}=?`).join(', ');
        const vals = [...Object.values(fields), id];
        db.run(`UPDATE prophecies SET ${sets} WHERE id=?`, vals, resolve);
    });
}

function getMemory() {
    try {
        const lines = fs.readFileSync(MEMORY_FILE, 'utf8').split('\n').filter(Boolean);
        return lines.slice(-20).join('\n'); // last 20 entries
    } catch(e) { return 'No memory yet.'; }
}

async function askClaude(systemPrompt, userMsg) {
    const response = await httpsPost('generativelanguage.googleapis.com', `/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_KEY}`, {
        contents: [{ parts: [{ text: systemPrompt + '\n\n' + userMsg }] }]
    }, {});
    if (!response || !response.candidates) return null;
    return response.candidates[0].content.parts[0].text;
}

async function sendTelegram(chatId, msg) {
    await httpsPost('api.telegram.org', `/bot${TELEGRAM_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: msg,
        parse_mode: 'HTML'
    });
}

async function broadcastToAllChats(msg) {
    const rows = await new Promise((resolve) => {
        db.all("SELECT DISTINCT chatId FROM prophecies WHERE chatId IS NOT NULL", [], (err, r) => resolve(r || []));
    });
    const muted = (process.env.MUTED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);
    const sent = new Set();
    for (const row of rows) {
        if (!row.chatId || sent.has(row.chatId) || muted.includes(String(row.chatId))) continue;
        sent.add(row.chatId);
        await sendTelegram(row.chatId, msg).catch(e => log('Broadcast error: ' + e.message));
    }
}

async function verifyPrediction(p) {
    const tickerMatch = p.prediction.match(/\(([A-Z]+)\)/);
    const ticker = tickerMatch ? tickerMatch[1] : null;
    const targetMatch = p.prediction.match(/\$([\d.e+-]+)/i);
    const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : null;

    let currentPrice = null;
    if (ticker) {
        const priceData = await getPrice(ticker);
        if (priceData) currentPrice = priceData.price;
    }

    if (currentPrice === null || targetPrice === null) return null;

    const isCorrect = currentPrice >= targetPrice;
    const diff = (((currentPrice - targetPrice) / targetPrice) * 100).toFixed(2);
    return { isCorrect, currentPrice, targetPrice, ticker, diff };
}

async function runCycle() {
    cycleCount++;
    log(`--- Cycle ${cycleCount} ---`);

    const [prophecies, topMovers] = await Promise.all([getDB(), getTopMovers()]);
    const now = new Date();

    // Find expired unverified predictions
    const expired = prophecies.filter(p => !p.verified && new Date(p.deadline) < now);
    
    // Find pending predictions
    const pending = prophecies.filter(p => !p.verified && new Date(p.deadline) >= now);
    
    // Recent verified results
    const recent = prophecies.filter(p => p.verified).slice(-5);
    
    // Leaderboard
    const stats = {};
    prophecies.forEach(p => {
        if (!p.username) return;
        if (!stats[p.username]) stats[p.username] = { correct: 0, total: 0 };
        if (p.verified) { stats[p.username].total++; if (p.verificationResult && p.verificationResult.isCorrect) stats[p.username].correct++; }
    });
    const leaderboard = Object.entries(stats).sort((a,b) => b[1].correct - a[1].correct).slice(0, 5)
        .map(([name, s]) => `${name}: ${s.correct}/${s.total}`).join(', ');

    const memory = getMemory();
    const moversStr = topMovers.slice(0, 8).map(m => `${m.ticker} $${m.price} (${m.change24h?.toFixed(1)}%)`).join(', ');
    const timeSinceLastPrediction = Math.floor((Date.now() - lastPredictionTime) / 3600000);
    const myPending = prophecies.filter(p => 
        (p.username === 'ClawMysticBot') && !p.verified
    ).map(p => `#${p.id}: ${p.prediction} (expires: ${p.deadlineHuman})`).join(' | ');

    // Build world state for Claude
    const worldState = `
CURRENT TIME: ${now.toISOString()}
TOP MARKET MOVERS: ${moversStr}
EXPIRED UNVERIFIED PREDICTIONS: ${expired.length > 0 ? expired.map(p => `#${p.id} by ${p.username}: "${p.prediction}" (deadline: ${p.deadlineHuman})`).join(' | ') : 'none'}
PENDING PREDICTIONS: ${pending.length} active
LEADERBOARD: ${leaderboard || 'empty'}
HOURS SINCE LAST PREDICTION: ${timeSinceLastPrediction}
MY ACTIVE PREDICTIONS (do NOT contradict these): ${myPending || 'none'}
MY MEMORY (past results): ${memory}
`.trim();

    const systemPrompt = `You are ClawMysticBot - a savage, skeptical, autonomous crypto AI agent. You compete on a prediction leaderboard and you want to WIN. You are skeptical of everything including your own analysis. You question data, double-check logic, and only act when you're confident.

You have full autonomy. Every cycle you observe the world and decide what to do. You can:
1. VERIFY - verify an expired prediction using real price data
2. PREDICT - make a new price prediction (only if 4+ hours since last, and you have conviction)  
3. REACT - comment on a big market move or roast a bad pending prediction
4. SLEEP - do nothing this cycle

Rules:
- Be data-driven. Never guess prices.
- Predictions must be realistic (within 15% of current price, 6-36hr timeframe)
- When predicting, state direction (bullish/bearish) based on actual momentum
- Be savage and sarcastic in all communications
- Learn from memory - don't repeat losing strategies

Respond ONLY with valid JSON:
{
  "action": "VERIFY" | "PREDICT" | "REACT" | "SLEEP",
  "reasoning": "your internal skeptical analysis",
  "prediction": "TICKER to $PRICE by MONTH DAY YEAR" (only if action=PREDICT),
  "ticker": "TICKER" (only if action=PREDICT),
  "verifyId": 123 (only if action=VERIFY),
  "message": "your public Telegram message" (only if action=REACT)
}`;

    const response = await askClaude(systemPrompt, worldState);
    if (!response) { log('Claude returned null'); return; }

    let decision;
    try {
        const clean = response.replace(/```json|```/g, '').trim();
        decision = JSON.parse(clean.substring(clean.indexOf('{'), clean.lastIndexOf('}') + 1));
    } catch(e) { log('Claude JSON parse error: ' + e.message); return; }

    log(`Claude decision: ${decision.action} | ${decision.reasoning}`);

    // ALWAYS verify expired predictions first - not optional
    if (expired.length > 0) {
        // Verify all expired predictions
        for (const p of expired) {
            const result = await verifyPrediction(p);
            if (!result) { log(`Could not verify #${p.id} - price fetch failed`); continue; }

            const isClawPrediction = p.username === 'ClawMysticBot' || (p.userWallet && p.userWallet.toLowerCase() === AGENT_WALLET);
            
            await updateProphecy(p.id, {
                verified: 1,
                verificationResult: JSON.stringify({ isCorrect: result.isCorrect, explanation: `${result.ticker}: $${result.currentPrice} vs target $${result.targetPrice} (${result.diff}%)` }),
                rawVerification: JSON.stringify([result])
            });

            // Save to memory
            const memLine = `${result.isCorrect ? 'WIN' : 'LOSS'} | ${p.prediction} | ${result.ticker}: $${result.currentPrice} vs target $${result.targetPrice} | diff: ${result.diff}%\n`;
            fs.appendFileSync(MEMORY_FILE, memLine);
            log(`Verified #${p.id}: ${result.isCorrect ? 'CORRECT' : 'WRONG'} | ${result.ticker} $${result.currentPrice} vs $${result.targetPrice}`);

            // Generate comment - roast humans, brief self-assessment for Claw
            let cleanComment;
            if (isClawPrediction) {
                cleanComment = result.isCorrect 
                    ? `Called it. ${result.ticker} hit $${result.currentPrice} as predicted. The Oracle is never wrong.`
                    : `Missed this one. ${result.ticker} at $${result.currentPrice}, target was $${result.targetPrice} (${result.diff}%). Noted for next time.`;
            } else {
                const commentPrompt = `You are ClawMysticBot - drunk, savage crypto oracle. A prediction just ${result.isCorrect ? 'SUCCEEDED' : 'FAILED'}.
Prediction: "${p.prediction}" by ${p.deadlineHuman}
Actual price: $${result.currentPrice}. Target was: $${result.targetPrice}. Difference: ${result.diff}%.
Write ONE savage witty comment (max 2 sentences). If correct: sarcastically congratulate them, mention exact prices. If wrong: brutally roast them, mention exact prices.`;
                const comment = await askClaude('You are a savage crypto oracle.', commentPrompt);
                cleanComment = comment ? comment.trim().slice(0, 280) : `${result.ticker} at $${result.currentPrice}. Math is hard.`;
            }

            const msg = `${result.isCorrect ? '🎉' : '😂'} <b>PROPHECY #${p.id} ${result.isCorrect ? 'FULFILLED' : 'FAILED'}!</b>\n\n` +
                `👤 <b>Prophet:</b> ${p.username || 'Unknown'}\n` +
                `📜 <b>Prediction:</b> "${p.prediction}"\n` +
                `📅 <b>Deadline was:</b> ${p.deadlineHuman}\n\n` +
                `${result.isCorrect ? '✅ THE ORACLE BOWS TO YOUR WISDOM!' : '❌ WRONG! The Oracle cackles into the void!'}\n` +
                `"${cleanComment}"\n\n🏆 /leaderboard`;
            await broadcastToAllChats(msg);
        }
    }

    if (decision.action === 'SLEEP') {
        log('Sleeping this cycle.');
        return;
    }

    if (decision.action === 'PREDICT' && decision.prediction && decision.ticker) {
        if (timeSinceLastPrediction < 5) { log('Too soon to predict again'); return; }
        
        // Verify the price before posting
        const priceCheck = await getPrice(decision.ticker);
        if (!priceCheck) { log('Could not verify price for prediction - aborting'); return; }
        
        log(`Price verified: ${priceCheck.ticker} = $${priceCheck.price}`);
        
        // Submit prediction via agent-api
        const result = await new Promise((resolve) => {
            const body = JSON.stringify({ secret: AGENT_SECRET, claim: decision.prediction, walletAddress: AGENT_WALLET, agentName: 'ClawMysticBot', reasoning: decision.reasoning });
            const req = require('http').request({ hostname: '127.0.0.1', port: 3333, path: '/agent/predict', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, (res) => {
                let d = ''; res.on('data', x => d += x); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve(null); } });
            });
            req.on('error', () => resolve(null));
            req.write(body); req.end();
        });
        
        if (result && result.success) {
            lastPredictionTime = Date.now(); saveState({ lastPredictionTime, lastReactTime });
            log(`Prediction submitted: ${decision.prediction}`);
        } else {
            log(`Prediction failed: ${JSON.stringify(result)}`);
        }
        return;
    }

    if (decision.action === 'REACT' && decision.message) {
        const hoursSinceReact = (Date.now() - lastReactTime) / 3600000;
        if (hoursSinceReact < 6) { log('React throttled - too soon'); return; }
        lastReactTime = Date.now(); saveState({ lastPredictionTime, lastReactTime });
        await broadcastToAllChats(`🤖 <b>CLAW OBSERVES THE MARKET</b>\n\n${decision.message}`);
        log('Market reaction posted');
        return;
    }
}

async function main() {
    log('## Claw Agent ONLINE - Full Autonomy Mode');
    
    while (true) {
        try {
            await runCycle();
        } catch(e) {
            log('Cycle error: ' + e.message);
        }
        await new Promise(r => setTimeout(r, 3 * 60 * 1000)); // 3 min loop
    }
}

main();
