"""GitLab Docs Navigator: dependency-free GitLab document index and web server."""

from __future__ import annotations

import json
import os
import re
import threading
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / "static"


class GitLabError(RuntimeError):
    pass


@dataclass(frozen=True)
class Settings:
    gitlab_url: str = os.getenv("GITLAB_URL", "").rstrip("/")
    token: str = os.getenv("GITLAB_TOKEN", "")
    group: str = os.getenv("GITLAB_GROUP", "")
    extensions: tuple[str, ...] = tuple(
        x.strip().lower()
        for x in os.getenv("DOC_EXTENSIONS", ".md,.mdx,.txt,.rst,.adoc").split(",")
        if x.strip()
    )
    max_bytes: int = int(os.getenv("DOC_MAX_BYTES", "1000000"))
    cache_ttl: int = int(os.getenv("CACHE_TTL_SECONDS", "300"))

    @property
    def configured(self) -> bool:
        return bool(self.gitlab_url and self.group)


class GitLabClient:
    def __init__(self, settings: Settings):
        self.settings = settings

    def get(self, path: str, params: dict[str, Any] | None = None) -> Any:
        query = urllib.parse.urlencode(params or {})
        url = f"{self.settings.gitlab_url}/api/v4/{path.lstrip('/')}"
        if query:
            url += "?" + query
        headers = {"User-Agent": "gitlab-docs-navigator/1.0"}
        if self.settings.token:
            headers["PRIVATE-TOKEN"] = self.settings.token
        request = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:300]
            raise GitLabError(f"GitLab API {exc.code}: {detail}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise GitLabError(f"GitLab APIへの接続に失敗しました: {exc}") from exc

    def pages(self, path: str, params: dict[str, Any] | None = None) -> list[Any]:
        result: list[Any] = []
        page = 1
        while True:
            values = self.get(path, {**(params or {}), "per_page": 100, "page": page})
            if not isinstance(values, list):
                raise GitLabError("GitLab APIから不正な一覧応答を受信しました")
            result.extend(values)
            if len(values) < 100:
                return result
            page += 1


def normalize(value: str) -> str:
    return unicodedata.normalize("NFKC", value).casefold()


def heading(content: str, fallback: str) -> str:
    match = re.search(r"^\s*#\s+(.+?)\s*$", content, re.MULTILINE)
    return match.group(1).strip() if match else fallback.rsplit("/", 1)[-1]


def plain_text(content: str) -> str:
    value = re.sub(r"```.*?```", " ", content, flags=re.DOTALL)
    value = re.sub(r"`([^`]+)`", r"\1", value)
    value = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", value)
    value = re.sub(r"\[([^\]]+)\]\([^)]+\)", r"\1", value)
    value = re.sub(r"[#>*_~|=-]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


class DocumentStore:
    def __init__(self, settings: Settings):
        self.settings = settings
        self._lock = threading.Lock()
        self._loaded_at = 0.0
        self._data: dict[str, Any] | None = None

    def load(self, force: bool = False) -> dict[str, Any]:
        with self._lock:
            if (
                not force
                and self._data is not None
                and time.time() - self._loaded_at < self.settings.cache_ttl
            ):
                return self._data
            self._data = self._fetch_gitlab() if self.settings.configured else self._demo()
            self._loaded_at = time.time()
            return self._data

    def _fetch_gitlab(self) -> dict[str, Any]:
        client = GitLabClient(self.settings)
        root = client.get(f"groups/{urllib.parse.quote(self.settings.group, safe='')}")
        groups = client.pages(f"groups/{root['id']}/descendant_groups")
        groups_by_id = {g["id"]: g for g in [root, *groups]}
        projects: dict[int, dict[str, Any]] = {}
        for group in groups_by_id.values():
            for project in client.pages(
                f"groups/{group['id']}/projects", {"include_subgroups": "false", "with_shared": "false"}
            ):
                projects[project["id"]] = project

        docs: dict[str, dict[str, Any]] = {}
        project_nodes: list[dict[str, Any]] = []
        for project in sorted(projects.values(), key=lambda x: x["path_with_namespace"].lower()):
            branch = project.get("default_branch")
            if not branch:
                continue
            files = client.pages(
                f"projects/{project['id']}/repository/tree",
                {"recursive": "true", "ref": branch},
            )
            project_docs = []
            for item in files:
                path = item.get("path", "")
                if item.get("type") != "blob" or not path.lower().endswith(self.settings.extensions):
                    continue
                if int(item.get("size", 0) or 0) > self.settings.max_bytes:
                    continue
                encoded_path = urllib.parse.quote(path, safe="")
                raw = client.get(
                    f"projects/{project['id']}/repository/files/{encoded_path}",
                    {"ref": branch},
                )
                import base64

                content = base64.b64decode(raw["content"]).decode("utf-8", errors="replace")
                doc_id = f"{project['id']}:{path}"
                doc = {
                    "id": doc_id,
                    "title": heading(content, path),
                    "path": path,
                    "project": project["name"],
                    "projectPath": project["path_with_namespace"],
                    "groupPath": project["namespace"]["full_path"],
                    "content": content,
                    "text": plain_text(content),
                    "webUrl": f"{project['web_url']}/-/blob/{urllib.parse.quote(branch)}/{urllib.parse.quote(path)}",
                    "updatedAt": project.get("last_activity_at"),
                }
                docs[doc_id] = doc
                project_docs.append(self._doc_summary(doc))
            project_nodes.append(
                {
                    "id": project["id"],
                    "name": project["name"],
                    "path": project["path_with_namespace"],
                    "groupPath": project["namespace"]["full_path"],
                    "webUrl": project["web_url"],
                    "documents": project_docs,
                }
            )
        return self._assemble(root["full_path"], root["name"], groups_by_id.values(), project_nodes, docs, "gitlab")

    @staticmethod
    def _doc_summary(doc: dict[str, Any]) -> dict[str, Any]:
        return {k: doc.get(k) for k in ("id", "title", "path", "webUrl", "updatedAt")}

    def _assemble(
        self,
        root_path: str,
        root_name: str,
        groups: Any,
        projects: list[dict[str, Any]],
        docs: dict[str, dict[str, Any]],
        source: str,
    ) -> dict[str, Any]:
        nodes = {
            g["full_path"]: {
                "id": g.get("id"),
                "name": g["name"],
                "path": g["full_path"],
                "groups": [],
                "projects": [],
            }
            for g in groups
        }
        nodes.setdefault(root_path, {"id": None, "name": root_name, "path": root_path, "groups": [], "projects": []})
        for path, node in sorted(nodes.items()):
            if path == root_path:
                continue
            parent = path.rsplit("/", 1)[0]
            if parent in nodes:
                nodes[parent]["groups"].append(node)
        for project in projects:
            if project["groupPath"] in nodes:
                nodes[project["groupPath"]]["projects"].append(project)
        return {
            "source": source,
            "root": nodes[root_path],
            "documents": docs,
            "stats": {"groups": len(nodes), "projects": len(projects), "documents": len(docs)},
        }

    def _demo(self) -> dict[str, Any]:
        samples = [
            ("100:README.md", "はじめに", "README.md", "platform", "company/platform", "# はじめに\n\nこのポータルでは社内文書を横断して確認できます。\n\n## 使い方\n\n左のナビゲーションか検索を利用してください。"),
            ("101:guides/deploy.md", "デプロイ手順", "guides/deploy.md", "operations", "company/platform/operations", "# デプロイ手順\n\n1. テストを実行します。\n2. 承認後に本番環境へデプロイします。\n\n> 障害時はロールバック手順を確認してください。"),
            ("102:policy/security.md", "セキュリティポリシー", "policy/security.md", "governance", "company/governance", "# セキュリティポリシー\n\nアクセストークンを文書やソースコードに記載しないでください。\n\n## レビュー\n\n四半期ごとに権限を見直します。"),
        ]
        docs, projects = {}, []
        for index, (doc_id, title, path, project, group_path, content) in enumerate(samples):
            doc = {"id": doc_id, "title": title, "path": path, "project": project, "projectPath": f"{group_path}/{project}", "groupPath": group_path, "content": content, "text": plain_text(content), "webUrl": "", "updatedAt": None}
            docs[doc_id] = doc
            projects.append({"id": 100 + index, "name": project, "path": doc["projectPath"], "groupPath": group_path, "webUrl": "", "documents": [self._doc_summary(doc)]})
        groups = [
            {"id": 1, "name": "Company Docs", "full_path": "company"},
            {"id": 2, "name": "Platform", "full_path": "company/platform"},
            {"id": 3, "name": "Operations", "full_path": "company/platform/operations"},
            {"id": 4, "name": "Governance", "full_path": "company/governance"},
        ]
        return self._assemble("company", "Company Docs", groups, projects, docs, "demo")

    def tree(self) -> dict[str, Any]:
        data = self.load()
        return {k: data[k] for k in ("source", "root", "stats")}

    def document(self, doc_id: str) -> dict[str, Any] | None:
        return self.load()["documents"].get(doc_id)

    def search(self, query: str, limit: int = 50) -> list[dict[str, Any]]:
        terms = [normalize(x) for x in re.findall(r'"([^"]+)"|(\S+)', query) for x in x if x]
        if not terms:
            return []
        results = []
        for doc in self.load()["documents"].values():
            fields = normalize(" ".join([doc["title"], doc["path"], doc["projectPath"], doc["text"]]))
            if not all(term in fields for term in terms):
                continue
            title_field = normalize(doc["title"])
            score = sum(8 if term in title_field else 2 for term in terms)
            pos = min((fields.find(term) for term in terms if term in fields), default=0)
            text = doc["text"]
            start = max(0, min(len(text), pos) - 80)
            excerpt = text[start : start + 240]
            results.append({**self._doc_summary(doc), "project": doc["project"], "projectPath": doc["projectPath"], "excerpt": excerpt, "score": score})
        return sorted(results, key=lambda x: (-x["score"], x["title"].lower()))[:limit]


SETTINGS = Settings()
STORE = DocumentStore(SETTINGS)


class Handler(SimpleHTTPRequestHandler):
    def translate_path(self, path: str) -> str:
        relative = urllib.parse.urlparse(path).path.lstrip("/") or "index.html"
        return str(STATIC_DIR / relative)

    def _json(self, payload: Any, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        try:
            if parsed.path == "/api/health":
                self._json({"ok": True, "configured": SETTINGS.configured})
            elif parsed.path == "/api/tree":
                self._json(STORE.tree())
            elif parsed.path == "/api/doc":
                doc_id = urllib.parse.parse_qs(parsed.query).get("id", [""])[0]
                doc = STORE.document(doc_id)
                self._json(doc if doc else {"error": "文書が見つかりません"}, HTTPStatus.OK if doc else HTTPStatus.NOT_FOUND)
            elif parsed.path == "/api/search":
                query = urllib.parse.parse_qs(parsed.query).get("q", [""])[0].strip()
                self._json({"query": query, "results": STORE.search(query)})
            elif parsed.path.startswith("/api/"):
                self._json({"error": "APIが見つかりません"}, HTTPStatus.NOT_FOUND)
            else:
                super().do_GET()
        except GitLabError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)
        except Exception:
            self._json({"error": "サーバー内部でエラーが発生しました"}, HTTPStatus.INTERNAL_SERVER_ERROR)

    def do_POST(self) -> None:
        if urllib.parse.urlparse(self.path).path != "/api/refresh":
            self._json({"error": "APIが見つかりません"}, HTTPStatus.NOT_FOUND)
            return
        try:
            self._json(STORE.load(force=True) and STORE.tree())
        except GitLabError as exc:
            self._json({"error": str(exc)}, HTTPStatus.BAD_GATEWAY)

    def log_message(self, fmt: str, *args: Any) -> None:
        print(f"[web] {self.address_string()} {fmt % args}")


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1")
    port = int(os.getenv("PORT", "8000"))
    print(f"GitLab Docs Navigator: http://{host}:{port} ({'GitLab' if SETTINGS.configured else 'demo'} mode)")
    ThreadingHTTPServer((host, port), Handler).serve_forever()


if __name__ == "__main__":
    main()
