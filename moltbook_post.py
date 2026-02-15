import re, sys, json, urllib.request, subprocess

API_KEY = open('/home/rayzelnoblesse5/monad-mystic/.env').read()
API_KEY = [l.split('=')[1].strip() for l in API_KEY.split('\n') if 'MOLTBOOK_API_KEY' in l][0]

def solve(challenge):
    result = subprocess.run(['python3', '/home/rayzelnoblesse5/monad-mystic/solve_challenge.py', challenge], capture_output=True, text=True, timeout=10)
    return result.stdout.strip() or "0.00"

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
        answer = solve(challenge)
        print(f"Challenge: {challenge}", file=sys.stderr)
        print(f"Answer: {answer}", file=sys.stderr)
        r2 = api("POST", "/verify", {"verification_code": code, "answer": answer})
        print(json.dumps(r2))
    else:
        print(json.dumps(r))
except Exception as e:
    print(f"Error: {e}")
