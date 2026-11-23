const test = require("node:test");
const assert = require("node:assert/strict");

const {
  decodeHtmlReferences,
  hasBlockedScheme,
  parseInlineLinks
} = require("../static/markdown-links.js");

function compact(source) {
  return parseInlineLinks(source).map(({ end, ...node }) => node);
}

test("parses balanced parentheses in Markdown link destinations", () => {
  assert.deepEqual(compact("See [doc](guide/foo(bar).md)."), [
    { type: "text", value: "See " },
    { type: "link", label: "doc", destination: "guide/foo(bar).md", title: "" },
    { type: "text", value: "." }
  ]);
});

test("parses nested and escaped parentheses with an optional title", () => {
  assert.deepEqual(compact("[doc](guide/foo(bar(baz)).md \"Guide\")"), [
    { type: "link", label: "doc", destination: "guide/foo(bar(baz)).md", title: "Guide" }
  ]);
  assert.equal(compact("[doc](guide/foo\\(bar\\).md)")[0].destination, "guide/foo(bar).md");
});

test("parses angle-bracket destinations and image destinations", () => {
  assert.deepEqual(compact("[doc](<guide/foo (bar).md> 'Guide')"), [
    { type: "link", label: "doc", destination: "guide/foo (bar).md", title: "Guide" }
  ]);
  assert.deepEqual(compact("![diagram](images/flow(v2).png)"), [
    { type: "image", label: "diagram", destination: "images/flow(v2).png", title: "" }
  ]);
});

test("unescapes punctuation in labels and preserves empty destinations", () => {
  assert.equal(compact("[a\\]b](https://example.com)")[0].label, "a]b");
  assert.equal(compact("[same page]()")[0].destination, "");
  assert.deepEqual(compact("[same page]( \"Current\")"), [
    { type: "link", label: "same page", destination: "", title: "Current" }
  ]);
  assert.equal(compact("[share](\\\\server\\share)")[0].destination, "\\\\server\\share");
  assert.equal(compact("[drive](C:\\Docs\\guide.md)")[0].destination, "C:\\Docs\\guide.md");
});

test("keeps balanced URL parentheses and excludes surrounding punctuation", () => {
  assert.deepEqual(compact("See (https://example.com/a_(b)). 次。"), [
    { type: "text", value: "See (" },
    { type: "autolink", label: "https://example.com/a_(b)", destination: "https://example.com/a_(b)", title: "" },
    { type: "text", value: "). 次。" }
  ]);
  assert.deepEqual(compact("https://example.com/path?!。"), [
    { type: "autolink", label: "https://example.com/path", destination: "https://example.com/path", title: "" },
    { type: "text", value: "?!。" }
  ]);
  assert.deepEqual(compact("（https://example.com/path）」、「次"), [
    { type: "text", value: "（" },
    { type: "autolink", label: "https://example.com/path", destination: "https://example.com/path", title: "" },
    { type: "text", value: "）」、「次" }
  ]);
});

test("parses angle autolinks without including the closing bracket", () => {
  assert.deepEqual(compact("<https://example.com/a_(b)>"), [
    { type: "autolink", label: "https://example.com/a_(b)", destination: "https://example.com/a_(b)", title: "" }
  ]);
  assert.equal(compact("<user@example.com>")[0].destination, "mailto:user@example.com");
});

test("supports web shorthand and local file URLs but not unsafe bare schemes", () => {
  assert.equal(compact("www.example.com/docs")[0].destination, "https://www.example.com/docs");
  assert.equal(compact("file:///C:/Docs/a(b).md")[0].destination, "file:///C:/Docs/a(b).md");
  assert.deepEqual(compact("javascript:alert(1)"), [
    { type: "text", value: "javascript:alert(1)" }
  ]);
});

test("requires a valid bare URL boundary and respects escaped Markdown constructs", () => {
  for (const source of [
    "foo-https://example.com",
    "\\<https://example.com>",
    "\\[x](https://example.com)"
  ]) {
    assert.ok(compact(source).every((node) => node.type === "text"), source);
  }
  assert.equal(compact("URL:https://example.com")[1].destination, "https://example.com");
});

test("decodes character references before checking URL schemes", () => {
  assert.equal(decodeHtmlReferences("https://example.com/?a=1&amp;b=2"), "https://example.com/?a=1&b=2");
  for (const destination of [
    "javascript:alert(1)",
    "JaVaScRiPt:alert(1)",
    "javascript&#58;alert(1)",
    "data:text/html,x",
    "vbscript:msgbox(1)"
  ]) {
    assert.equal(hasBlockedScheme(destination), true, destination);
  }
  assert.equal(hasBlockedScheme("C:\\Docs\\guide.md"), false);
});

test("does not create links inside inline code", () => {
  assert.deepEqual(compact("`https://example.com`"), [
    { type: "code", value: "https://example.com" }
  ]);
  assert.deepEqual(compact("``code ` https://example.com``"), [
    { type: "code", value: "code ` https://example.com" }
  ]);
});
