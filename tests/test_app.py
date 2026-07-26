import unittest

from unittest.mock import patch

from app import DocumentStore, GitLabClient, Settings, heading, normalize, plain_text


class TextTests(unittest.TestCase):
    def test_normalize_handles_width_and_case(self):
        self.assertEqual(normalize("ＡＢＣ Test"), "abc test")

    def test_heading_uses_first_h1(self):
        self.assertEqual(heading("intro\n# My document\nbody", "fallback.md"), "My document")

    def test_plain_text_removes_markdown_decoration(self):
        self.assertIn("link", plain_text("## Title\n[a link](https://example.com)"))


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


class SettingsTests(unittest.TestCase):
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
