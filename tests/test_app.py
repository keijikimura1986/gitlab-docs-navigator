import unittest

from unittest.mock import patch

from app import (
    DocumentStore,
    GitLabClient,
    Settings,
    build_document_tree,
    find_group_readme,
    heading,
    normalize,
    plain_text,
)


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


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.store = DocumentStore(Settings(gitlab_url="", token="", group=""))

    def test_demo_tree_is_hierarchical(self):
        tree = self.store.tree()
        self.assertEqual(tree["source"], "demo")
        self.assertGreaterEqual(tree["stats"]["groups"], 3)
        self.assertEqual(tree["stats"]["documents"], 3)

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
    def test_entra_requires_all_confidential_client_settings(self):
        self.assertTrue(Settings(
            entra_tenant_id="tenant",
            entra_client_id="client",
            entra_client_secret="secret",
        ).entra_enabled)
        self.assertFalse(Settings(
            entra_tenant_id="tenant",
            entra_client_id="client",
            entra_client_secret="",
        ).entra_enabled)

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
