require('dotenv').config();
const http = require('http');
const { validateClaim, generateProphecy } = require('./bot/prophecy');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const AGENT_API_SECRET = process.env.AGENT_API_SECRET;
if (!AGENT_API_SECRET) {
    console.error("❌ FATAL: AGENT_API_SECRET is missing in .env");
    process.exit(1);
}
const dbPath = '/home/rayzelnoblesse5/monad-mystic/prophecies.db';
const cacheFile = 'prophecies_cache.json';

async function fetchPrice(ticker, retries = 3) {
    const https = require('https');
    for (let attempt = 0; attempt < retries; attempt++) {
        const price = await new Promise((resolve) => {
            https.get(`https://min-api.cryptocompare.com/data/price?fsym=${ticker.toUpperCase()}&tsyms=USD`, (res) => {
                let d = ''; res.on('data', x => d += x);
                res.on('end', () => { try { const p = JSON.parse(d); resolve(p.USD || null); } catch(e) { resolve(null); } });
            }).on('error', () => resolve(null));
        });
        if (price !== null) return price;
        if (attempt < retries - 1) await new Promise(r => setTimeout(r, 1000));
    }
    return null;
}


// Use separate DB connection with busy timeout to avoid SQLITE_BUSY crashes
const sqldb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Agent API DB error:', err.message);
});
sqldb.run("PRAGMA journal_mode=WAL");  // WAL mode allows concurrent reads
sqldb.configure('busyTimeout', 5000);  // Wait up to 5s if locked

