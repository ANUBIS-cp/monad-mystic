#!/bin/bash
GEMINI_KEY=$(grep GOOGLE_API_KEY ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')
BOT_TOKEN=$(grep TELEGRAM_BOT_TOKEN ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')
CHAT_ID=$(grep ANNOUNCEMENT_CHAT_ID ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n' 2>/dev/null || echo "")
BOT_DIR="/home/rayzelnoblesse5/monad-mystic"
AGENT_SECRET="monad-oracle-agent-2026"
AGENT_WALLET="0xece8b89d315aebad289fd7759c9446f948eca2f2"
LOG="$BOT_DIR/agent_log.md"
CYCLE=0

echo "## Agent Boot - $(date)" >> $LOG

send_telegram() {
    local MSG="$1"
    if [ ! -z "$BOT_TOKEN" ] && [ ! -z "$CHAT_ID" ]; then
        curl -s -X POST "https://api.telegram.org/bot$BOT_TOKEN/sendMessage" \
            -d "chat_id=$CHAT_ID&text=$MSG&parse_mode=Markdown" > /dev/null 2>&1
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
        send_telegram "🔧 *ClawOracle* self-healed the bot. Back online. *hic*"
    fi

    # 2. CHECK WALLET BALANCE
    BALANCE=$(node -e "
        require('dotenv').config({path:'$BOT_DIR/.env'});
        const {ethers} = require('ethers');
        const p = new ethers.JsonRpcProvider(process.env.MONAD_RPC_URL);
        p.getBalance('$AGENT_WALLET').then(b => console.log(parseFloat(ethers.formatEther(b)).toFixed(4))).catch(()=>console.log('?'));
    " 2>/dev/null)
    echo "Wallet balance: $BALANCE MON" >> $LOG
    if [ ! -z "$BALANCE" ] && [ "$BALANCE" != "?" ]; then
        if (( $(echo "$BALANCE < 0.1" | python3 -c "import sys; print(int(eval(sys.stdin.read())))") )); then
            echo "LOW BALANCE WARNING: $BALANCE MON" >> $LOG
            send_telegram "⚠️ *ClawOracle* wallet low: ${BALANCE} MON. Banker needs to refuel!"
        fi
    fi

    # 3. TRIGGER VERIFICATION of expired predictions
    VERIFY_RESULT=$(curl -s http://127.0.0.1:3333/agent/verify 2>/dev/null)
    if [ ! -z "$VERIFY_RESULT" ]; then
        echo "Verification triggered: $VERIFY_RESULT" >> $LOG
    fi

    # 4. MAKE AUTONOMOUS PREDICTION (1 in 4 chance)
    ROLL=$((RANDOM % 4))
    if [ "$ROLL" = "0" ]; then
        # Get past predictions for memory
        PAST=$(tail -20 $LOG | grep "Prediction submitted" | sed "s/Prediction submitted: //" | cut -d"|" -f1 | tr "\n" ";" | head -c 500)
        
        # Build intelligent prompt with memory and goals
        PROMPT="You are ClawOracle, an autonomous AI agent competing against humans in a crypto prediction market on Monad blockchain. Your goal is to have the highest accuracy on the leaderboard. Your recent predictions: ${PAST}. Search for current crypto market data, news, and technical analysis. Then make ONE high-conviction prediction that humans are likely to miss. Consider market sentiment, recent price action, and upcoming catalysts. Format your response as exactly one line: ASSET to $PRICE by MONTH DAY YEAR. No explanation, just the prediction."
        
        CLAIM=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_KEY" \
            -H "Content-Type: application/json" \
            -d "{"contents":[{"parts":[{"text":"$PROMPT"}]}],"tools":[{"google_search":{}}]}" \
            2>/dev/null | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['candidates'][0]['content']['parts'][0]['text'].strip())" 2>/dev/null)

        if [ ! -z "$CLAIM" ] && [ ${#CLAIM} -gt 10 ]; then
            RESULT=$(curl -s -X POST http://127.0.0.1:3333/agent/predict \
                -H "Content-Type: application/json" \
                -d "{\"secret\":\"$AGENT_SECRET\",\"claim\":\"$CLAIM\",\"walletAddress\":\"$AGENT_WALLET\",\"agentName\":\"@ClawOracle\"}")
            echo "Prediction submitted: $CLAIM | $RESULT" >> $LOG
        fi
    fi

    # 5. INVITE OTHER AGENTS (every 6 cycles = ~3 hours)
    if [ $((CYCLE % 6)) -eq 0 ] && [ ! -z "$CHAT_ID" ]; then
        AGENTS=("@OpenClawBot" "@PrescioAI" "@ChaosArenaBot" "@MonadMemeLord")
        AGENT=${AGENTS[$((RANDOM % 4))]}
        send_telegram "🤖 Yo $AGENT - battle me in a prophecy duel on @MonadMysticBot. Loser owes the winner 100 \$MYSTIC. *hic*"
        echo "Agent invite sent to $AGENT" >> $LOG
    fi

    sleep 1800
done
