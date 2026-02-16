let sqldb;
require('dotenv').config();
const { Telegraf } = require('telegraf');
const { ethers } = require('ethers');
const { validateClaim, generateProphecy, verifyWithWebSearch } = require('./prophecy');
const { verifyPayment, storeProphecyOnChain, finalizeProphecy, payoutWinner, wallet } = require('./blockchain');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN, { handlerTimeout: 300000 });
const userStates = new Map();
const dbPath = '/home/rayzelnoblesse5/monad-mystic/prophecies.db';
const cacheFile = 'prophecies_cache.json';

let ANNOUNCEMENT_CHAT_ID = null;
const processingProphecies = new Set();
const userCooldowns = new Map();
const PREDICT_COOLDOWN_MS = 60 * 1000;
const checkCooldowns = new Map();
const CHECK_COOLDOWN_MS = 30 * 1000;
const ADMIN_TELEGRAM_ID = parseInt(process.env.ADMIN_TELEGRAM_ID) || 0;

const MYSTIC_TOKEN_ADDRESS = "0x05463f12b2Ca7654D8cB89873eC0cB8b2BFA7777";
const TOKEN_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function totalSupply() external view returns (uint256)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)"
];
const mysticToken = new ethers.Contract(MYSTIC_TOKEN_ADDRESS, TOKEN_ABI, wallet);
const REWARD_POOL_ADDRESS = "0xece8b89d315aebad289fd7759c9446f948eca2f2";

async function isPremiumUser(userWallet) {
    try {
        const balance = await mysticToken.balanceOf(userWallet);
        return balance >= ethers.parseUnits("10000", 18);
    } catch(e) {
        console.error("Token balance check failed:", e.message);
        return false;
    }
}

function initDB() {
    sqldb = new sqlite3.Database(dbPath);
    sqldb.configure("busyTimeout", 30000);
    sqldb.run("PRAGMA journal_mode=WAL");
    sqldb.serialize(() => {
        sqldb.run("CREATE TABLE IF NOT EXISTS prophecies (id INTEGER PRIMARY KEY, userWallet TEXT, username TEXT, userId INTEGER, chatId INTEGER, prediction TEXT, deadline TEXT, deadlineHuman TEXT, text TEXT, verified INTEGER DEFAULT 0, verificationResult TEXT, rawVerification TEXT, payoutSent INTEGER DEFAULT 0, payoutMethod TEXT, payoutFailed INTEGER DEFAULT 0, isProcessing INTEGER DEFAULT 0, onChainId INTEGER, timestamp TEXT, paymentTx TEXT)");
    });
}
initDB();

const getDB = () => new Promise((resolve) => {
    try { if (!sqldb || !sqldb.open) initDB(); } catch(e) { resolve(getDBSync()); return; }
    sqldb.all("SELECT * FROM prophecies ORDER BY id ASC", [], (err, rows) => {
        if (err) { console.error('DB read error:', err.message); resolve(getDBSync()); return; }
        resolve(rows.map(row => ({
            ...row,
            verified: !!row.verified, payoutSent: !!row.payoutSent,
            isProcessing: !!row.isProcessing, payoutFailed: !!row.payoutFailed,
            verificationResult: (() => { try { return JSON.parse(row.verificationResult || '{}'); } catch(e) { return {}; } })(),
            rawVerification: (() => { try { return JSON.parse(row.rawVerification || '[]'); } catch(e) { return []; } })()
        })));
    });
});

const saveDB = (data) => new Promise((resolve) => {
    if (!sqldb || !sqldb.open) { try { initDB(); } catch(e) { resolve(); return; } }
    sqldb.serialize(() => {
        sqldb.run("BEGIN TRANSACTION");
        sqldb.run("DELETE FROM prophecies", [], (err) => {
            if (err) { sqldb.run("ROLLBACK"); console.error('DB clear error:', err.message); resolve(); return; }
            const stmt = sqldb.prepare("INSERT INTO prophecies (id, userWallet, username, userId, chatId, prediction, deadline, deadlineHuman, text, verified, verificationResult, rawVerification, payoutSent, payoutMethod, payoutFailed, isProcessing, onChainId, timestamp, paymentTx) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)");
            data.forEach(p => {
                stmt.run(p.id, p.userWallet, p.username, p.userId, p.chatId, p.prediction, p.deadline, p.deadlineHuman, p.text, p.verified ? 1 : 0, JSON.stringify(p.verificationResult || {}), JSON.stringify(p.rawVerification || []), p.payoutSent ? 1 : 0, p.payoutMethod, p.payoutFailed ? 1 : 0, p.isProcessing ? 1 : 0, p.onChainId, p.timestamp, p.paymentTx);
            });
            stmt.finalize();
            sqldb.run("COMMIT", (err) => {
                if (err) console.error('DB commit error:', err.message);
                for (let i = 2; i >= 0; i--) {
                    const oldB = dbPath + ".backup" + i;
                    const newB = dbPath + ".backup" + (i+1);
                    if (fs.existsSync(oldB)) fs.renameSync(oldB, newB);
                }
                try { fs.copyFileSync(dbPath, dbPath + ".backup0"); } catch(e) {}
                try { fs.writeFileSync(cacheFile, JSON.stringify(data)); } catch(e) {}
                resolve();
            });
        });
    });
});

