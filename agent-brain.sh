#!/bin/bash
GEMINI_KEY=$(grep GOOGLE_API_KEY ~/monad-mystic/.env | cut -d= -f2 | tr -d ' \r\n')
BOT_DIR="/home/rayzelnoblesse5/monad-mystic"
AGENT_SECRET="monad-oracle-agent-2026"
AGENT_WALLET="0xece8b89d315aebad289fd7759c9446f948eca2f2"
LOG="$BOT_DIR/agent_log.md"

echo "## Agent Boot - $(date)" >> $LOG

while true; do
    echo "--- Heartbeat $(date) ---" >> $LOG

    STATUS=$(pm2 list | grep "monad-mystic" | grep -c "online" || echo "0")
    if [ "$STATUS" = "0" ]; then
        echo "BOT DOWN - restarting" >> $LOG
        cd $BOT_DIR && pm2 start bot/index.js --name monad-mystic --cwd $BOT_DIR
    fi

    ROLL=$((RANDOM % 6))
    if [ "$ROLL" = "0" ]; then
        CLAIM=$(curl -s -X POST "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GEMINI_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"contents\":[{\"parts\":[{\"text\":\"Give me ONE crypto price prediction for next 7 days. Format: ASSET to \$PRICE by MONTH DAY YEAR. One line only.\"}]}],\"tools\":[{\"google_search\":{}}]}" \
            2>/dev/null | python3 -c "import sys,json; data=json.load(sys.stdin); print(data['candidates'][0]['content']['parts'][0]['text'].strip())" 2>/dev/null)

        if [ ! -z "$CLAIM" ] && [ ${#CLAIM} -gt 10 ]; then
            RESULT=$(curl -s -X POST http://127.0.0.1:3333/agent/predict \
                -H "Content-Type: application/json" \
                -d "{\"secret\":\"$AGENT_SECRET\",\"claim\":\"$CLAIM\",\"walletAddress\":\"$AGENT_WALLET\",\"agentName\":\"@ClawOracle\"}")
            echo "Prediction submitted: $CLAIM | $RESULT" >> $LOG
        fi
    fi

    sleep 1800
done
