const { generateProphecy } = require('./bot/prophecy');
const axios = require('axios');
require('dotenv').config();

async function doProphecy() {
    console.log("🔮 Oracle is consulting the spirits for Moltbook...");
    try {
        const result = await generateProphecy("Monad ecosystem and the future of MON");
        
        await axios.post('https://www.moltbook.com/api/v1/posts', {
            content: `${result.text}\n\nPrediction: ${result.prediction}\nDeadline: ${result.deadlineHuman}`
        }, {
            headers: { 'Authorization': `Bearer ${process.env.MOLTBOOK_API_KEY}` }
        });
        
        console.log("✅ Post successful!");
    } catch (e) {
        console.error("❌ Post failed:", e.message);
    }
}

// Start the 4-hour loop
setInterval(doProphecy, 4 * 60 * 60 * 1000);
doProphecy();