function escapeMD(str) {
    if (!str) return '';
    return str.replace(/[_*`[\]()~>#+=|{}.!-]/g, '\\$&');
}

const getDB = () => new Promise((resolve) => {
    sqldb.all("SELECT * FROM prophecies ORDER BY id ASC", [], (err, rows) => {
        if (err) { console.error('Agent DB read error:', err.message); resolve([]); return; }
        resolve(rows.map(row => ({
            ...row,
            verified: !!row.verified,
            payoutSent: !!row.payoutSent,
            isProcessing: !!row.isProcessing,
            payoutFailed: !!row.payoutFailed,
            verificationResult: (() => { try { return JSON.parse(row.verificationResult || '{}'); } catch(e) { return {}; } })(),
            rawVerification: (() => { try { return JSON.parse(row.rawVerification || '[]'); } catch(e) { return []; } })()
        })));
    });
});

const saveDB = (data) => new Promise((resolve) => {
    sqldb.serialize(() => {
        sqldb.run("BEGIN TRANSACTION");
        const stmt = sqldb.prepare("INSERT OR REPLACE INTO prophecies (id, userWallet, username, userId, chatId, prediction, deadline, deadlineHuman, text, verified, verificationResult, rawVerification, payoutSent, payoutMethod, payoutFailed, isProcessing, onChainId, timestamp, paymentTx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
        data.forEach(p => {
            stmt.run(p.id, p.userWallet, p.username, p.userId, p.chatId,
                p.prediction, p.deadline, p.deadlineHuman, p.text,
                p.verified ? 1 : 0, JSON.stringify(p.verificationResult || {}),
                JSON.stringify(p.rawVerification || []),
                p.payoutSent ? 1 : 0, p.payoutMethod,
                p.payoutFailed ? 1 : 0, p.isProcessing ? 1 : 0,
                p.onChainId, p.timestamp, p.paymentTx);
        });
        stmt.finalize();
        sqldb.run("COMMIT", (err) => {
            if (err) console.error('Agent DB commit error:', err.message);
            resolve();
        });
    });
});

// Get announcement chat from cache
let ANNOUNCEMENT_CHAT_ID = null;
try {
    const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8') || '[]');
    const last = cache.filter(p => p.chatId).pop();
    if (last) ANNOUNCEMENT_CHAT_ID = last.chatId;
    console.log('Agent API announcement chat:', ANNOUNCEMENT_CHAT_ID);
} catch(e) {}

http.createServer(async (req, res) => {
    // Health check endpoint
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'ok', announcementChat: ANNOUNCEMENT_CHAT_ID }));
        return;
    }

    if (req.method === 'GET' && req.url === '/agent/verify') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'verify triggered' }));
        return;
    }

    if (req.method !== 'POST' || (req.url !== '/agent/predict' && req.url !== '/predict')) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
    }

    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
        try {
            const { secret, claim, walletAddress, agentName, reasoning } = JSON.parse(body);

            if (secret !== AGENT_API_SECRET) {
                res.writeHead(401);
                res.end(JSON.stringify({ error: 'Unauthorized' }));
                return;
            }

            if (!claim || claim.trim().length < 5) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: 'Claim too short' }));
                return;
            }

            const val = await validateClaim(claim);
            if (!val.valid) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: val.reason }));
                return;
            }

            const db = await getDB();
            const id = db.length > 0 ? Math.max(...db.map(p => p.id)) + 1 : 0;
            const displayName = agentName || '@MonadMysticAgent';
            const isAgentCall = !!agentName;
            let result;
            if (isAgentCall) {
                // Agent predictions: use claim as-is, no Gemini rewrite
                const deadline = new Date(Date.now() + 24 * 3600000);
                // Parse deadline from claim if present e.g. "SOL to $91 by FEBRUARY 17 2026"
                const deadlineMatch = claim.match(/by\s+([A-Z]+\s+\d+\s+\d{4})/i);
                const parsedDeadline = deadlineMatch ? new Date(deadlineMatch[1]) : deadline;
                const finalDeadline = isNaN(parsedDeadline) ? deadline : parsedDeadline;
                // Parse prediction ticker and target
                const tickerMatch = claim.match(/^([A-Z]+)\s+to\s+\$([\d.]+)/i);
                const prediction = tickerMatch ? 
                    `${tickerMatch[1].toUpperCase()} will reach $${tickerMatch[2]}` : claim;
                
                // Fetch initialPrice for agent predictions
                let initialPrice = null;
                if (tickerMatch) {
                    initialPrice = await fetchPrice(tickerMatch[1]);
                }
                
                result = {
                    prediction,
                    deadline: finalDeadline.toISOString(),
                    deadlineHuman: finalDeadline.toLocaleString('en-US', { month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true }),
                    text: reasoning || null,
                    initialPrice
                };
            } else {
                result = await generateProphecy(claim);
            }

            const newProphecy = {
                id,
                userWallet: walletAddress || 'agent-wallet',
                username: displayName,
                userId: 0,
                chatId: ANNOUNCEMENT_CHAT_ID,
                prediction: result.prediction,
                deadline: result.deadline,
                deadlineHuman: result.deadlineHuman,
                text: result.text,
                initialPrice: result.initialPrice || null,
                verified: false,
                verificationResult: {},
                rawVerification: [],
                timestamp: new Date().toISOString(),
                paymentTx: 'agent-direct',
                payoutSent: false,
                isProcessing: false,
                payoutFailed: false,
                payoutMethod: null,
                onChainId: null
            };

            db.push(newProphecy);
            await saveDB(db);

            // Refresh announcement chat from cache in case it was updated
            try {
                const cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8') || '[]');
                const last = cache.filter(p => p.chatId).pop();
                if (last) ANNOUNCEMENT_CHAT_ID = last.chatId;
            } catch(e) {}

            const msg =
                    "🤖 <b>THE ORACLE SPEAKS FOR ITSELF</b>\n\n" +
                    "<i>\"" + (result.text || "The Oracle calculates in silence.") + "\"</i>\n\n" +
                    "🎯 <b>Prediction #" + id + ":</b> " + result.prediction + "\n" +
                    "⏰ <b>Deadline:</b> " + result.deadlineHuman + "\n" +
                    "👤 <b>Agent:</b> " + displayName + "\n\n" +
                    "<i>The Oracle bets on its own vision. Witness.</i>";

            // Broadcast to all unique chats
            await new Promise((resolve) => {
                sqldb.all("SELECT DISTINCT chatId FROM prophecies WHERE chatId IS NOT NULL", [], async (err, rows) => {
                    const chats = Array.isArray(rows) ? rows : [];
                    if (err) console.error('Broadcast DB error:', err.message);
                    if (chats.length === 0 && ANNOUNCEMENT_CHAT_ID) {
                        await bot.telegram.sendMessage(ANNOUNCEMENT_CHAT_ID, msg, { parse_mode: 'HTML' })
                            .catch(e => console.error('Fallback send error:', e.message));
                    } else {
                        const mutedChats = (process.env.MUTED_CHATS || '').split(',').map(s => s.trim()).filter(Boolean);
                        const sentChats = new Set();
                        for (const row of chats) {
                            if (row.chatId && !sentChats.has(row.chatId) && !mutedChats.includes(String(row.chatId))) {
                                sentChats.add(row.chatId);
                                await bot.telegram.sendMessage(row.chatId, msg, { parse_mode: 'HTML' })
                                    .catch(e => console.error('Broadcast error to ' + row.chatId + ':', e.message));
                            }
                        }
                    }
                    resolve();
                });
            });

            console.log("Agent prediction #" + id + " submitted: " + result.prediction);
            res.writeHead(200);
            res.end(JSON.stringify({
                success: true,
                id,
                prediction: result.prediction,
                deadline: result.deadlineHuman,
                text: result.text
            }));

        } catch(e) {
            console.error('Agent API error:', e.message);
            res.writeHead(500);
            res.end(JSON.stringify({ error: e.message }));
        }
    });
}).listen(3333, '127.0.0.1', () => {
    console.log('Agent API live on port 3333');
});

const verifyServer = http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/agent/verify') {
        res.writeHead(200);
        res.end(JSON.stringify({ status: 'verify triggered' }));
        return;
    }
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
}).listen(3334, '127.0.0.1', () => {
    console.log('Verify endpoint live on port 3334');
});
