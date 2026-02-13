require('dotenv').config();
const http = require('http');
const { validateClaim, generateProphecy } = require('./bot/prophecy');
const { Telegraf } = require('telegraf');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
const AGENT_API_SECRET = process.env.AGENT_API_SECRET || 'monad-oracle-agent-2026';
const dbPath = 'prophecies.db';
const cacheFile = 'prophecies_cache.json';

// Use separate DB connection with busy timeout to avoid SQLITE_BUSY crashes
const sqldb = new sqlite3.Database(dbPath, (err) => {
    if (err) console.error('Agent API DB error:', err.message);
});
sqldb.run("PRAGMA journal_mode=WAL");  // WAL mode allows concurrent reads
sqldb.configure('busyTimeout', 5000);  // Wait up to 5s if locked

function escapeMD(str) {
    if (!str) return '';
    return str.replace(/[_*`\[\]()~`>#+\-=\|\{\}\.!]/g, '\\$&');
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
        sqldb.run("DELETE FROM prophecies", [], (err) => {
            if (err) { sqldb.run("ROLLBACK"); console.error('Agent DB clear error:', err.message); resolve(); return; }
            const stmt = sqldb.prepare("INSERT INTO prophecies (id, userWallet, username, userId, chatId, prediction, deadline, deadlineHuman, text, verified, verificationResult, rawVerification, payoutSent, payoutMethod, payoutFailed, isProcessing, onChainId, timestamp, paymentTx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
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
                try { fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch(e) {}
                resolve();
            });
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

    if (req.method !== 'POST' || (req.url !== '/agent/predict' && req.url !== '/predict')) {
        res.writeHead(404); res.end(JSON.stringify({ error: 'Not found' })); return;
    }

    let body = '';
    req.on('data', d => body += d);
    req.on('end', async () => {
        try {
            const { secret, claim, walletAddress, agentName } = JSON.parse(body);

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

            const val = validateClaim(claim);
            if (!val.valid) {
                res.writeHead(400);
                res.end(JSON.stringify({ error: val.reason }));
                return;
            }

            const result = await generateProphecy(claim);
            const db = await getDB();
            const id = db.length > 0 ? Math.max(...db.map(p => p.id)) + 1 : 0;
            const displayName = agentName || '@MonadMysticAgent';

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

            if (ANNOUNCEMENT_CHAT_ID) {
                const msg =
                    "\uD83E\uDD16 *THE ORACLE SPEAKS FOR ITSELF*\n\n" +
                    "_\"" + escapeMD(result.text) + "\"_\n\n" +
                    "\uD83C\uDFAF *Prediction #" + id + ":* " + escapeMD(result.prediction) + "\n" +
                    "\u23F0 *Deadline:* " + escapeMD(result.deadlineHuman) + "\n" +
                    "\uD83D\uDC64 *Agent:* " + escapeMD(displayName) + "\n\n" +
                    "_The Oracle bets on its own vision\\. Witness\\._";

                await bot.telegram.sendMessage(ANNOUNCEMENT_CHAT_ID, msg, { parse_mode: 'MarkdownV2' })
                    .catch(e => console.error('Telegram send error:', e.message));
            }

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
