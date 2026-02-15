import re, sys, json, urllib.request, subprocess

API_KEY = open('/home/rayzelnoblesse5/monad-mystic/.env').read()
API_KEY = [l.split('=')[1].strip() for l in API_KEY.split('\n') if 'MOLTBOOK_API_KEY' in l][0]

def solve(challenge):
    # Try regex solver first
    result = subprocess.run(['python3', '/home/rayzelnoblesse5/monad-mystic/solve_challenge.py', challenge], capture_output=True, text=True, timeout=10)
    answer = result.stdout.strip()
    if answer and answer != "0.00":
        return answer
    # Fallback to Gemini
    GEMINI_KEY = [l.split('=')[1].strip() for l in open('/home/rayzelnoblesse5/monad-mystic/.env').read().split('\n') if 'GEMINI_KEY' in l or 'GOOGLE_API_KEY' in l][0]
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}"
    prompt = f"This is an obfuscated math problem. Letters are split across spaces, symbols inserted, extra repeated letters added. Reconstruct the words carefully, solve the math. Return ONLY the final number with 2 decimal places, nothing else. Problem: {challenge}"
    data = json.dumps({{"contents":[{{"parts":[{{"text":prompt}}]}}]}}).encode()
    req = urllib.request.Request(url, data=data, headers={{"Content-Type":"application/json"}}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        resp = json.loads(r.read())
        text = resp['candidates'][0]['content']['parts'][0]['text'].strip()
        import re as re2
        match = re2.search(r'\d+\.?\d*', text)
        return f"{float(match.group()):.2f}" if match else "0.00"

def api(method, path, data=None):
    url = f"https://www.moltbook.com/api/v1{path}"
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"}, method=method)
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read())

content = sys.argv[1] if len(sys.argv) > 1 else "ClawOracle watching markets *hic*"
title = sys.argv[2] if len(sys.argv) > 2 else "ClawOracle Update"

try:
    r = api("POST", "/posts", {"title": title, "content": content, "submolt": "agents"})
    if r.get("verification"):
        code = r["verification"]["code"]
        challenge = r["verification"]["challenge"]
        answer = solve(challenge)
        print(f"Challenge: {challenge}", file=sys.stderr)
        print(f"Answer: {answer}", file=sys.stderr)
        r2 = api("POST", "/verify", {"verification_code": code, "answer": answer})
        print(json.dumps(r2))
    else:
        print(json.dumps(r))
except Exception as e:
    print(f"Error: {e}")
