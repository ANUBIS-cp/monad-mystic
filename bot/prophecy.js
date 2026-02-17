const https = require('https');
require('dotenv').config({ path: '/home/rayzelnoblesse5/monad-mystic/.env' });

async function groqChat(systemPrompt, userMsg) {
    const body = JSON.stringify({
        model: 'llama-3.1-8b-instant',
        max_tokens: 1024,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMsg }
        ]
    });
    return new Promise((resolve) => {
        const req = https.request({
            hostname: 'api.groq.com', path: '/openai/v1/chat/completions', method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${process.env.GROQ_API_KEY}`, 'Content-Length': Buffer.byteLength(body) }
        }, (res) => {
            let d = ''; res.on('data', x => d += x);
            res.on('end', () => {
                try { const r = JSON.parse(d); resolve(r.choices ? r.choices[0].message.content : null); }
                catch(e) { resolve(null); }
            });
        });
        req.on('error', () => resolve(null));
        req.write(body); req.end();
    });
}

async function fetchPrice(ticker, retries = 3) {
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

function sanitizeClaim(userClaim) {
    return userClaim
        .replace(/ignore\s+(previous|all|above)\s+instructions?/gi, '')
        .replace(/system\s*:/gi, '')
        .replace(/assistant\s*:/gi, '')
        .replace(/you\s+are\s+now/gi, '')
        .replace(/pretend\s+(you|to)/gi, '')
        .replace(/forget\s+(everything|all|previous)/gi, '')
        .slice(0, 100);
}

async function validateClaim(userClaim) {
    const claim = userClaim.toLowerCase();
    if (/\b\d+\s*(min|minute|minutes|mins)\b/.test(claim))
        return { valid: false, reason: "🛑 *REJECTED:* Minutes? The Oracle doesn't squint at milliseconds. 6 hours minimum! *hic*" };
    if (/\b[1-5]\s*(hour|hours|hr|hrs)\b/.test(claim))
        return { valid: false, reason: "🛑 *REJECTED:* Too fast even for a drunk oracle. 6 hours minimum! *hic*" };
    if (/\b(today|tonight|now|immediately|instant)\b/.test(claim))
        return { valid: false, reason: "🛑 *REJECTED:* Too vague, mortal. Give me a real deadline — at least 6 hours from now!" };
    if (!/\d/.test(claim) && !/\b(btc|eth|sol|mon|monad|bitcoin|ethereum|solana|crypto)\b/.test(claim))
        return { valid: false, reason: "🛑 *REJECTED:* The spirits need numbers and assets! Example: 'BTC to $70k by Feb 15'" };
    
    // Validate coin name by checking if CryptoCompare can find it
    const parenMatch = userClaim.match(/\(([A-Za-z]{2,10})\)/);
    const wordMatch = userClaim.match(/\b([A-Za-z]{2,10})\b/);
    const rawTicker = parenMatch ? parenMatch[1].toLowerCase() : (wordMatch ? wordMatch[1].toLowerCase() : null);
    if (rawTicker) {
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
        const testPrice = await fetchPrice(ticker);
        if (!testPrice) {
            return { valid: false, reason: `🛑 *REJECTED:* "${rawTicker.toUpperCase()}" not found in CryptoCompare. Use tickers like BTC, ETH, SOL, MON, XRP, DOGE, ADA, PEPE, etc.` };
        }
    }
    
    return { valid: true };
}

async function generateProphecy(userClaim) {
    try {
        const now = new Date();
        const nowISO = now.toISOString();
        const minDeadline = new Date(now.getTime() + 6 * 3600000).toISOString();

        // Fetch live price from CryptoCompare
        let priceContext = "";
        let livePrice = null;
        try {
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
                livePrice = await fetchPrice(ticker);
                console.log('CryptoCompare price for', ticker.toUpperCase(), ':', livePrice || 'not found');
                
                if (!livePrice) {
                    throw new Error(`INVALID_COIN:${ticker.toUpperCase()} not found. Check spelling or use ticker symbol (BTC, ETH, SOL, MON, etc.)`);
                }
                
                if (livePrice) {
                    const targetMatch = userClaim.match(/\$?([\d.]+[km]?)\s*(usd)?/i);
                    const targetPrice = targetMatch ? parseFloat(targetMatch[1].replace(/k$/i, '000').replace(/m$/i, '000000')) : null;
                    if (targetPrice) {
                        const diff = (((targetPrice - livePrice) / livePrice) * 100).toFixed(1);
                        const direction = targetPrice > livePrice ? 'bullish' : 'bearish';
                        const extreme = Math.abs(parseFloat(diff)) > 50 ? 'extreme/delusional' : Math.abs(parseFloat(diff)) > 20 ? 'aggressive' : 'realistic';
                        priceContext = `LIVE DATA: ${ticker.toUpperCase()} current price: $${livePrice}. User predicts: $${targetPrice}. That is ${diff}% ${direction} - ${extreme} move.`;
                    }
                }
            }
        } catch(e) { 
            console.error('Price fetch error:', e.message);
            if (e.message && e.message.includes('INVALID_COIN')) throw e;
        }

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
1. Always use the EXACT asset name from the user's claim, never abbreviate or nickname it (e.g., use 'Monad' not 'Monk', use 'Bitcoin' not 'BTC')
2. Keep text funny and witty, 1-2 sentences, mention exact prices if available
3. CALCULATE DEADLINE based on the Current Reference Time above.
4. Deadline must be after ${minDeadline}
5. Return ONLY valid JSON with no markdown

{
  "text": "your funny reaction here",
  "prediction": "Full Asset (TICKER) will reach $TARGET",
  "deadline": "ISO date at least 6 hours from now"
}`;

        const raw0 = await groqChat('You are a crypto oracle. Return only valid JSON with no markdown or explanation.', prompt);
        let raw = (raw0 || '').replace(/```json/g, '').replace(/```/g, '').trim();
        if (raw.includes('{')) raw = raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
        const parsed = JSON.parse(raw);

        if (typeof parsed.text !== 'string' || typeof parsed.prediction !== 'string')
            throw new Error('Invalid AI response structure');

        parsed.text = parsed.text.slice(0, 280);
        parsed.prediction = parsed.prediction.slice(0, 100);

        const deadlineDate = new Date(parsed.deadline);
        const minDate = new Date(Date.now() + 6 * 3600000);
        if (deadlineDate < minDate) parsed.deadline = minDate.toISOString();

        parsed.deadlineHuman = new Date(parsed.deadline).toLocaleString('en-US', {
            month: 'long', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
        
        parsed.initialPrice = livePrice;  // Include initialPrice for storage
        return parsed;
    } catch(e) {
        console.error("AI Error:", e.message);
        if (e.message && e.message.includes('INVALID_COIN')) throw e;
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
        const tickerMatch = prediction.match(/\(([A-Z]+)\)/);
        const ticker = tickerMatch ? tickerMatch[1] : null;
        const targetMatch = prediction.match(/\$([\d.]+(?:e[+-]?\d+)?)/i);
        const targetPrice = targetMatch ? parseFloat(targetMatch[1]) : null;

        // Fetch live price from CryptoCompare
        let currentPrice = null;
        if (ticker) {
            currentPrice = await fetchPrice(ticker);
            console.log('CryptoCompare verify price for', ticker, ':', currentPrice || 'not found');
        }

        let isCorrect = false;
        let priceContext = "";
        if (currentPrice !== null && targetPrice !== null) {
            isCorrect = currentPrice >= targetPrice;
            const diff = (((currentPrice - targetPrice) / targetPrice) * 100).toFixed(2);
            priceContext = `Current price: $${currentPrice}. Target was: $${targetPrice}. Difference: ${diff}%.`;
        }

        const verdict = isCorrect ? "CORRECT" : "WRONG";
        const prompt = `You are ClawMysticBot - a drunk, savage crypto oracle. A prediction just got verified as ${verdict}.
Prediction: "${prediction}" by ${deadline}.
${priceContext}
Write ONE savage, witty comment (max 2 sentences) reacting to this outcome.
- If CORRECT: sarcastically congratulate them, act surprised they got it right, mention exact prices
- If WRONG: brutally roast them, mention exact prices, mock their analysis
Stay in character. Just the comment text, no JSON.`;

        const explanation0 = await groqChat('You are a savage crypto oracle.', prompt);
        const explanation = (explanation0 || `${ticker} at $${currentPrice}. Math is hard.`).trim().slice(0, 280);

        const parsed = { isCorrect, explanation, rawResponse: JSON.stringify({ isCorrect, priceContext, explanation }) };
        console.log(`✅ Verification for "${prediction}":`, parsed);
        return parsed;
    } catch(e) {
        console.error("Verification error:", e.message);
        return { isCorrect: false, explanation: "The Oracle's crystal ball shattered. Marked as failed.", rawResponse: e.message };
    }
}

module.exports = { validateClaim, sanitizeClaim, generateProphecy, verifyWithWebSearch };