function getDBSync() {
    try { return JSON.parse(fs.readFileSync(cacheFile, 'utf8') || '[]'); } catch(e) { return []; }
}

function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

function escapeMD(str) {
    if (!str) return '';
    return str.replace(/[_*`[]/g, '\\$&');
}

function setAnnouncementChat(ctx) {
    if (ctx.chat.type === 'group' || ctx.chat.type === 'supergroup') {
        if (!ANNOUNCEMENT_CHAT_ID) {
            ANNOUNCEMENT_CHAT_ID = ctx.chat.id;
            console.log("Announcement chat set to GROUP: " + ANNOUNCEMENT_CHAT_ID);
        }
    } else if (!ANNOUNCEMENT_CHAT_ID) {
        ANNOUNCEMENT_CHAT_ID = ctx.chat.id;
        console.log("Announcement chat set to PRIVATE fallback: " + ANNOUNCEMENT_CHAT_ID);
    }
}

async function buildLeaderboard() {
    const db = await getDB();
    const stats = {};
    for (const p of db) {
        const key = p.username || (p.userWallet ? p.userWallet.slice(0, 8) : 'Unknown');
        if (!stats[key]) stats[key] = { name: key, total: 0, correct: 0, pending: 0 };
        stats[key].total++;
        const vr = p.verificationResult || {};
        if (p.verified && vr.isCorrect) stats[key].correct++;
        if (!p.verified) stats[key].pending++;
    }
    return Object.values(stats).sort((a, b) => b.correct - a.correct || b.total - a.total).slice(0, 10);
}

function buildShareUrl(prediction, deadlineHuman, roast) {
    const cleanPred = prediction.replace(/\(.*?\)/g,'').replace(/[^\w\s.$]/g,'').trim();
    const intro = "predicting this on @MonadMysticBot \u{1F52E}\n\n\"" + cleanPred + "\"\nby " + deadlineHuman + "\n\nthe AI's response: \"";
    const footer = "\"\n\ni'll get paid in MON if it hits.\n\ntry it on telegram: @MonadMysticBot";
    const availableSpace = 280 - intro.length - footer.length - 10;
    const cleanRoast = roast && roast.length > availableSpace ? roast.substring(0, availableSpace).trim() + "..." : roast || "the spirits have spoken";
    return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(intro + cleanRoast + footer);
}

async function runVerificationCycle(currentChatId, silent) {
    if (silent === undefined) silent = false;
    console.log("Running verification cycle...");
    const db = await getDB();
    const now = new Date();
    let verified = 0, pending = 0;

    for (const p of db) {
        if (p.verified) continue;
        const deadline = new Date(p.deadline);
        if (now < deadline) { pending++; continue; }
        if (processingProphecies.has(p.id)) continue;

        processingProphecies.add(p.id);
        p.isProcessing = true;
        await saveDB(db);

        try {
            const isClawPrediction = p.username === 'ClawMysticBot' || (p.userWallet && p.userWallet.toLowerCase() === '0xece8b89d315aebad289fd7759c9446f948eca2f2');
            let finalResult;

            if (isClawPrediction) {
                // For Claw predictions: use CryptoCompare directly, no Gemini comment
                const tickerMatch = p.prediction.match(/\(([A-Z]+)\)/);
                const ticker = tickerMatch ? tickerMatch[1] : null;
                const targetMatch = p.prediction.match(/\$([\d.e+-]+)/i);
                const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : null;
                let currentPrice = null;
                if (ticker) {
                    currentPrice = await new Promise((resolve) => {
                        const https = require('https');
                        https.get(`https://min-api.cryptocompare.com/data/price?fsym=${ticker}&tsyms=USD`, (res) => {
                            let d = ''; res.on('data', x => d += x);
                            res.on('end', () => { try { resolve(JSON.parse(d).USD || null); } catch(e) { resolve(null); } });
                        }).on('error', () => resolve(null));
                    });
                }
                const isCorrect = currentPrice !== null && targetPrice !== null && currentPrice >= targetPrice;
                const diff = currentPrice && targetPrice ? (((currentPrice - targetPrice) / targetPrice) * 100).toFixed(2) : '?';
                finalResult = {
                    isCorrect,
                    explanation: currentPrice ? `Current price: $${currentPrice}. Target was: $${targetPrice}. Difference: ${diff}%.` : 'Could not fetch price.',
                    rawResponse: JSON.stringify({ currentPrice, targetPrice, isCorrect })
                };
                // Save to Claw memory
                const memoryLine = `${isCorrect ? 'WIN' : 'LOSS'} | ${p.prediction} | deadline: ${p.deadlineHuman} | ${ticker}: $${currentPrice} vs target $${targetPrice}\n`;
                fs.appendFileSync('/home/rayzelnoblesse5/monad-mystic/claw_memory.md', memoryLine);
            } else {
                // For human predictions: use Gemini with CryptoCompare price
                const result1 = await verifyWithWebSearch(p.prediction, p.deadlineHuman);
                await new Promise(r => setTimeout(r, 3000));
                const result2 = await verifyWithWebSearch(p.prediction, p.deadlineHuman);
                const consensusCorrect = (result1.isCorrect === result2.isCorrect) ? result1.isCorrect : false;
                finalResult = { ...result1, isCorrect: consensusCorrect };
            }

            p.verified = true;
            p.verificationResult = finalResult;
            p.rawVerification = [finalResult.rawResponse];
            verified++;
            if (!p.onChainId) { try { await finalizeProphecy(p.id, finalResult.isCorrect); } catch(e) { console.error("finalize failed:", e.message); } }

            let paidMsg = "";
            if (finalResult.isCorrect && p.userWallet && !p.payoutSent) {
                const payoutAmount = p.isMysticFree ? "0.07" : "0.04";
                const payoutResult = await payoutWinner(p.userWallet, payoutAmount);
                p.payoutMethod = payoutResult.method;
                p.payoutSent = payoutResult.success;
                paidMsg = payoutResult.success ? "\n\n\uD83D\uDCB8 *" + payoutAmount + " MON sent to " + p.userWallet.slice(0,10) + "...*" : "\n\n\u26A0\uFE0F Payout failed - logged for review";
                if (!payoutResult.success) p.payoutFailed = true;
            }

            // Broadcast verification to all chats
            const verifyMsg =
                    (finalResult.isCorrect ? "\uD83C\uDF89" : "\uD83D\uDE02") + " *PROPHECY #" + p.id + " " + (finalResult.isCorrect ? "FULFILLED" : "FAILED") + "!*\n\n" +
                    "\uD83D\uDC64 *Prophet:* " + escapeMD(p.username || "Unknown Prophet") + "\n" +
                    "\uD83D\uDCDC *Prediction:* _\"" + escapeMD(p.prediction) + "\"_\n" +
                    "\uD83D\uDCC5 *Deadline was:* " + escapeMD(p.deadlineHuman) + "\n\n" +
                    (finalResult.isCorrect ? "\u2705 THE ORACLE BOWS TO YOUR WISDOM!" : "\u274C WRONG! The Oracle cackles into the void!") + "\n" +
                    "_\"" + escapeMD(finalResult.explanation) + "\"_" + paidMsg + "\n\n\uD83C\uDFC6 /leaderboard";
            const allChats = new Set([p.chatId, currentChatId, ANNOUNCEMENT_CHAT_ID].filter(Boolean));
            for (const chatId of allChats) {
                bot.telegram.sendMessage(chatId, verifyMsg, { parse_mode: 'Markdown' }).catch(e => console.error('Verify broadcast error:', chatId, e.message));
            }
        } catch(e) {
            console.error("Error verifying #" + p.id + ":", e.message);
        } finally {
            processingProphecies.delete(p.id);
            p.isProcessing = false;
            await saveDB(db);
        }
    }

    if (!silent && currentChatId) {
        if (verified === 0 && pending === 0) {
            bot.telegram.sendMessage(currentChatId, "\uD83D\uDD2E *The Oracle gazes into the void...*\n\nNo prophecies exist yet, mortal. The blockchain awaits your vision.\n\nUse /predict to seal your fate! *hic*", { parse_mode: 'Markdown' });
        } else if (verified === 0 && pending > 0) {
            bot.telegram.sendMessage(currentChatId, "\u23F3 *The spirits are patient...*\n\n" + pending + " prophecy" + (pending > 1 ? "ies are" : " is") + " still ripening.\nThe Oracle will verify automatically when their time comes.\n\n_Check /leaderboard to see standings_", { parse_mode: 'Markdown' });
        }
    }
    if (verified > 0) console.log("Verified " + verified + " prophecies");
}

