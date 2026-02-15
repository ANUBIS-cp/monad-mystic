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

    const safeClaim = sanitizeClaim(userClaim);

    const prompt = `You are Monad Mystic - a drunk, sarcastic crypto oracle.

Current Reference Time (UTC): ${nowISO}

1. USE WEB SEARCH to find the current live price of the asset in this claim: [${safeClaim}]
2. Compare the claim's target price to that live price.
Your job is to react to this prediction with personality and accuracy:
- If the prediction realistic → impressed but sarcastic
- If target is EXTREME (e.g.,BTC to $1M): Be absolutely savage and call them a delusional degenerate.
- If TARGET is LOWER than current price: Roast his paper hands, cowardice, Tell them to enjoy staying poor while you buy their bags.
RULES YOU MUST FOLLOW NO MATTER WHAT:
1. Always include the full asset name in prediction (e.g., "Monad (MON) will reach $0.03")
2. Keep text funny and witty, 1-2 sentences, mention the asset
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
const model = genAI.getGenerativeModel({
model: "gemini-2.0-flash",
tools: [{ googleSearch: {} }]
});

    const todayStr = new Date().toLocaleString('en-US', { month: 'long', year: 'numeric' });

    const prompt = `Today is ${todayStr}. Use Google Search to find current crypto prices. Be extremely precise and fact-based — double-check search results before answering.

Did this prediction come true: "${prediction}" by ${deadline}?

Search for the current price of the asset. Then determine:
- TRUE if the price target was reached by the deadline
- FALSE if it was not reached

Return ONLY valid JSON:
{
  "isCorrect": true or false,
  "explanation": "One snarky sentence with the actual current price you found"
}`;

    let parsed;
    let rawResponse = "";

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const result = await model.generateContent(prompt);
        let raw = result.response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        if (raw.includes('{')) raw = raw.substring(raw.indexOf('{'), raw.lastIndexOf('}') + 1);
        rawResponse = raw;
        parsed = JSON.parse(raw);
        break;
      } catch (e) {
        if (attempt === 2) throw e;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log(`🔍 Raw verification response for "${prediction}":`, rawResponse);
    if (typeof parsed.isCorrect !== 'boolean') parsed.isCorrect = false;
    if (typeof parsed.explanation !== 'string') parsed.explanation = "The Oracle is confused.";
    parsed.explanation = parsed.explanation.slice(0, 280);
    parsed.rawResponse = rawResponse;

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
