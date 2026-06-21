#!/usr/bin/env python3
"""
财联社文章获取工具
==================
通用脚本，通过 JS 子进程调用获取指定主题的文章数据。

用法：
  python quantum_cls.py --topic "连板股分析"
  python quantum_cls.py --topic "涨停信息" --date 20260417
  python quantum_cls.py --topic "午间涨停分析"

输出 JSON：{ title, content, image1, image2, date, article_id, topic }
"""

import sys
import os
import json
import re
import hashlib
import argparse
import akshare as ak
import pandas as pd
import requests
from datetime import datetime

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")

DEBUG = os.environ.get("DEBUG") == "1"

def log(*args):
    if DEBUG:
        print("[quantum_cls]", *args, file=sys.stderr)

# ──────────── 交易日判断 ────────────

_trade_dates = None

def is_trade_day(d):
    global _trade_dates
    if _trade_dates is None:
        df = ak.tool_trade_date_hist_sina()
        df["trade_date"] = pd.to_datetime(df["trade_date"])
        _trade_dates = set(df["trade_date"].dt.date.tolist())
    return d.date() in _trade_dates


# ──────────── 签名工具 ────────────

def cls_sign(params):
    sorted_params = sorted(params.items())
    param_str = "&".join(f"{k}={v}" for k, v in sorted_params)
    sha1 = hashlib.sha1(param_str.encode()).hexdigest()
    return hashlib.md5(sha1.encode()).hexdigest()


# ──────────── 财联社 API ────────────

def search_article(keyword):
    params = {
        "app": "cailianpress",
        "sv": "7.8.9",
        "os": "android",
        "keyword": keyword,
        "type": "telegram",
        "rn": "20",
        "page": "0",
    }
    params["sign"] = cls_sign(params)
    headers = {"User-Agent": "Mozilla/5.0 (Linux; Android 11; M2102K1C) AppleWebKit/537.36"}
    resp = requests.get(
        "https://appsearch.cls.cn/api/search/get_all_list",
        params=params, headers=headers, timeout=15,
    ).json()
    items = resp.get("data", {}).get("telegram", {}).get("data", [])
    if not items:
        return None
    return {"id": items[0].get("id"), "descr": items[0].get("descr", "")}


def fetch_detail(article_id):
    params = {"appName": "CailianpressWeb", "os": "web", "sv": "8.7.9"}
    params["sign"] = cls_sign(params)
    headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"}
    resp = requests.get(
        f"https://www.cls.cn/v3/article/detail/{article_id}",
        params=params, headers=headers, timeout=15,
    ).json()
    data = resp.get("data", {})
    if not data:
        log(f"article {article_id}: no data in response, keys={list(resp.keys())}")
        return {"title": "", "content": "", "images": []}

    log(f"article {article_id}: keys={list(data.keys())}")
    log(f"article {article_id}: img={data.get('img')!r}")
    log(f"article {article_id}: images={data.get('images')!r}")
    log(f"article {article_id}: share_img={data.get('share_img')!r}")
    for k in list(data.keys()):
        v = data[k]
        if isinstance(v, str) and ("http" in v or "image" in v.lower()):
            log(f"article {article_id}: potential image field {k}={v[:120]}")

    title = data.get("title", "")
    content = data.get("content", "")
    raw_img = data.get("img") or ""

    images = []
    if raw_img and raw_img.startswith("http"):
        # 可能有多张图片，逗号分隔
        parts = [u.strip() for u in raw_img.split(",") if u.strip().startswith("http")]
        images = parts
        if len(parts) > 1:
            log(f"article {article_id}: split {len(parts)} images from img field")
    else:
        log(f"article {article_id}: img value not a URL, ignoring: {raw_img[:100]}")

    log(f"article {article_id}: returning images={images}")
    return {"title": title, "content": content, "images": images}


# ──────────── 主入口 ────────────

def main():
    parser = argparse.ArgumentParser(description="财联社文章获取")
    parser.add_argument("--topic", default=None, help="文章主题，如：连板股分析、涨停信息、午间涨停分析")
    parser.add_argument("--date", default=None, help="日期 YYYYMMDD，默认自动从 command/env 中解析或取今天")
    args = parser.parse_args()

    # 确定 topic
    cmd = os.environ.get("command", "").strip()
    topic = args.topic
    if not topic:
        # 从 command 中推断：去掉日期部分即为 topic
        cleaned = re.sub(r"(20|19)?\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])", "", cmd).strip()
        topic = cleaned if cleaned else "连板股分析"

    # 确定日期
    target_date = None
    if args.date:
        target_date = datetime.strptime(args.date, "%Y%m%d")
    else:
        match = re.search(r"(20|19)?\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])", cmd.replace("-", "").replace("/", ""))
        if match:
            raw = match.group(0)
            if len(raw) == 6:
                raw = "20" + raw
            target_date = datetime.strptime(raw, "%Y%m%d")
        else:
            target_date = datetime.now()

    date_label = target_date.strftime("%Y%m%d")

    if not is_trade_day(target_date):
        print(json.dumps({"error": f"{target_date.strftime('%Y-%m-%d')} 非A股交易日", "date": date_label, "topic": topic}))
        sys.exit(0)

    keyword = f"{target_date.month}月{target_date.day}日{topic}"
    log(f"searching: keyword={keyword}, date={date_label}")

    result = search_article(keyword)
    if not result:
        log("search returned no results")
        print(json.dumps({"error": f"未找到 {date_label} 的{topic}文章", "date": date_label, "topic": topic}))
        sys.exit(0)
    log(f"found article: id={result['id']}")

    detail = fetch_detail(result["id"])
    if not detail["title"]:
        log("detail fetch returned no title")
        print(json.dumps({"error": f"获取文章详情失败: {result['id']}", "date": date_label, "topic": topic}))
        sys.exit(0)

    images = detail["images"]
    image1 = images[0] if len(images) > 0 else ""
    image2 = images[1] if len(images) > 1 else ""
    log(f"output: image1={'set' if image1 else 'empty'}, image2={'set' if image2 else 'empty'}")
    if image1:
        log(f"output: image1_url={image1[:120]}")

    output = {
        "date": date_label,
        "topic": topic,
        "title": detail["title"],
        "content": detail["content"],
        "image1": image1,
        "image2": image2,
        "article_id": result["id"],
    }
    log("output json to stdout")
    print(json.dumps(output, ensure_ascii=False))


if __name__ == "__main__":
    main()