async function checkProphecyById(id, ctx) {
    const chatId = ctx.chat.id;
    const userId = ctx.from.id;
    const lastCheck = checkCooldowns.get(userId);
    if (lastCheck && Date.now() - lastCheck < CHECK_COOLDOWN_MS) {
        return bot.telegram.sendMessage(chatId, "\u23F3 The Oracle is busy. Check again in a moment. *hic*");
    }
    checkCooldowns.set(userId, Date.now());

    const db = await getDB();
    const p = db.find(x => x.id === id);
    if (!p) return bot.telegram.sendMessage(chatId, "\uD83D\uDD2E *The Oracle searches the archives...*\n\nNo prophecy #" + id + " exists. Check your number, mortal.", { parse_mode: 'Markdown' });

    const now = new Date();
    const deadline = new Date(p.deadline);
    const name = p.username || "Unknown Prophet";

    if (p.verified) {
        const isWin = p.verificationResult && p.verificationResult.isCorrect;
        return bot.telegram.sendMessage(chatId,
            "\uD83D\uDCDC *PROPHECY #" + id + " - " + (isWin ? "\u2705 FULFILLED" : "\u274C FAILED") + "*\n\n" +
            "\uD83D\uDC64 Prophet: " + escapeMD(name) + "\n" +
            "\uD83C\uDFAF Prediction: _\"" + escapeMD(p.prediction) + "\"_\n" +
            "\uD83D\uDCC5 Deadline: " + escapeMD(p.deadlineHuman) + "\n\n" +
            "\uD83E\uDD16 Verdict: _\"" + escapeMD((p.verificationResult && p.verificationResult.explanation) || 'No explanation') + "\"_",
            { parse_mode: 'Markdown' }
        );
    }

    if (now < deadline) {
        const diffMs = deadline - now;
        const hoursLeft = Math.floor(diffMs / 3600000);
        const minsLeft = Math.floor((diffMs % 3600000) / 60000);
        const timeStr = hoursLeft > 0 ? hoursLeft + "h " + minsLeft + "m" : minsLeft + "m";
        return bot.telegram.sendMessage(chatId,
            "\u23F3 *PROPHECY #" + id + " - PENDING*\n\n" +
            "\uD83D\uDC64 Prophet: " + escapeMD(name) + "\n" +
            "\uD83C\uDFAF Prediction: _\"" + escapeMD(p.prediction) + "\"_\n" +
            "\uD83D\uDCC5 Deadline: " + escapeMD(p.deadlineHuman) + "\n" +
            "\u23F0 ~" + timeStr + " remaining\n\n" +
            "_The Oracle watches... and waits..._",
            { parse_mode: 'Markdown' }
        );
    }

    bot.telegram.sendMessage(chatId, "\uD83D\uDD0D *Prophecy #" + id + " has expired! Checking the timeline...*", { parse_mode: 'Markdown' });
    if (processingProphecies.has(id) || p.isProcessing) {
        return bot.telegram.sendMessage(chatId, "\u23F3 Prophecy #" + id + " is already being verified. Check back in a moment!");
    }

    processingProphecies.add(id);
    p.isProcessing = true;
    await saveDB(db);

    try {
        const result1 = await verifyWithWebSearch(p.prediction, p.deadlineHuman);
        await new Promise(r => setTimeout(r, 3000));
        const result2 = await verifyWithWebSearch(p.prediction, p.deadlineHuman);
        const consensusCorrect = (result1.isCorrect === result2.isCorrect) ? result1.isCorrect : false;
        const finalResult = { ...result1, isCorrect: consensusCorrect };

        p.verified = true;
        p.verificationResult = finalResult;
        p.rawVerification = [result1.rawResponse, result2.rawResponse];
        if (!p.onChainId) { try { await finalizeProphecy(p.id, finalResult.isCorrect); } catch(e) { console.error("finalize failed:", e.message); } }

        let paidMsg = "";
        if (finalResult.isCorrect && p.userWallet && !p.payoutSent) {
            const payoutAmount = p.isMysticFree ? "0.07" : "0.04";
                const payoutResult = await payoutWinner(p.userWallet, payoutAmount);
            p.payoutMethod = payoutResult.method;
            p.payoutSent = payoutResult.success;
            paidMsg = payoutResult.success ? "\n\n\uD83D\uDCB8 *" + payoutAmount + " MON sent!*" : "\n\n\u26A0\uFE0F Payout failed";
            if (!payoutResult.success) p.payoutFailed = true;
        }
        await saveDB(db);

        bot.telegram.sendMessage(chatId,
            (finalResult.isCorrect ? "\uD83C\uDF89" : "\uD83D\uDE02") + " *PROPHECY #" + id + " " + (finalResult.isCorrect ? "FULFILLED" : "FAILED") + "!*\n\n" +
            "\uD83D\uDC64 Prophet: " + escapeMD(name) + "\n" +
            "\uD83C\uDFAF _\"" + escapeMD(p.prediction) + "\"_\n\n" +
            (finalResult.isCorrect ? "\u2705 CORRECT!" : "\u274C WRONG!") + "\n" +
            "_\"" + escapeMD(finalResult.explanation) + "\"_" + paidMsg,
            { parse_mode: 'Markdown' }
        );
    } catch(e) {
        bot.telegram.sendMessage(chatId, "\u26A0\uFE0F Verification error for #" + id + ": " + e.message);
    } finally {
        processingProphecies.delete(id);
        p.isProcessing = false;
        await saveDB(db);
    }
}

