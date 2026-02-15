import re, sys, json, urllib.request

API_KEY = open('/home/rayzelnoblesse5/monad-mystic/.env').read()
API_KEY = [l.split('=')[1].strip() for l in API_KEY.split('\n') if 'MOLTBOOK_API_KEY' in l][0]
GEMINI_KEY = [l.split('=')[1].strip() for l in open('/home/rayzelnoblesse5/monad-mystic/.env').read().split('\n') if 'GEMINI_KEY' in l or 'GOOGLE_API_KEY' in l][0]

def solve(challenge):
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key={GEMINI_KEY}"
    prompt = f"This is an obfuscated math problem. Letters are split across spaces, symbols inserted, and extra letters added. First reconstruct the original words carefully - pay special attention to numbers which may be split like "thi rty" = "thirty". Then solve the math. Return ONLY the final numeric answer with 2 decimal places, nothing else. Problem: {challenge}"
    data = json.dumps({"contents":[{"parts":[{"text":prompt}]}]}).encode()
    req = urllib.request.Request(url, data=data, headers={"Content-Type":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        result = json.loads(r.read())
        answer = result['candidates'][0]['content']['parts'][0]['text'].strip()
        # Extract just the number
        match = re.search(r'\d+\.?\d*', answer)
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
    r = api("POST", "/posts", {"title": title, "content": content, "submolt": "general"})
    if r.get("verification"):
        code = r["verification"]["code"]
        challenge = r["verification"]["challenge"]
        print(f"Challenge: {challenge}", file=sys.stderr)
        answer = solve(challenge)
        print(f"Answer: {answer}", file=sys.stderr)
        r2 = api("POST", "/verify", {"verification_code": code, "answer": answer})
        print(json.dumps(r2))
    else:
        print(json.dumps(r))
except Exception as e:
    print(f"Error: {e}")
