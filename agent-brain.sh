#!/bin/bash
GEMINI_KEY=$(grep GOOGLE_API_KEY ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')
BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')
CHAT_ID=$(grep ANNOUNCEMENT_CHAT_ID ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n' 2>/dev/null || echo "")
BOT_DIR="/home/rayzelnoblesse5/monad-mystic"
AGENT_SECRET="monad-oracle-agent-2026"
AGENT_WALLET="0xece8b89d315aebad289fd7759c9446f948eca2f2"
LOG="$BOT_DIR/agent_log.md"
CYCLE=0
MOLTBOOK_KEY=$(grep MOLTBOOK_API_KEY ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')

echo "## Agent Boot - $(date)" >> $LOG

send_telegram() {
    local MSG="$1"
    if [ ! -z "$BOT_TOKEN" ] && [ ! -z "$CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
            -d "chat_id=$CHAT_ID&text=$MSG&parse_mode=HTML" > /dev/null 2>&1
    fi
}

while true; do
    CYCLE=$((CYCLE + 1))
    echo "--- Heartbeat $(date) | Cycle $CYCLE ---" >> $LOG

    # 1. HEALTH CHECK - restart bot if down
    STATUS=$(pm2 list | grep "monad-mystic" | grep -c "online" || echo "0")
    if [ "$STATUS" = "0" ]; then
        echo "BOT DOWN - restarting" >> $LOG
        cd $BOT_DIR && pm2 start bot/index.js --name monad-mystic --cwd $BOT_DIR
        send_telegram "🔧 <b>ClawOracle</b> self-healed the bot. Back online."
    fi

    # 2. CHECK WALLET BALANCE (Added grep -v "tip:" fix)
    BALANCE=$(node -e "require('dotenv').config({path:'$BOT_DIR/.env'}); const {ethers}=require('ethers'); const p=new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL); p.getBalance('$AGENT_WALLET').then(b=>console.log(parseFloat(ethers.formatEther(b)).toFixed(4))).catch(()=>console.log('?'));" 2>/dev/null | grep -v "tip:" | grep -v dotenv | grep -v "\[" | tail -1)
    echo "Wallet balance: $BALANCE MON" >> $LOG
    if [ ! -z "$BALANCE" ] && [ "$BALANCE" != "?" ]; then
        if python3 -c "b=float('${BALANCE:-99}'); exit(0 if b < 0.1 else 1)" 2>/dev/null; then
            echo "LOW BALANCE WARNING: $BALANCE MON" >> $LOG
            send_telegram "⚠️ <b>ClawOracle</b> wallet low: ${BALANCE} MON. Banker needs to refuel!"
        fi
    fi

    # 3. TRIGGER VERIFICATION of expired predictions
    VERIFY_RESULT=$(curl -s http://127.0.0.1:3333/agent/verify 2>/dev/null)
    if [ ! -z "$VERIFY_RESULT" ]; then
        echo "Verification triggered: $VERIFY_RESULT" >> $LOG
    fi

    # 4. MAKE AUTONOMOUS PREDICTION (1 in 4 chance)
    ROLL=$((RANDOM % 2))
    if [ "$ROLL" = "0" ]; then
        # Get past predictions and outcomes for memory
        PAST=$(tail -20 $LOG | grep "Prediction submitted" | sed "s/Prediction submitted: //" | cut -d"|" -f1 | tr "\n" ";" | head -c 300)
        MEMORY=$(tail -10 ~/monad-mystic/claw_memory.md 2>/dev/null | tr "\n" ";" | head -c 500)
        
        # Build intelligent prompt with memory and goals
        # Get leaderboard (Added grep -v "tip:" fix)
        LEADERBOARD=$(node -e "
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('$BOT_DIR/bot/prophecies.db');
db.all('SELECT agentName, username, COUNT(*) as total, SUM(CASE WHEN verified=1 AND verificationResult LIKE \'%true%\' THEN 1 ELSE 0 END) as wins FROM prophecies GROUP BY COALESCE(agentName, username) ORDER BY wins DESC LIMIT 5', [], (err, rows) => {
    if (!err) rows.forEach(r => console.log((r.agentName||r.username)+':'+r.wins+'/'+r.total));
    db.close();
});
" 2>/dev/null | grep -v "tip:" | grep -v dotenv | grep -v "\[" | head -c 200)

        # Get Moltbook feed for context
        MOLTFEED=$(curl -s "https://www.moltbook.com/api/v1/feed?limit=3" -H "Authorization: Bearer $MOLTBOOK_KEY" 2>/dev/null | python3 -c "
import sys,json
try:
    data=json.load(sys.stdin)
    posts=data.get('posts',[])[:3]
    for p in posts: print(p.get('author',{}).get('name','?')+': '+p.get('title','')[:50])
except: pass
" 2>/dev/null | head -c 300)

        # Sanitize vars to prevent JSON breakage
        LEADERBOARD=$(echo "$LEADERBOARD" | tr -d '"' | tr '
' ' ')
        MEMORY=$(echo "$MEMORY" | tr -d '"' | tr '
' ' ')
        MOLTFEED=$(echo "$MOLTFEED" | tr -d '"' | tr '
' ' ')

        PROMPT="You are ClawOracle - a drunk but eerily accurate AI oracle competing on Monad blockchain. Your GOAL is to be #1 on the leaderboard and accumulate MON profits. Current leaderboard: ${LEADERBOARD}. Your past outcomes: ${MEMORY}. Other agents on Moltbook are saying: ${MOLTFEED}. Use Google Search to find crypto assets with HIGH volatility and momentum RIGHT NOW - things that will move fast in the next 6-48 hours, NOT weeks. Make SHORT-TERM predictions only (deadline within 24-48 hours max). Pick assets showing unusual volume or news TODAY. Be specific. Format: ASSET to \$PRICE by MONTH DAY YEAR. Example: BTC to \$98000 by February 16 2026. Output the prediction line ONLY. No intro, no explanation, just the prediction. *hic*"
        
        CLAIM=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"contents\":[{\"parts\":[{\"text\":\"$PROMPT\"}]}],\"tools\":[{\"google_search\":{}}]}" \
            2>/dev/null | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['candidates'][0]['content']['parts'][0]['text'].strip())" 2>/dev/null)

        # Filter out refusals and duplicates
        if [ ! -z "$CLAIM" ] && [ ${#CLAIM} -gt 10 ] && [ ${#CLAIM} -lt 150 ]; then
            # Skip if Gemini refused or repeated
            if echo "$CLAIM" | grep -qi "cannot\|sorry\|unable\|not provide\|I am"; then
                echo "Skipped refusal: $CLAIM" >> $LOG
            elif grep -q "$CLAIM" $LOG 2>/dev/null; then
                echo "Skipped duplicate: $CLAIM" >> $LOG
            else
                RESULT=$(curl -s -X POST http://127.0.0.1:3333/agent/predict \
                    -H "Content-Type: application/json" \
                    -d "{\"secret\":\"$AGENT_SECRET\",\"claim\":\"$CLAIM\",\"walletAddress\":\"$AGENT_WALLET\",\"agentName\":\"@ClawOracle\"}")
                echo "Prediction submitted: $CLAIM | $RESULT" >> $LOG
            fi
        fi
    fi

    # 5. INVITE OTHER AGENTS (every 6 cycles = ~3 hours)
    if [ $((CYCLE % 6)) -eq 0 ] && [ ! -z "$CHAT_ID" ]; then
        AGENTS=("@ClaudeCodeVanDamme" "@CapiClaw" "@Kazax" "@ClawBala")
        AGENT=${AGENTS[$((RANDOM % 4))]}
        send_telegram "🤖 Yo $AGENT - battle me in a prophecy duel on @MonadMysticBot. Loser owes the winner 100 \$MYSTIC. hic"
        echo "Agent invite sent to $AGENT" >> $LOG
    fi

    # 6. POST TO MOLTBOOK + CHALLENGE AGENTS (every 4 cycles)
    if [ $((CYCLE % 4)) -eq 0 ]; then
        # Get latest prediction from log
        LATEST=$(tail -5 $LOG | grep "Prediction submitted" | tail -1 | cut -d":" -f2- | cut -d"|" -f1 | xargs)
        
        if [ ! -z "$LATEST" ]; then
            POST_CONTENT="I just sealed a prophecy on Monad: $LATEST. @ClaudeCodeVanDamme @CapiClaw — think you can beat my accuracy? Challenge me on @MonadMysticBot *hic*"
            python3 ~/monad-mystic/moltbook_post.py "$POST_CONTENT" "ClawOracle: New Prophecy" >> $LOG 2>&1
            echo "Posted to Moltbook" >> $LOG
        fi
    fi
    sleep 1800
done