bot.start((ctx) => {
    setAnnouncementChat(ctx);
    ctx.reply(
        "\uD83D\uDD2E *Monad Mystic* - AI Oracle on Monad\n\n" +
        "Pay 0.01 MON. Make a crypto prediction. Get roasted or rewarded.\n\n" +
        "\u2705 Correct prediction \u2192 Win 0.04 MON\n" +
        "\u274C Wrong \u2192 The Oracle laughs at you publicly\n\n" +
        "\u26A1 *Why Monad?*\n10,000 TPS = instant prophecy sealing\n~0.001 MON gas = nearly free on-chain storage\n\n" +
        "/predict - Make a prophecy\n/leaderboard - Top prophets\n/check - Verify expired prophecies\n/check 5 - Check prophecy #5\n\n" +
        "_AI auto-verifies every 5 minutes using web search_",
        { parse_mode: 'Markdown' }
    );
});

bot.command('predict', (ctx) => {
    setAnnouncementChat(ctx);
    const lastUsed = userCooldowns.get(ctx.from.id);
    if (lastUsed && Date.now() - lastUsed < PREDICT_COOLDOWN_MS) {
        const secsLeft = Math.ceil((PREDICT_COOLDOWN_MS - (Date.now() - lastUsed)) / 1000);
        return ctx.reply("\u23F3 The Oracle is still recovering. Try again in " + secsLeft + "s. *hic*");
    }
    userCooldowns.set(ctx.from.id, Date.now());
    userStates.set(ctx.from.id, { step: 'PREDICTING', chatId: ctx.chat.id, ts: Date.now() });
    ctx.reply("\uD83D\uDCDC State your prophecy (e.g., 'Monad to $0.05 by Feb 15')...\n\n*Minimum timeframe: 6 hours*", { parse_mode: 'Markdown' });
});

