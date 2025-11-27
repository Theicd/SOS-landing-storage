#!/usr/bin/env python3
"""
Blossom Server Scanner
מושך רשימות שרתים ממקורות ציבוריים ובודק זמינות של כל שרת להעלאות.
"""

import json
import re
import sys
import time
from typing import List, Dict, Tuple

try:
    import requests
except ImportError:
    sys.exit("שגיאה: חסר חבילת requests. התקן: pip install requests")

# מקורות ידועים לרשימות שרתים
KNOWN_SOURCES = [
    "https://blossomservers.com/assets/index-*.js",  # יכול להשתנות עם זמן
    "https://nostrify.dev/upload/blossom",           # דוגמאות בתיעוד
    "https://github.com/hzrd149/blossom",           # README ודוגמאות
    "https://github.com/nostr-protocol/nostr",      # תיעוד NIP-94
    "https://raw.githubusercontent.com/nostr-protocol/nips/master/94.md",  # NIP-94 גולמי
    "https://gitlab.com/soapbox-pub/nostrify",       # מאגר Nostrify
    "https://raw.githubusercontent.com/soapbox-pub/nostrify/main/docs/upload/blossom.md",  # תיעוד גולמי
    "https://github.com/Note-Asset/Note-Asset",      # מאגר נוסף של Blossom
    "https://github.com/v0l/snort",                  # Snort - לקוח Nostr עם תמיכה ב-Blossom
    "https://github.com/digitalblossom-co/blossom-servers",  # רשימת שרתים פוטנציאלית
]

# שרתים סטטיים מתועדים (fallback)
STATIC_FALLBACKS = [
    {"url": "https://blossom.band", "pubkey": "npub1blossomserver"},
    {"url": "https://blossom.primal.net", "pubkey": "npub1primal"},
    {"url": "https://cdn.satellite.earth", "pubkey": "npub1satellite"},
    {"url": "https://blossom.nostr.build", "pubkey": "npub1nostrbuild"},
    {"url": "https://blossom.void.cat", "pubkey": "npub1voidcat"},
    {"url": "https://nostr.build", "pubkey": "npub1nostrbuild"},
    {"url": "https://files.nostr.band", "pubkey": "npub1band"},
    {"url": "https://blossom.nostr.wine", "pubkey": "npub1wine"},
    {"url": "https://cdn.zap.stream", "pubkey": "npub1zapstream"},
]

def extract_urls_from_content(content: str) -> List[str]:
    """מחלץ כתובות HTTPS מתוכן כלשהו (JS, HTML, MD)."""
    urls = re.findall(r'https://[^\s"\'`<>]+', content)
    # סינון רק כתובות שנראות כמו שרתים
    filtered = []
    for url in urls:
        url = url.rstrip('.,;:!?')  # ניקוי תווים מיותרים
        # חיפוש דומיינים רלוונטיים ל-Blossom/Nostr
        if any(domain in url.lower() for domain in [
            'blossom', 'nostr', 'satellite', 'void.cat', 'nostr.build', 
            'nostr.band', 'nostr.wine', 'zap.stream'
        ]):
            # הסרת query params ו-fragments
            clean_url = url.split('?')[0].split('#')[0]
            if len(clean_url) < 200:  # הגבלת אורך
                filtered.append(clean_url)
    return sorted(set(filtered))

def fetch_content_urls(base_url: str) -> List[str]:
    """מושך תוכן מכתובת ומחלץ כתובות."""
    try:
        r = requests.get(base_url, timeout=10)
        r.raise_for_status()
        return extract_urls_from_content(r.text)
    except Exception as e:
        print(f"[!] לא ניתן למשוך {base_url}: {e}")
        return []

def check_upload_endpoint(server: Dict[str, str]) -> Tuple[bool, str, float]:
    """בודק אם /upload זמין ומגיב בסדר גון, ומודד את מהירות התגובה."""
    url = server["url"].rstrip('/') + "/upload"
    start_time = time.time()
    
    try:
        # בדיקת HEAD קלה
        r1 = requests.head(url, timeout=8, allow_redirects=True)
        response_time = time.time() - start_time
        
        if r1.status_code == 401:
            # 401 זה לא כשלון! זה אומר שהשרת פעיל ודורש אימות (מצופה מ-Blossom)
            return True, f"HEAD {r1.status_code} (דורש auth - תקין)", response_time
        elif r1.status_code == 200:
            return True, f"HEAD {r1.status_code} (פעיל)", response_time
        elif r1.status_code in (404, 405):
            # נסה OPTIONS אם HEAD לא עובד
            start_time = time.time()
            r2 = requests.options(url, timeout=8, allow_redirects=True)
            response_time = time.time() - start_time
            if r2.status_code in (200, 405):
                return True, f"OPTIONS {r2.status_code}", response_time
            else:
                return False, f"OPTIONS {r2.status_code}", response_time
        else:
            return False, f"HEAD {r1.status_code}", response_time
    except Exception as e:
        try:
            # fallback לאחר OPTIONS
            start_time = time.time()
            r2 = requests.options(url, timeout=8, allow_redirects=True)
            response_time = time.time() - start_time
            if r2.status_code in (200, 405):
                return True, f"OPTIONS {r2.status_code}", response_time
            else:
                return False, f"OPTIONS {r2.status_code}", response_time
        except:
            response_time = time.time() - start_time
            return False, f"חריגה: {str(e)[:30]}", response_time

