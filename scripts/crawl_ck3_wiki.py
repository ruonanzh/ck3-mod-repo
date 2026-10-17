#!/usr/bin/env python3
"""Incrementally sync the CK3 wiki into docs/mod-wiki/ (committed to the repo).

Feeds the local knowledge layer. Output is *not* committed - it is
regenerated on demand and requires network access plus, only when pages
actually changed, the `markitdown` converter:

    uv run --with markitdown python scripts/crawl_ck3_wiki.py

Default scope is the **kept mod-API topics** (KEEP_TOPICS — the directories committed
under docs/mod-wiki/, see docs-organization.md). Pass --all-content for the whole
wiki; --pages-file / --category narrow further.

Compliance (ck3.paradoxwikis.com robots.txt asks `Crawl-delay: 15`; MediaWiki
API etiquette asks for maxlag + an identifiable User-Agent):

- **Domain-level rate limit.** Every request waits >= 15s since the previous
  request to the host, tracked in a machine-level state file
  (``~/.cache/paradox-wiki-crawl/<host>.json``) shared by any tool using the
  same convention. ``--min-interval`` can only raise this, never lower it.
- **No parallel crawls.** A lock file next to the state file rejects a second
  concurrent run (stale locks expire after ``--stale-lock-minutes``).
- **maxlag=5** on every API request, plus a fixed contactable User-Agent.
- **Incremental.** One batched ``prop=revisions`` query fetches all revids;
  only pages whose revid changed (or whose file is missing) are downloaded
  via ``action=parse``. A typical refresh is therefore a single request.
- **Abort on block.** HTTP 403/408/429/5xx or a maxlag API error stops the
  round immediately (no retry), records ``blocked_until`` (Retry-After or
  300s default), and exits 3. The next run refuses to start until then.

Modes: default = incremental keep-topics sync; ``--all-content`` = whole wiki; ``--check-only`` = report changed
pages (one request, no downloads); ``--full`` = force re-download of every in-scope
page; ``--pages-file`` = sync only listed titles; ``--category`` = sync one category's
members; ``--discover`` = list Category:Modding members (nothing saved).
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

DEFAULT_HOST = "ck3.paradoxwikis.com"
USER_AGENT = "ck3-mod-agent/2.0 (https://github.com/ruonanzh; roronoazaoxl@gmail.com) python-urllib"
MIN_INTERVAL_S = 15.0  # robots.txt Crawl-delay: 15 - hard floor, never lowered
DEFAULT_BLOCK_S = 300.0  # blocked_until fallback when no Retry-After is given
STATE_DIR = Path.home() / ".cache" / "paradox-wiki-crawl"

# Optional hand-picked allowlist; the default scope is the whole wiki content
# namespace, so this list only matters when you pass --pages-file's legacy
# behavior or want a quick curated subset. Kept for reference.
PAGES: tuple[str, ...] = ()


class BlockedError(Exception):
    """Server asked us to back off (HTTP block code or maxlag); stop the round."""

    def __init__(self, reason: str, retry_after_s: float):
        super().__init__(reason)
        self.retry_after_s = retry_after_s


# --- repo root ---


def find_repo_root(start: Path) -> Path:
    p = start.resolve()
    for _ in range(20):
        if (p / "mod-repo.json").is_file():
            return p
        if p.parent == p:
            break
        p = p.parent
    return start.resolve()


# --- machine-level rate limiter + run lock (shared per host) ---


class HostGate:
    """Serializes wiki access across processes: >=interval between requests, one runner."""

    def __init__(self, host: str, interval_s: float, stale_lock_s: float):
        self.interval_s = max(interval_s, MIN_INTERVAL_S)
        self.state_path = STATE_DIR / f"{host}.json"
        self.lock_path = STATE_DIR / f"{host}.lock"
        self.stale_lock_s = stale_lock_s
        self._locked = False
        STATE_DIR.mkdir(parents=True, exist_ok=True)

    def _read_state(self) -> dict:
        try:
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return {}

    def _write_state(self, **updates: float) -> None:
        state = self._read_state()
        state.update(updates)
        tmp = self.state_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(state), encoding="utf-8")
        tmp.replace(self.state_path)

    def blocked_for_s(self) -> float:
        """Seconds until blocked_until expires (0 when not blocked)."""
        return max(0.0, float(self._read_state().get("blocked_until", 0.0)) - time.time())

    def record_block(self, retry_after_s: float) -> None:
        self._write_state(blocked_until=time.time() + retry_after_s)

    def acquire_lock(self) -> bool:
        try:
            fd = os.open(self.lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
        except FileExistsError:
            try:
                age = time.time() - self.lock_path.stat().st_mtime
            except OSError:
                return False  # lock vanished mid-check; caller may simply retry later
            if age <= self.stale_lock_s:
                return False
            self.lock_path.unlink(missing_ok=True)  # stale (crashed run); reclaim
            return self.acquire_lock()
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(f"pid={os.getpid()} started={datetime.now(timezone.utc).isoformat()}\n")
        self._locked = True
        return True

    def release_lock(self) -> None:
        if self._locked:
            self.lock_path.unlink(missing_ok=True)
            self._locked = False

    def wait_turn(self) -> None:
        """Block until >=interval since the last request to this host (any process)."""
        while True:
            last = float(self._read_state().get("last_request_ts", 0.0))
            wait = last + self.interval_s - time.time()
            if wait <= 0:
                return
            time.sleep(min(wait, self.interval_s))

    def mark_request(self) -> None:
        self._write_state(last_request_ts=time.time())


# --- MediaWiki API client ---


def api_get(gate: HostGate, host: str, params: dict, timeout: float) -> dict:
    """One rate-limited API request. Raises BlockedError on block/maxlag.

    Network errors (timeout/reset) are retried up to 3 attempts at the crawl
    interval, since a single flaky request must not kill a multi-hour crawl.
    """
    query = dict(params)
    query.update({"format": "json", "formatversion": "2", "maxlag": "5"})
    url = f"https://{host}/api.php?" + urlencode(query)
    body: bytes | None = None
    for attempt in range(3):
        gate.wait_turn()
        req = Request(url, headers={"User-Agent": USER_AGENT})
        try:
            with urlopen(req, timeout=timeout) as resp:  # noqa: S310 (fixed trusted host)
                body = resp.read()
            break
        except HTTPError as e:
            if e.code in (403, 408, 429) or e.code >= 500:
                retry_after = _parse_retry_after(e.headers.get("Retry-After"))
                raise BlockedError(f"HTTP {e.code} from {host}", retry_after) from e
            raise
        except (URLError, TimeoutError, OSError) as e:
            if attempt == 2:
                raise
            sys.stderr.write(f"[retry] network error (attempt {attempt + 1}/3): {e}\n")
            time.sleep(gate.interval_s)
        finally:
            gate.mark_request()  # any attempt counts against the crawl-delay budget
    assert body is not None
    data = json.loads(body)
    err = data.get("error")
    if err:
        if err.get("code") == "maxlag":
            raise BlockedError(f"maxlag: {err.get('info', 'server lagged')}", DEFAULT_BLOCK_S)
        raise RuntimeError(f"API error {err.get('code')}: {err.get('info')}")
    return data


def _parse_retry_after(value: str | None) -> float:
    if not value:
        return DEFAULT_BLOCK_S
    try:
        return max(float(value), MIN_INTERVAL_S)
    except ValueError:
        return DEFAULT_BLOCK_S  # HTTP-date form; use the conservative default


def query_revisions(gate: HostGate, host: str, titles: list[str], timeout: float) -> dict[str, int]:
    """Batched revid lookup. Returns {requested_title: revid}; missing pages are omitted."""
    revids: dict[str, int] = {}
    for i in range(0, len(titles), 50):  # API caps titles= at 50 for anonymous clients
        batch = titles[i : i + 50]
        data = api_get(
            gate,
            host,
            {"action": "query", "prop": "revisions", "rvprop": "ids",
             "titles": "|".join(batch), "redirects": "1"},
            timeout,
        )
        q = data.get("query", {})
        # Map returned titles back to our requested underscore form, through
        # both normalization ("Foo bar" -> "Foo_bar") and redirect resolution.
        denorm = {n["to"]: n["from"] for n in q.get("normalized", [])}
        for r in q.get("redirects", []):
            denorm[r["to"]] = denorm.get(r["from"], r["from"])
        for page in q.get("pages", []):
            title = page.get("title", "")
            requested = denorm.get(title, title.replace(" ", "_")).replace(" ", "_")
            if page.get("missing"):
                sys.stderr.write(f"[missing] {requested} does not exist on {host}\n")
                continue
            revs = page.get("revisions") or []
            if revs:
                revids[requested] = int(revs[0]["revid"])
    return revids


def fetch_page_html(gate: HostGate, host: str, title: str, timeout: float) -> str:
    """Article body HTML only (action=parse) - no site chrome/nav."""
    data = api_get(
        gate,
        host,
        {"action": "parse", "page": title, "prop": "text", "redirects": "1",
         "disableeditsection": "1", "disabletoc": "1"},
        timeout,
    )
    return data["parse"]["text"]


def query_all_content(gate: HostGate, host: str, timeout: float) -> dict[str, list[str]]:
    """All non-redirect articles in the content namespace, mapped to category names (no Category: prefix).

    Two stages: (1) titles via paged ``allpages``; (2) categories via batched
    ``prop=categories`` — ``allpages&aprop=categories`` is unreliable on this wiki.
    """
    titles: list[str] = []
    params: dict = {
        "action": "query", "list": "allpages", "apnamespace": "0",
        "aplimit": "500", "apfilterredir": "nonredirects",
    }
    while True:
        data = api_get(gate, host, dict(params), timeout)
        for p in data.get("query", {}).get("allpages", []):
            titles.append(p["title"].replace(" ", "_"))
        cont = data.get("continue", {})
        if not cont:
            break
        params.update(cont)

    pages: dict[str, list[str]] = {}
    for i in range(0, len(titles), 50):
        batch = titles[i : i + 50]
        data = api_get(
            gate, host,
            {"action": "query", "prop": "categories", "titles": "|".join(batch), "cllimit": "500"},
            timeout,
        )
        denorm = {n["to"].replace(" ", "_"): n["from"].replace(" ", "_") for n in data.get("query", {}).get("normalized", [])}
        for rd in data.get("query", {}).get("redirects", []):
            denorm[rd["to"].replace(" ", "_")] = denorm.get(rd["from"].replace(" ", "_"), rd["from"].replace(" ", "_"))
        for p in data.get("query", {}).get("pages", []):
            t = p.get("title", "").replace(" ", "_")
            key = denorm.get(t, t)
            pages[key] = [c["title"].replace("Category:", "", 1).replace(" ", "_") for c in p.get("categories", [])]
    return pages


def query_category_members(gate: HostGate, host: str, category: str, timeout: float) -> list[str]:
    """Article titles directly in one category (no subcategory recursion)."""
    titles: list[str] = []
    params: dict = {
        "action": "query", "list": "categorymembers", "cmtitle": f"Category:{category}",
        "cmlimit": "500", "cmtype": "page",
    }
    while True:
        data = api_get(gate, host, dict(params), timeout)
        for m in data.get("query", {}).get("categorymembers", []):
            titles.append(m["title"].replace(" ", "_"))
        cont = data.get("continue", {})
        if not cont:
            break
        params.update(cont)
    return titles


# Non-topic (maintenance/asset/year) categories to skip when choosing a page's
# home directory; the first remaining category becomes the directory name.
_NON_TOPIC_CAT_RE = re.compile(
    r"icons?$|images?$|lists?$|templates?$|modules?$|documentation$|"
    r"compilation|expand$|disambiguation|stubs?$|candidates for deletion|timeless|pre-release|"
    r"potentially outdated|requiring verification|"
    r"^needs? |^pages |^articles? |adapted from|generated with|"
    r"parser tag|broken file|unrecognized|autogenerated|^\d+(\.\d+)?$",
    re.IGNORECASE,
)


def topic_category(categories: list[str]) -> str | None:
    """First category that looks like a content topic (not icons/images/lists/…); None if none."""
    for cat in categories:
        if not _NON_TOPIC_CAT_RE.search(cat.replace("_", " ")):
            return cat
    return None


# 保留的 wiki 主题分类（mod API/机制目录，见 docs-organization.md §2.1）。
# 默认 scope 只 sync 这些分类；--all-content 才全站。
KEEP_TOPICS = frozenset({
    "Modding", "Game_concepts", "Estates", "Economy", "Laws",
    "Ages", "Government", "Interface", "Modding_tools",
})


def save_categories_index(out_dir: Path, pages: dict[str, list[str]]) -> None:
    tmp = out_dir / "categories.json.tmp"
    tmp.write_text(json.dumps(pages, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(out_dir / "categories.json")


def reclassify_local(out_dir: Path) -> None:
    """Re-home already-downloaded files by the current topic_category rules.

    Pure local operation (reads categories.json, moves .md files); no network.
    """
    index_path = out_dir / "categories.json"
    try:
        pages = json.loads(index_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        sys.stderr.write(f"No categories.json at {index_path}; run a sync first.\n")
        return
    moved = 0
    for title, cats in pages.items():
        slug = _slug(title)
        topic = topic_category(cats)
        target_dir = out_dir / (_slug(topic) if topic else "_uncategorized")
        src = next((f for f in out_dir.rglob(f"{slug}.md")), None)
        if src is None or src.parent == target_dir:
            continue
        target_dir.mkdir(parents=True, exist_ok=True)
        src.rename(target_dir / f"{slug}.md")
        moved += 1
    print(f"Reclassified {moved} file(s) under {out_dir}.")


# --- markdown conversion + output ---


def _slug(title: str) -> str:
    s = title.replace("/", "__")
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")
    return s or "page"


def to_markdown(md_converter, html_fragment: str) -> str | None:
    html = f"<html><body>{html_fragment}</body></html>"
    try:
        result = md_converter.convert_stream(io.BytesIO(html.encode("utf-8")), file_extension=".html")
    except Exception as e:  # noqa: BLE001
        sys.stderr.write(f"[warn] markitdown failed: {e}\n")
        return None
    return getattr(result, "text_content", None) or getattr(result, "markdown", None)


_IMG_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")


def clean_markdown(md: str) -> str:
    """Remove wiki maintenance noise: version banners, ambox templates, image links."""
    out: list[str] = []
    for line in md.split("\n"):
        # 版本横幅 / 维护请求（表格内外都是噪音）
        if (
            "Please help with verifying" in line
            or "last verified for" in line
            or "Please help improve" in line
            or "Please help expand" in line
        ):
            continue
        # 图片链接：先去掉普通 ![alt](url)；再处理数学公式等 alt 含特殊字符的图片
        line = _IMG_RE.sub("", line)
        line = re.sub(r"!\[[^\n]*?en\.wikipedia\.org/api/rest_v1/media/math[^\n]*\)", "", line)
        # 空链接（markitdown 把 [[File:...]] 转成 [](url)，无文字价值）
        line = re.sub(r"\[\]\([^)\n]*\)", "", line)
        s = line.strip()
        # 去图后只剩空白 / 空表格单元格 / 表格分隔符 → 整行跳过
        if s == "" or re.fullmatch(r"\|[\s|:—-]*\|", s):
            continue
        out.append(line)
    text = "\n".join(out)
    # 压缩连续空行为一个空行
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip() + "\n"


def load_revcache(path: Path) -> dict:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}


def save_revcache(path: Path, cache: dict) -> None:
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(cache, indent=1, sort_keys=True), encoding="utf-8")
    tmp.replace(path)


# --- main ---


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Incremental, rate-limited CK3 wiki sync (full-wiki content by default).")
    parser.add_argument("--host", default=DEFAULT_HOST, help="wiki host (default: %(default)s)")
    parser.add_argument("--out", help="output dir (default: <repo>/docs/mod-wiki)")
    parser.add_argument("--pages-file", help="file with one article title per line (narrow scope)")
    parser.add_argument("--category", help="sync only this category's direct members (narrow scope)")
    parser.add_argument("--all-content", action="store_true",
                        help="sync the whole wiki content namespace (instead of the default KEEP_TOPICS)")
    parser.add_argument("--min-interval", type=float, default=MIN_INTERVAL_S,
                        help="seconds between requests; clamped to >= %(default)s (robots.txt Crawl-delay)")
    parser.add_argument("--timeout", type=float, default=30.0, help="per-request timeout seconds")
    parser.add_argument("--stale-lock-minutes", type=float, default=120.0,
                        help="reclaim the run lock after this many minutes (default: %(default)s)")
    parser.add_argument("--check-only", action="store_true", help="one revision query; report changes, download nothing")
    parser.add_argument("--full", action="store_true", help="re-download every page (still rate-limited)")
    parser.add_argument("--discover", action="store_true",
                        help="list Category:Modding members (nothing saved)")
    parser.add_argument("--reclassify", action="store_true",
                        help="re-home already-downloaded files by current topic rules (local, no network)")
    args = parser.parse_args(argv)

    host = args.host
    repo_root = find_repo_root(Path(__file__).resolve().parent)
    out_dir = Path(args.out) if args.out else repo_root / "docs" / "mod-wiki"

    if args.reclassify:
        reclassify_local(out_dir)
        return 0

    titles: list[str] = []  # resolved after acquiring the host gate (scope may need API calls)

    gate = HostGate(host, args.min_interval, args.stale_lock_minutes * 60.0)

    blocked = gate.blocked_for_s()
    if blocked > 0:
        sys.stderr.write(
            f"{host} previously asked us to back off; blocked for another {blocked / 60.0:.1f} min. "
            "Re-run after that.\n"
        )
        return 3

    if not gate.acquire_lock():
        sys.stderr.write(
            f"Another wiki sync against {host} is already running (lock: {gate.lock_path}). "
            "Parallel crawls are disabled; re-run later.\n"
        )
        return 3

    try:
        pages: dict[str, list[str]] = {}
        if args.pages_file:
            titles = [ln.strip() for ln in Path(args.pages_file).read_text(encoding="utf-8").splitlines()
                      if ln.strip() and not ln.strip().startswith("#")]
            pages = {t: [] for t in titles}
        elif args.category:
            titles = query_category_members(gate, host, args.category, args.timeout)
            pages = {t: [args.category] for t in titles}
        elif PAGES:
            titles = list(PAGES)
            pages = {t: [] for t in titles}
        else:
            pages = query_all_content(gate, host, args.timeout)
            if not args.all_content:
                pages = {t: cats for t, cats in pages.items() if topic_category(cats) in KEEP_TOPICS}
            titles = list(pages)
            print(f"{'Keep-topics' if not args.all_content else 'All-content'} scope: {len(titles)} article(s) on {host}")
        if not titles:
            sys.stderr.write("Empty scope; nothing to fetch.\n")
            return 2

        if args.discover:
            data = api_get(
                gate, host,
                {"action": "query", "list": "categorymembers", "cmtitle": "Category:Modding",
                 "cmlimit": "500", "cmtype": "page"},
                args.timeout,
            )
            members = [m["title"].replace(" ", "_") for m in data.get("query", {}).get("categorymembers", [])]
            print(f"Category:Modding members ({len(members)}):")
            for t in members:
                print(f"  {t}")
            return 0

        revcache_path = out_dir / ".revisions.json"
        revcache = load_revcache(revcache_path)

        print(f"Checking revisions for {len(titles)} page(s) on {host} ...")
        remote = query_revisions(gate, host, titles, args.timeout)

        def is_stale(title: str) -> bool:
            if args.full:
                return True
            return revcache.get(title, {}).get("revid") != remote.get(title)

        stale = [t for t in titles if t in remote and is_stale(t)]

        if args.check_only:
            if stale:
                print(f"{len(stale)} page(s) changed or missing locally:")
                for t in stale:
                    print(f"  {t} (revid {revcache.get(t, {}).get('revid')} -> {remote[t]})")
            else:
                print("All pages up to date.")
            return 0

        if not stale:
            print("All pages up to date; nothing downloaded (1 request total).")
            return 0

        try:
            from markitdown import MarkItDown  # type: ignore
        except ImportError:
            sys.stderr.write(
                "markitdown is required to convert changed pages. Easiest:\n"
                "  uv run --with markitdown python .agents/skills/ck3-lint-mod/scripts/crawl_ck3_wiki.py\n"
                "  # or: pip install markitdown\n"
            )
            return 2
        md_converter = MarkItDown()
        out_dir.mkdir(parents=True, exist_ok=True)

        eta_min = len(stale) * gate.interval_s / 60.0
        print(f"{len(stale)} page(s) to download at >= {gate.interval_s:.0f}s intervals (~{eta_min:.0f} min) ...")
        synced = 0
        for title in stale:
            try:
                html = fetch_page_html(gate, host, title, args.timeout)
                markdown = to_markdown(md_converter, html)
                if markdown:
                    markdown = clean_markdown(markdown)
            except (URLError, TimeoutError, OSError) as e:
                sys.stderr.write(f"[skip] {title}: network error ({e})\n")
                continue
            if not markdown:
                sys.stderr.write(f"[skip] {title}: conversion produced no text\n")
                continue
            cat = topic_category(pages.get(title, []))
            subdir = _slug(cat) if cat else "_uncategorized"
            dest_dir = out_dir / subdir
            dest_dir.mkdir(parents=True, exist_ok=True)
            url = f"https://{host}/{title}"
            fetched = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            header = f"<!-- source: {url} revid: {remote[title]} fetched: {fetched} -->\n# {title.replace('_', ' ')}\n\n"
            (dest_dir / f"{_slug(title)}.md").write_text(header + markdown, encoding="utf-8")
            revcache[title] = {"revid": remote[title], "fetched": fetched}
            save_revcache(revcache_path, revcache)
            synced += 1
            print(f"[saved] {subdir}/{_slug(title)} (revid {remote[title]})")
        save_categories_index(out_dir, pages)

        print(f"\nDone: {synced}/{len(stale)} page(s) synced; output: {out_dir}")
        return 0

    except BlockedError as e:
        gate.record_block(e.retry_after_s)
        sys.stderr.write(
            f"\nServer signalled a block ({e}); stopping this round immediately (no retry). "
            f"Backing off for {e.retry_after_s / 60.0:.1f} min (recorded in {gate.state_path}).\n"
        )
        return 3
    except URLError as e:
        sys.stderr.write(f"Network error: {e}\n")
        return 2
    finally:
        gate.release_lock()


if __name__ == "__main__":
    raise SystemExit(main())