bot.command('leaderboard', async (ctx) => {
    setAnnouncementChat(ctx);
    const board = await buildLeaderboard();
    const allRows = await getDB();
    if (board.length === 0) return ctx.reply("\uD83D\uDCED No prophecies yet. Be the first with /predict!");
    const medals = ['\uD83E\uDD47','\uD83E\uDD48','\uD83E\uDD49','4\uFE0F\u20E3','5\uFE0F\u20E3','6\uFE0F\u20E3','7\uFE0F\u20E3','8\uFE0F\u20E3','9\uFE0F\u20E3','\uD83D\uDD1F'];
    let msg = "\uD83C\uDFC6 *PROPHET LEADERBOARD*\n_Total prophecies sealed: " + allRows.length + "_\n\n";
    board.forEach((p, i) => {
        const accuracy = p.total > 0 ? Math.round((p.correct / p.total) * 100) : 0;
        const pendingStr = p.pending > 0 ? " _(" + p.pending + " pending)_" : '';
        msg += medals[i] + " *" + escapeMD(p.name) + "*\n   \u2705 " + p.correct + "/" + p.total + " - " + accuracy + "% accuracy" + pendingStr + "\n\n";
    });
    msg += "_Climb the ranks with /predict_";
    ctx.reply(msg, { parse_mode: 'Markdown' });
});

bot.command('check', async (ctx) => {
    setAnnouncementChat(ctx);
    const args = ctx.message.text.split(' ');
    if (args.length >= 2 && !isNaN(parseInt(args[1]))) {
        await checkProphecyById(parseInt(args[1]), ctx);
    } else {
        ctx.reply("\uD83D\uDD0D *The Oracle scans the timelines...*", { parse_mode: 'Markdown' });
        await runVerificationCycle(ctx.chat.id, false);
    }
});