def main() -> None:
    print("🌸 Blossom Server Scanner")
    print("=" * 40)

    # איסוף כתובות ממקורות דינמיים
    dynamic_urls = []
    for src in KNOWN_SOURCES:
        if "*" in src:
            # ניסיון למצוא את ה-hash הנוכחי על ידי קריאת הדף הראשי וחיפוש assets/index-*.js
            try:
                page = requests.get("https://blossomservers.com/", timeout=10).text
                match = re.search(r'assets/index-([a-f0-9]+)\.js', page)
                if match:
                    src = src.replace("*", match.group(1))
            except Exception:
                pass
        dynamic_urls.extend(fetch_content_urls(src))

    # סינון רק כתובות שנראות כמו שרתי Blossom
    candidate_urls = [
        u for u in dynamic_urls
        if "blossom" in u.lower() or "nostr" in u.lower()
        and u.startswith("https://")
    ]

    # הוספת סטטיים
    static_urls = [s["url"] for s in STATIC_FALLBACKS]
    all_urls = sorted(set(candidate_urls + static_urls))

    print(f"\n🔍 נמצאו {len(all_urls)} כתובות מועמדות:")
    
    # הצגת מקורות
    print(f"\n📂 מקורות:")
    print(f"  מסריקה דינמית: {len(candidate_urls)} כתובות")
    print(f"  מרשימה סטטית: {len(static_urls)} כתובות")
    
    for u in all_urls:
        source = "🔍 דינמי" if u in candidate_urls else "📋 סטטי"
        print(f"  {source} - {u}")

    # בדיקת כל שרת
    results = []
    print("\n📡 בודק זמינות ומהירות...")
    for url in all_urls:
        server_info = next((s for s in STATIC_FALLBACKS if s["url"] == url), {"url": url, "pubkey": ""})
        ok, note, response_time = check_upload_endpoint(server_info)
        results.append({"url": url, "pubkey": server_info["pubkey"], "ok": ok, "note": note, "response_time": response_time})
        status = "✅" if ok else "❌"
        time_str = f"({response_time:.3f}s)" if ok else f"({response_time:.3f}s)"
        print(f"  {status} {url} – {note} {time_str}")

    # סידור תוצאות פעילות לפי מהירות
    alive = [r for r in results if r["ok"]]
    dead = [r for r in results if not r["ok"]]
    
    # מיון שרתים פעילים לפי זמן תגובה
    alive_sorted = sorted(alive, key=lambda x: x["response_time"])
    
    # טבלת תוצאות מסודרת
    print("\n" + "="*90)
    print("📊 טבלת תוצאות בדיקת שרתים (ממוין לפי מהירות)")
    print("="*90)
    print(f"{'שרת':<50} {'סטטוס':<8} {'זמן תגובה':<12} {'פירוט':<20}")
    print("-"*90)
    
    # הצגת שרתים פעילים קודם (ממוינים לפי מהירות)
    for result in alive_sorted:
        status_icon = "✅ פעיל"
        print(f"{result['url']:<50} {status_icon:<8} {result['response_time']:.3f}s{'':<7} {result['note']:<20}")
    
    # אז שרתים לא פעילים
    for result in dead:
        status_icon = "❌ נכשל"
        print(f"{result['url']:<50} {status_icon:<8} {result['response_time']:.3f}s{'':<7} {result['note']:<20}")
    
    print("="*90)

    # סיכום ופלט JSON
    alive = [r for r in results if r["ok"]]
    dead = [r for r in results if not r["ok"]]

    print(f"\n📊 סיכום: {len(alive)} פעילים, {len(dead)} לא פעילים")
    
    if alive_sorted:
        print(f"\n✅ שרתים מומלצים לעדכון blossom.js (מסודר לפי מהירות):")
        for i, s in enumerate(alive_sorted, 1):
            if s['pubkey']:
                print(f"  {i}. {{ url: '{s['url']}', pubkey: '{s['pubkey']}' }} - {s['response_time']:.3f}s")
            else:
                print(f"  {i}. {{ url: '{s['url']}' }} - {s['response_time']:.3f}s")

    # שמירת JSON עם מיון לפי מהירות
    out = {
        "timestamp": time.time(),
        "alive": alive_sorted,  # כבר ממוין לפי מהירות
        "dead": dead,
    }
    with open("blossom_servers_scan.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print("\n💾 נשמר ל blossom_servers_scan.json")

if __name__ == "__main__":
    main()
