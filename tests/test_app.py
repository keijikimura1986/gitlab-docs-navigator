import unittest
import os
import tempfile
from pathlib import Path

from fastapi.testclient import TestClient
from unittest.mock import patch

from app import (
    DocumentStore,
    GitLabError,
    GitLabClient,
    Settings,
    build_document_tree,
    find_group_readme,
    heading,
    load_dotenv,
    normalize,
    plain_text,
    app,
)


class DotenvTests(unittest.TestCase):
    def test_loads_values_and_preserves_existing_environment(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / ".env"
            path.write_text(
                "GITLAB_URL=https://gitlab.example.com\n"
                "GITLAB_GROUP='docs/team'\n"
                "IGNORED LINE\n",
                encoding="utf-8",
            )
            with patch.dict(os.environ, {"GITLAB_URL": "https://override.example.com"}, clear=True):
                load_dotenv(path)
                self.assertEqual(os.environ["GITLAB_URL"], "https://override.example.com")
                self.assertEqual(os.environ["GITLAB_GROUP"], "docs/team")


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_health(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])
        self.assertEqual(response.headers["cache-control"], "no-store")

    def test_missing_document(self):
        response = self.client.get("/api/doc", params={"id": "missing"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"error": "文書が見つかりません"})

    def test_unknown_api(self):
        response = self.client.get("/api/unknown")
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json(), {"error": "APIが見つかりません"})

    def test_fastapi_docs_are_available(self):
        response = self.client.get("/docs")
        self.assertEqual(response.status_code, 200)
        self.assertIn("swagger-ui", response.text)


class TextTests(unittest.TestCase):
    def test_normalize_handles_width_and_case(self):
        self.assertEqual(normalize("ＡＢＣ Test"), "abc test")

    def test_heading_uses_first_h1(self):
        self.assertEqual(heading("intro\n# My document\nbody", "fallback.md"), "My document")

    def test_plain_text_removes_markdown_decoration(self):
        self.assertIn("link", plain_text("## Title\n[a link](https://example.com)"))

    def test_document_tree_reflects_nested_directories(self):
        documents = [
            {"id": "1", "path": "README.md", "title": "Root"},
            {"id": "2", "path": "guide/setup/install.md", "title": "Install"},
            {"id": "3", "path": "guide/overview.md", "title": "Overview"},
        ]

        tree = build_document_tree(documents)

        self.assertEqual(tree[0]["path"], "README.md")
        self.assertEqual([node["name"] for node in tree if node["type"] == "directory"], ["guide"])
        guide = tree[1]
        self.assertEqual(guide["children"][0]["name"], "setup")
        self.assertEqual(guide["children"][1]["path"], "guide/overview.md")

    def test_document_tree_places_readme_first_case_insensitively(self):
        documents = [
            {"id": "1", "path": "guide/zebra.md", "title": "Zebra"},
            {"id": "2", "path": "guide/readme.mdx", "title": "Guide"},
            {"id": "3", "path": "guide/alpha.md", "title": "Alpha"},
        ]

        guide = build_document_tree(documents)[0]

        self.assertEqual(guide["children"][0]["path"], "guide/readme.mdx")
        self.assertEqual(guide["children"][1]["path"], "guide/alpha.md")


class ErrorTests(unittest.TestCase):
    def test_gitlab_error_preserves_status_code(self):
        error = GitLabError("GitLab API 404", status_code=404)
        self.assertEqual(error.status_code, 404)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = DocumentStore(Settings(gitlab_url="", token="", group="", link_branch="main"))

    def test_demo_tree_is_hierarchical(self):
        tree = self.store.tree()
        self.assertEqual(tree["source"], "demo")
        self.assertEqual(tree["branch"], "main")
        self.assertGreaterEqual(tree["stats"]["groups"], 3)
        self.assertEqual(tree["stats"]["documents"], 3)

    def test_document_includes_gitlab_link_branch(self):
        document = self.store.document("100:README.md")
        self.assertEqual(document["linkBranch"], "main")

    def test_refresh_can_switch_to_draft_branch(self):
        tree = self.store.load(force=True, branch="draft")
        self.assertEqual(tree["branch"], "draft")
        self.assertEqual(self.store.document("100:README.md")["linkBranch"], "draft")

    def test_search_requires_all_terms(self):
        results = self.store.search("デプロイ 手順")
        self.assertEqual(len(results), 1)
        self.assertEqual(results[0]["title"], "デプロイ手順")

    def test_search_is_nfkc_case_insensitive(self):
        results = self.store.search("ＰＯＬＩＣＹ")
        self.assertEqual(len(results), 1)

    def test_group_readme_uses_gitlab_profile_root_readme(self):
        projects = [
            {
                "path": "company/gitlab-profile",
                "groupPath": "company",
                "documents": [
                    {"id": "nested", "path": "guide/README.md"},
                    {"id": "home", "path": "README.md"},
                ],
            }
        ]

        self.assertEqual(find_group_readme("company", projects), "home")

    def test_group_readme_requires_direct_gitlab_profile_project(self):
        projects = [
            {
                "path": "company/subgroup/gitlab-profile",
                "groupPath": "company/subgroup",
                "documents": [{"id": "nested-home", "path": "README.md"}],
            }
        ]

        self.assertIsNone(find_group_readme("company", projects))


class SettingsTests(unittest.TestCase):
    def test_link_branch_defaults_to_main(self):
        with patch.dict(os.environ, {"GITLAB_LINK_BRANCH": "invalid"}):
            self.assertEqual(Settings(gitlab_url="", token="", group="").link_branch, "main")

    def test_link_branch_can_be_draft(self):
        with patch.dict(os.environ, {"GITLAB_LINK_BRANCH": "draft"}):
            self.assertEqual(Settings(gitlab_url="", token="", group="").link_branch, "draft")

    def test_public_gitlab_does_not_require_token(self):
        settings = Settings(
            gitlab_url="https://gitlab.com",
            token="",
            group="test5830230",
        )
        self.assertTrue(settings.configured)

    @patch("app.urllib.request.urlopen")
    def test_client_omits_empty_private_token_header(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = b"{}"
        client = GitLabClient(
            Settings(
                gitlab_url="https://gitlab.com",
                token="",
                group="test5830230",
            )
        )

        client.get("groups/test5830230")

        request = urlopen.call_args.args[0]
        self.assertNotIn("Private-token", request.headers)

    @patch("app.urllib.request.urlopen")
    def test_client_sends_configured_private_token(self, urlopen):
        response = urlopen.return_value.__enter__.return_value
        response.read.return_value = b"{}"
        client = GitLabClient(
            Settings(
                gitlab_url="https://gitlab.com",
                token="secret",
                group="test5830230",
            )
        )

        client.get("groups/test5830230")

        request = urlopen.call_args.args[0]
        self.assertEqual(request.headers["Private-token"], "secret")


if __name__ == "__main__":
    unittest.main()