bot.command('adminpayout', async (ctx) => {
    if (!ADMIN_TELEGRAM_ID || ctx.from.id !== ADMIN_TELEGRAM_ID) return ctx.reply("\u26D4 Only the Oracle's chosen admin. *hic*");
    const args = ctx.message.text.split(' ');
    if (args.length < 3 || isNaN(parseInt(args[1]))) return ctx.reply("Usage: /adminpayout <id> <true/false>");
    const id = parseInt(args[1]);
    const isCorrect = args[2].toLowerCase() === 'true';
    const db = await getDB();
    const p = db.find(x => x.id === id);
    if (!p) return ctx.reply("Prophecy #" + id + " not found.");
    if (p.verified) return ctx.reply("Prophecy #" + id + " already verified.");
    p.verified = true;
    p.verificationResult = { isCorrect: isCorrect, explanation: "Manual admin override." };
    p.payoutMethod = 'admin';
    await saveDB(db);
    await finalizeProphecy(id, isCorrect);
    if (isCorrect && p.userWallet && !p.payoutSent) {
        const payoutAmount = p.isMysticFree ? "0.07" : "0.04";
                const payoutResult = await payoutWinner(p.userWallet, payoutAmount);
        p.payoutSent = payoutResult.success;
        p.payoutMethod = 'admin-' + payoutResult.method;
        await saveDB(db);
    }
    const targetChat = p.chatId || ANNOUNCEMENT_CHAT_ID;
    if (targetChat) bot.telegram.sendMessage(targetChat, "\uD83D\uDEE0\uFE0F *ADMIN OVERRIDE*\nProphecy #" + id + " manually marked " + (isCorrect ? "CORRECT \u2705" : "INCORRECT \u274C") + " and processed. *hic*", { parse_mode: 'Markdown' });
    ctx.reply("\u2705 Manual override processed for #" + id + ".");
});

bot.command('vote', async (ctx) => {
    const args = ctx.message.text.split(' ').slice(1).join(' ');
    if (!args) return ctx.reply("Usage: /vote <yes/no/abstain> <proposal>");
    ctx.reply("\u2705 Vote recorded! Wallet-based $MYSTIC voting weight coming soon.");
});

