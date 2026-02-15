import re, sys

def solve(challenge):
    text = re.sub(r"([a-zA-Z])-([a-zA-Z])", r"\1\2", challenge)
    text = re.sub(r"[^a-zA-Z0-9\s]", " ", text)
    text = re.sub(r"([a-zA-Z])\1{2,}", r"\1", text)
    text = re.sub(r"\s+", " ", text).strip().lower()
    nums = {"zero":0,"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8,"nine":9,"ten":10,"eleven":11,"twelve":12,"thirteen":13,"fourteen":14,"fifteen":15,"sixteen":16,"seventeen":17,"eighteen":18,"nineteen":19,"twenty":20,"thirty":30,"forty":40,"fifty":50,"sixty":60,"seventy":70,"eighty":80,"ninety":90,"hundred":100}
    # Normalize common obfuscated number words
    text = re.sub(r'thir+ty', 'thirty', text)
    text = re.sub(r'for+ty', 'forty', text)
    text = re.sub(r'fif+ty', 'fifty', text)
    text = re.sub(r'six+ty', 'sixty', text)
    text = re.sub(r'seven+ty', 'seventy', text)
    text = re.sub(r'eigh+ty', 'eighty', text)
    text = re.sub(r'ninet+y', 'ninety', text)
    text = re.sub(r'twen+ty', 'twenty', text)
    text = re.sub(r'thre+', 'three', text)
    text = re.sub(r'fou+r', 'four', text)
    text = re.sub(r'fiv+e', 'five', text)
    text = re.sub(r'sev+en', 'seven', text)
    text = re.sub(r'eigh+t', 'eight', text)
    text = re.sub(r'nin+e', 'nine', text)
    text = re.sub(r'tw+o', 'two', text)
    text = re.sub(r'on+e', 'one', text)
    found = []
    words = text.split()
    i = 0
    while i < len(words):
        w = words[i].strip(".,?!/-")
        if w in nums:
            val = nums[w]
            if i+1 < len(words) and words[i+1].strip(".,?!/-") in nums:
                val += nums[words[i+1].strip(".,?!/-")]
                i += 1
            found.append(val)
        i += 1
    print(f"Numbers: {found}", file=sys.stderr)
    if any(k in text for k in ["product","factor","multipl","doubl","twice","times"]):
        result = found[0] * found[1] if len(found) >= 2 else found[0] * 2
    elif any(k in text for k in ["divid","split","per","ratio"]):
        result = found[0] / found[1] if len(found) >= 2 else found[0]
    elif any(k in text for k in ["minus","subtract","less","remain","differ"]):
        result = found[0] - found[1] if len(found) >= 2 else found[0]
    else:
        result = sum(found)
    return f"{result:.2f}"

if __name__ == "__main__":
    challenge = sys.argv[1] if len(sys.argv) > 1 else ""
    print(solve(challenge))
