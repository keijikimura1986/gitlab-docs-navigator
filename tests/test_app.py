import unittest

from app import DocumentStore, Settings, heading, normalize, plain_text


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


if __name__ == "__main__":
    unittest.main()