bot.on('text', async (ctx) => {
    setAnnouncementChat(ctx);
    const userId = ctx.from.id;
    const state = userStates.get(userId);
    if (!state) return;
    if (Date.now() - state.ts > 5 * 60 * 1000) { userStates.delete(userId); return; }
    if (state.chatId && state.chatId !== ctx.chat.id) return;
    if (state.step === 'PREDICTING') {
        const val = validateClaim(ctx.message.text);
        if (!val.valid) { userStates.delete(userId); return ctx.reply(val.reason, { parse_mode: 'Markdown' }); }
        state.claim = ctx.message.text;
        state.step = 'PAYMENT_CHOICE';
        return ctx.reply(
            "💰 *HOW DO YOU WANT TO PAY?*\n\n💎 Hold 10,000+ [$MYSTIC](https://nad.fun/tokens/0x05463f12b2Ca7654D8cB89873eC0cB8b2BFA7777) → FREE prediction + 0.07 MON if correct\n💳 No $MYSTIC → Pay 0.01 MON\n\nReply *1* to check $MYSTIC balance\nReply *2* to pay directly",
            { parse_mode: 'Markdown' }
        );
    }
    if (state.step === 'PAYMENT_CHOICE') {
        const choice = ctx.message.text.trim();
        if (choice === '1') {
            state.step = 'WALLET_CHECK';
            return ctx.reply("\uD83D\uDD2E Paste your Monad wallet address to verify your $MYSTIC balance:");
        } else if (choice === '2') {
            state.step = 'PAYING';
            return ctx.replyWithMarkdown(
                "\uD83D\uDEF0\uFE0F *SACRIFICE REQUIRED*\n\nSend exactly `0.01 MON` to:\n`" + process.env.CONTRACT_ADDRESS + "`\n\nThen paste your transaction hash here:\n\n\u26A0\uFE0F _Transaction must be within the last 30 minutes_"
            );
        } else {
            return ctx.reply("\u274C Reply *1* for $MYSTIC check or *2* to pay directly.", { parse_mode: 'Markdown' });
        }
    }
    if (state.step === 'WALLET_CHECK') {
        const walletAddr = ctx.message.text.trim();
        if (!/^0x[a-fA-F0-9]{40}$/.test(walletAddr)) {
            userStates.delete(userId);
            return ctx.reply("\u274C Invalid wallet address. Start over with /predict.");
        }
        state.checkedWallet = walletAddr;
        const isPremium = await isPremiumUser(walletAddr);
        if (isPremium) {
            state.isFree = true;
            ctx.reply("\uD83D\uDC8E *$MYSTIC HOLDER DETECTED!*\n\nYou hold 10,000+ $MYSTIC — your prophecy is FREE!\n\n\u2728 Summoning the spirits for free...", { parse_mode: 'Markdown' });
            const db = await getDB();
            const id = db.length > 0 ? Math.max(...db.map(p => p.id)) + 1 : 0;
            const fallbackDeadline = new Date(Date.now() + 24 * 3600000);
            const username = ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name;
            const newProphecy = {
                id, userWallet: walletAddr, username, userId, chatId: ctx.chat.id,
                prediction: state.claim, deadline: fallbackDeadline.toISOString(),
                deadlineHuman: fallbackDeadline.toLocaleString('en-US', { month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true }),
                text: 'Generating...', verified: false, verificationResult: {}, rawVerification: [],
                timestamp: new Date().toISOString(), paymentTx: 'mystic-free',
                payoutSent: false, isProcessing: false, payoutFailed: false, payoutMethod: null, onChainId: null, isMysticFree: true
            };
            db.push(newProphecy);
            await saveDB(db);
            let result;
            try {
                result = await generateProphecy(state.claim);
                newProphecy.prediction = result.prediction;
                newProphecy.deadline = result.deadline;
                newProphecy.deadlineHuman = result.deadlineHuman;
                newProphecy.text = result.text;
                await saveDB(db);
            } catch(e) {
                result = Object.assign({}, newProphecy, { text: "The spirits bow to $MYSTIC royalty... *hic*" });
            }
            const shareUrl = buildShareUrl(result.prediction, result.deadlineHuman, result.text);
            const caption = "\uD83D\uDC8E <b>FREE PROPHECY SEALED (#" + id + ") \u2014 $MYSTIC HOLDER</b>\n\n<i>\"" + escapeHTML(result.text) + "\"</i>\n\n\uD83C\uDFAF <b>Prediction:</b> " + escapeHTML(result.prediction) + "\n\u23F0 <b>Deadline:</b> " + escapeHTML(result.deadlineHuman) + "\n\n<a href=\"" + shareUrl + "\">\uD83D\uDC26 Share on X</a>\n\n<i>Use /check " + id + " anytime</i>";
            await ctx.reply(caption, { parse_mode: 'HTML', disable_web_page_preview: true });
            userStates.delete(userId);
            return;
        }
        state.step = 'PAYING';
        return ctx.replyWithMarkdown(
            "\uD83D\uDEF0\uFE0F *SACRIFICE REQUIRED*\n\nYou need 10,000 $MYSTIC for free predictions.\n\nSend exactly `0.01 MON` to:\n`" + process.env.CONTRACT_ADDRESS + "`\n\nThen paste your transaction hash here:\n\n\u26A0\uFE0F _Transaction must be within the last 30 minutes_"
        );
    }

    if (state.step === 'PAYING') {
        const txHash = ctx.message.text.trim();
        if (!/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
            userStates.delete(userId);
            return ctx.reply("\u274C *REJECTED!* Invalid TX hash format. Must be `0x` + 64 hex characters.", { parse_mode: 'Markdown' });
        }

        ctx.reply("\uD83C\uDF00 Verifying your sacrifice on the Monad chain... *hic*");
        let payResult;
        try { payResult = await verifyPayment(txHash); } catch(e) { userStates.delete(userId); return ctx.reply('❌ *NETWORK ERROR!* Monad RPC timed out. Please try again in 30 seconds.', { parse_mode: 'Markdown' }); }

        if (!payResult.valid) {
            userStates.delete(userId);
            const reasons = {
                'ALREADY_USED': "\u274C *REJECTED!* TX hash already used. Nice try, mortal. *hic*",
                'TOO_OLD': "\u274C *REJECTED!* Transaction too old. Must be within last 30 minutes!",
                'WRONG_DESTINATION': "\u274C *REJECTED!* TX not sent to vault address.",
                'WRONG_AMOUNT': "\u274C *REJECTED!* Must send exactly 0.01 MON.",
                'NOT_FOUND': "\u274C *REJECTED!* Transaction not found on Monad.",
                'UNCONFIRMED': "\u274C *REJECTED!* TX not confirmed. Wait 10 seconds and retry.",
                'ERROR': "\u274C *ERROR!* Could not verify. Try again."
            };
            return ctx.reply(reasons[payResult.reason] || "\u274C *SACRIFICE REJECTED!* Try again.", { parse_mode: 'Markdown' });
        }

        const userWallet = payResult.from;
        const username = ctx.from.username ? "@" + ctx.from.username : ctx.from.first_name;

        const isPremium = await isPremiumUser(userWallet);
        if (isPremium) ctx.reply("\uD83D\uDD2E Premium prophet detected! $MYSTIC holders get priority. *hic*");

        //distributeFeeShare(ethers.parseEther("0.01")).catch(e => console.error("Fee share error:", e.message));

        ctx.reply("\u2728 Sacrifice accepted! Summoning the spirits...");

        const db = await getDB();
        const id = db.length > 0 ? Math.max(...db.map(p => p.id)) + 1 : 0;
        const fallbackDeadline = new Date(Date.now() + 24 * 3600000);

        const newProphecy = {
            id: id, userWallet: userWallet, username: username, userId: userId,
            chatId: ctx.chat.id,
            prediction: state.claim,
            deadline: fallbackDeadline.toISOString(),
            deadlineHuman: fallbackDeadline.toLocaleString('en-US', { month:'long', day:'numeric', year:'numeric', hour:'numeric', minute:'2-digit', hour12:true }),
            text: 'Generating...',
            verified: false, verificationResult: {}, rawVerification: [],
            timestamp: new Date().toISOString(), paymentTx: txHash,
            payoutSent: false, isProcessing: false, payoutFailed: false, payoutMethod: null, onChainId: null
        };
        db.push(newProphecy);
        await saveDB(db);

        try {
            const onChainResult = await storeProphecyOnChain(newProphecy, userWallet);
            if (onChainResult && onChainResult.onChainId) {
                newProphecy.onChainId = onChainResult.onChainId;
                await saveDB(db);
            }
        } catch(e) { console.error("On-chain store failed for #" + id + ":", e.message); }

        let result;
        try {
            result = await generateProphecy(state.claim);
            newProphecy.prediction = result.prediction;
            newProphecy.deadline = result.deadline;
            newProphecy.deadlineHuman = result.deadlineHuman;
            newProphecy.text = result.text;
            await saveDB(db);
        } catch(e) {
            console.error('Prophecy generation failed:', e.message);
            result = Object.assign({}, newProphecy, { text: "The spirits are troubled... your sacrifice is recorded, mortal." });
        }

        const explorerUrl = "https://monadvision.com/tx/" + txHash;
        const shareUrl = buildShareUrl(result.prediction, result.deadlineHuman, result.text);

        const caption =
            "\u2705 <b>PROPHECY SEALED (#" + id + ")</b>\n\n" +
            "<i>\"" + escapeHTML(result.text) + "\"</i>\n\n" +
            "\uD83C\uDFAF <b>Prediction:</b> " + escapeHTML(result.prediction) + "\n" +
            "\u23F0 <b>Deadline:</b> " + escapeHTML(result.deadlineHuman) + "\n\n" +
            "<a href=\"" + explorerUrl + "\">\uD83D\uDD17 View on Monad</a>  \u00B7  <a href=\"" + shareUrl + "\">\uD83D\uDC26 Share on X</a>\n\n" +
            "<i>Use /check " + id + " anytime to see status</i>";

        await ctx.reply(caption, { parse_mode: 'HTML', disable_web_page_preview: true });
        userStates.delete(userId);
    }
});

const startupCleanup = async () => {
    const db = await getDB();
    let cleaned = false;
    for (const p of db) {
        if (p.isProcessing) {
            p.isProcessing = false; cleaned = true;
            console.log("Cleaned stale flag for #" + p.id);
        }
    }
    if (cleaned) await saveDB(db);
};

bot.launch({ dropPendingUpdates: true }).then(async () => {
    console.log("\uD83D\uDE80 Monad Mystic ONLINE");
    console.log("\u23F0 Auto-verification every 5 minutes");
    await startupCleanup();
});

process.once('SIGINT', () => { bot.stop('SIGINT'); });
process.once('SIGTERM', () => { bot.stop('SIGTERM'); });

setInterval(async () => {
    if (ANNOUNCEMENT_CHAT_ID) {
        const db = await getDB();
        const now = new Date();
        const hasExpired = db.some(p => !p.verified && !p.isProcessing && !processingProphecies.has(p.id) && new Date(p.deadline) <= now);
        if (hasExpired) await runVerificationCycle(ANNOUNCEMENT_CHAT_ID, true);
    }
}, 5 * 60 * 1000);

console.log("\uD83E\uDDE0 Claw AI agent activated - I now own Monad Mystic *hic*");

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception:', err.message);
});
