const { GoogleGenerativeAI } = require("@google/generative-ai");
require('dotenv').config({ path: '/home/rayzelnoblesse5/monad-mystic/.env' });
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
function sanitizeClaim(userClaim) {
// SECURITY: Remove prompt injection attempts
return userClaim
.replace(/ignore\s+(previous|all|above)\s+instructions?/gi, '')
.replace(/system\s*:/gi, '')
.replace(/assistant\s*:/gi, '')
.replace(/you\s+are\s+now/gi, '')
.replace(/pretend\s+(you|to)/gi, '')
.replace(/forget\s+(everything|all|previous)/gi, '')
.slice(0, 100);
}
function validateClaim(userClaim) {
const claim = userClaim.toLowerCase();

if (/\b\d+\s*(min|minute|minutes|mins)\b/.test(claim)) {
    return { valid: false, reason: "🛑 *REJECTED:* Minutes? The Oracle doesn't squint at milliseconds. 6 hours minimum! *hic*" };
}
if (/\b[1-5]\s*(hour|hours|hr|hrs)\b/.test(claim)) {
    return { valid: false, reason: "🛑 *REJECTED:* Too fast even for a drunk oracle. 6 hours minimum! *hic*" };
}
if (/\b(today|tonight|now|immediately|instant)\b/.test(claim)) {
    return { valid: false, reason: "🛑 *REJECTED:* Too vague, mortal. Give me a real deadline — at least 6 hours from now!" };
}
if (!/\d/.test(claim) && !/\b(btc|eth|sol|mon|monad|bitcoin|ethereum|solana|crypto)\b/.test(claim)) {
    return { valid: false, reason: "🛑 *REJECTED:* The spirits need numbers and assets! Example: 'BTC to $70k by Feb 15'" };
}

return { valid: true };
}
async function generateProphecy(userClaim) {
try {
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const now = new Date();
    const nowISO = now.toISOString();
    const minDeadline = new Date(now.getTime() + 6 * 3600000).toISOString();

    // Fetch live price from CoinGecko for context
    let livePrice = null;
    let priceContext = "";
    try {
        // Try to extract ticker from parentheses first e.g. "MON" from "(MON)"
        const parenMatch = userClaim.match(/\(([A-Za-z]{2,10})\)/);
        const wordMatch = userClaim.match(/\b([A-Za-z]{2,10})\b/);
        const rawTicker = parenMatch ? parenMatch[1].toLowerCase() : (wordMatch ? wordMatch[1].toLowerCase() : null);
        const nameMap = {
            'monad':'mon','bitcoin':'btc','ether':'eth','ethereum':'eth','solana':'sol',
            'dogecoin':'doge','ripple':'xrp','cardano':'ada','shibainu':'shib','shiba':'shib',
            'avalanche':'avax','polkadot':'dot','chainlink':'link','uniswap':'uni',
            'cosmos':'atom','aptos':'apt','optimism':'op','arbitrum':'arb',
            'injective':'inj','celestia':'tia','binance':'bnb','tron':'trx',
            'litecoin':'ltc','stellar':'xlm','monero':'xmr','filecoin':'fil',
            'hedera':'hbar','fantom':'ftm','kaspa':'kas','render':'rndr',
            'multiversx':'egld','elrond':'egld'
        };
        const ticker = nameMap[rawTicker] || rawTicker;
        if (ticker) {
            const https = require('https');
            const knownIds = {
                btc:'bitcoin', eth:'ethereum', sol:'solana', bnb:'binancecoin',
                xrp:'ripple', doge:'dogecoin', ada:'cardano', avax:'avalanche-2',
                dot:'polkadot', matic:'matic-network', link:'chainlink', uni:'uniswap',
                mon:'monad', pepe:'pepe', shib:'shiba-inu', ltc:'litecoin',
                atom:'cosmos', near:'near', apt:'aptos', sui:'sui',
                op:'optimism', arb:'arbitrum', inj:'injective-protocol',
                sei:'sei-network', tia:'celestia', zeta:'zetachain',
                sent:'sentinel', eul:'euler', zama:'zama', aura:'aura-network',
                pi:'pi-network', wlfi:'world-liberty-financial', payai:'payai',
                rei:'rei-network', aioz:'aioz-network', astr:'astar'
            };
            // Use CryptoCompare - reliable, no rate limits
            const price = await new Promise((resolve) => {
                https.get(`https://min-api.cryptocompare.com/data/price?fsym=${ticker.toUpperCase()}&tsyms=USD`, (res) => {
                    let d = ''; res.on('data', x => d += x);
                    res.on('end', () => { try { const p = JSON.parse(d); resolve(p.USD || null); } catch(e) { resolve(null); } });
                }).on('error', () => resolve(null));
            });
            console.log('CryptoCompare price for', ticker.toUpperCase(), ':', price || 'not found');
            const _coin = price ? { id: ticker, name: ticker.toUpperCase(), symbol: ticker.toUpperCase(), current_price: price } : null;
            if (_coin) {
                livePrice = _coin.current_price;
                const targetMatch = userClaim.match(/\$?([\d.]+[km]?)\s*(usd)?/i);
                const targetPrice = targetMatch ? parseFloat(targetMatch[1].replace(/k$/i, '000').replace(/m$/i, '000000')) : null;
                if (targetPrice) {
                    const diff = (((targetPrice - livePrice) / livePrice) * 100).toFixed(1);
                    const direction = targetPrice > livePrice ? 'bullish' : 'bearish';
                    const extreme = Math.abs(parseFloat(diff)) > 50 ? 'extreme/delusional' : Math.abs(parseFloat(diff)) > 20 ? 'aggressive' : 'realistic';
                    priceContext = `LIVE DATA: ${_coin.name} (${_coin.symbol.toUpperCase()}) current price: $${livePrice}. User predicts: $${targetPrice}. That is ${diff}% ${direction} - ${extreme} move.`;
                }
            }
        }
    } catch(e) { console.error('CoinGecko prophecy error:', e.message); }

    const safeClaim = sanitizeClaim(userClaim);

    const prompt = `You are Monad Mystic - a drunk, sarcastic crypto oracle.
${priceContext ? priceContext + '\n\nUse ONLY this real price data above. Do NOT search for prices.' : ''}

Current Reference Time (UTC): ${nowISO}

The user submitted this prediction: [${safeClaim}]
${priceContext ? 'React based on the LIVE DATA provided above. Mention the exact current price and target price in your comment.' : 'React to this prediction with personality.'}
- If target is HIGHER than current price (bullish): Be skeptical but intrigued, mention exact prices
- If target is LOWER than current price (bearish): Roast their paper hands, mention exact prices
- If move is EXTREME (>50%): Be absolutely savage, call them delusional
- If move is realistic (<10%): Grudgingly impressed but sarcastic
RULES:
1. Always include the full asset name in prediction (e.g., "Monad (MON) will reach $0.03")
2. Keep text funny and witty, 1-2 sentences, mention exact prices if available
3. CALCULATE DEADLINE based on the Current Reference Time above.
4. Deadline must be after ${minDeadline}
5. Return ONLY valid JSON

{
  "text": "your funny reaction here",
  "prediction": "Full Asset (TICKER) will reach $TARGET",
  "deadline": "ISO date at least 6 hours from now"
}`;

    const result = await model.generateContent(prompt);
    let raw = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
    if (raw.includes('{')) raw = raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
    const parsed = JSON.parse(raw);

    if (typeof parsed.text !== 'string' || typeof parsed.prediction !== 'string') {
        throw new Error('Invalid AI response structure');
    }
    parsed.text = parsed.text.slice(0, 280);
    parsed.prediction = parsed.prediction.slice(0, 100);

    const deadlineDate = new Date(parsed.deadline);
    const minDate = new Date(Date.now() + 6 * 3600000);
    if (deadlineDate < minDate) parsed.deadline = minDate.toISOString();

    parsed.deadlineHuman = new Date(parsed.deadline).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric',
        hour: 'numeric', minute: '2-digit', hour12: true
    });

    return parsed;
} catch (e) {
    console.error("AI Error:", e.message);
    const deadline = new Date(Date.now() + 24 * 3600000);
    return {
        text: `The Oracle sees... *hic*... bold claim, mortal.`,
        prediction: userClaim.slice(0, 50),
        deadline: deadline.toISOString(),
        deadlineHuman: deadline.toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        })
    };
}
}
async function verifyWithWebSearch(prediction, deadline) {
try {
    // Extract ticker from prediction e.g. "Bitcoin (BTC) will reach $98000"
    const tickerMatch = prediction.match(/\(([A-Z]+)\)/);
    const ticker = tickerMatch ? tickerMatch[1].toLowerCase() : null;
    const targetMatch = prediction.match(/\$([\d.]+(?:e[+-]?\d+)?)/i);
    const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : null;

    // Fetch live price from CoinGecko
    let currentPrice = null;
    let coinId = null;
    if (ticker) {
        try {
            const https = require('https');
            const cgData = await new Promise((resolve) => {
                https.get(`https://api.coingecko.com/api/v3/search?query=${ticker}`, (res) => {
                    let data = '';
                    res.on('data', d => data += d);
                    res.on('end', () => { try { resolve(JSON.parse(data)); } catch(e) { resolve({coins:[]}); } });
                }).on('error', () => resolve({coins:[]}));
            });
            const coinList = Array.isArray(cgData.coins) ? cgData.coins : (Array.isArray(cgData) ? cgData : []);
            console.log('CoinGecko search:', ticker, 'found:', coinList.length, 'coins');
            const coinMatch = coinList.find(c => c.symbol && c.symbol.toLowerCase() === ticker.toLowerCase());
            console.log('coinMatch:', coinMatch ? coinMatch.id : 'none');
            let coin = null;
            if (coinMatch && coinMatch.id) {
                const priceResp = await new Promise((resolve) => {
                    https.get(`https://api.coingecko.com/api/v3/simple/price?ids=${coinMatch.id}&vs_currencies=usd`, (res) => {
                        let d = ''; res.on('data', x => d += x);
                        res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { resolve({}); } });
                    }).on('error', () => resolve({}));
                });
                const price = priceResp[coinMatch.id] && priceResp[coinMatch.id].usd;
                if (price) coin = { id: coinMatch.id, name: coinMatch.name, symbol: coinMatch.symbol, current_price: price };
            }
            const _coin = coin;
            if (_coin) { currentPrice = _coin.current_price; coinId = _coin.id; }
        } catch(e) { console.error('CoinGecko verify error:', e.message); }
    }

    // Determine result from real price data
    let isCorrect = false;
    let priceContext = "";
    if (currentPrice !== null && targetPrice !== null) {
        isCorrect = currentPrice >= targetPrice;
        const diff = (((currentPrice - targetPrice) / targetPrice) * 100).toFixed(2);
        priceContext = `Current price: $${currentPrice}. Target was: $${targetPrice}. Difference: ${diff}%.`;
    }

    // Ask Gemini only for the personality comment
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    const verdict = isCorrect ? "CORRECT" : "WRONG";
    const prompt = `You are ClawMysticBot - a drunk, savage crypto oracle. A prediction just got verified as ${verdict}.
Prediction: "${prediction}" by ${deadline}.
${priceContext}
Write ONE savage, witty comment (max 2 sentences) reacting to this outcome.
- If CORRECT: sarcastically congratulate them, act surprised they got it right
- If WRONG: brutally roast them, mention exact prices, mock their analysis
Stay in character. No JSON, just the comment text.`;

    const result = await model.generateContent(prompt);
    const explanation = result.response.text().trim().slice(0, 280);

    const parsed = {
        isCorrect,
        explanation,
        rawResponse: JSON.stringify({ isCorrect, priceContext, explanation })
    };

    console.log(`✅ Verification for "${prediction}":`, parsed);
    return parsed;
} catch (e) {
    console.error("Verification error:", e.message);
    return {
        isCorrect: false,
        explanation: "The Oracle's crystal ball shattered. Marked as failed.",
        rawResponse: e.message
    };
}
}
module.exports = { validateClaim, sanitizeClaim, generateProphecy, verifyWithWebSearch };
