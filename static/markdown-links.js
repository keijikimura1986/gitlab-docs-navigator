(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.DocsMarkdownLinks = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ESCAPABLE = new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
  const TRAILING_PUNCTUATION = new Set(".,!?;:*_~。、，．！？；：'\"“”‘’");
  const CLOSING_PAIRS = {
    ")": "(", "]": "[", "}": "{",
    "）": "（", "］": "［", "｝": "｛", "】": "【",
    "」": "「", "』": "『", "〉": "〈", "》": "《",
    "〕": "〔", "〗": "〖", "〙": "〘", "〛": "〚"
  };
  const BARE_LINK_STOPS = new Set("。、，．！？；：）］｝】」』〉》《〈『「【｛［（〕〔〗〖〙〘〛〚\"'“”‘’");
  const MAX_PARENTHESIS_DEPTH = 32;
  const MAX_LINK_LENGTH = 8192;
  const ALLOWED_SCHEMES = new Set(["http", "https", "mailto", "file"]);

  function unescapeMarkdown(value) {
    let result = "";
    for (let index = 0; index < value.length; index += 1) {
      const char = value[index];
      if (char === "\\" && index + 1 < value.length && ESCAPABLE.has(value[index + 1])) {
        result += value[index + 1];
        index += 1;
      } else {
        result += char;
      }
    }
    return result;
  }

  function unescapeDestination(value) {
    const unc = value.startsWith("\\\\");
    let result = unescapeMarkdown(value);
    if (unc && !result.startsWith("\\\\")) result = `\\${result}`;
    return result;
  }

  function decodeHtmlReferences(value) {
    const named = { amp: "&", apos: "'", colon: ":", gt: ">", lt: "<", nbsp: "\u00a0", quot: '"' };
    return value.replace(/&(?:#(\d+)|#x([0-9a-f]+)|([a-z]+));/gi, (match, decimal, hexadecimal, name) => {
      if (name) return named[name.toLowerCase()] ?? match;
      const codePoint = Number.parseInt(decimal || hexadecimal, decimal ? 10 : 16);
      if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return "\ufffd";
      }
      return String.fromCodePoint(codePoint);
    });
  }

  function hasBlockedScheme(value) {
    const decoded = decodeHtmlReferences(value);
    if (/^[A-Za-z]:[\\/]/.test(decoded)) return false;
    const match = decoded.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
    return Boolean(match && !ALLOWED_SCHEMES.has(match[1].toLowerCase()));
  }

  function findLabelEnd(source, openAt) {
    let depth = 0;
    const limit = Math.min(source.length, openAt + MAX_LINK_LENGTH);
    for (let index = openAt + 1; index < limit; index += 1) {
      const char = source[index];
      if (char === "\\" && index + 1 < source.length) {
        index += 1;
      } else if (char === "[") {
        depth += 1;
      } else if (char === "]") {
        if (depth === 0) return index;
        depth -= 1;
      }
    }
    return -1;
  }

  function parseTitle(source, start) {
    const opener = source[start];
    const closer = opener === "(" ? ")" : opener;
    if (!['"', "'", "("].includes(opener)) return null;

    const limit = Math.min(source.length, start + MAX_LINK_LENGTH);
    for (let index = start + 1; index < limit; index += 1) {
      if (source[index] === "\\" && index + 1 < source.length) {
        index += 1;
      } else if (source[index] === closer) {
        return {
          title: unescapeMarkdown(source.slice(start + 1, index)),
          end: index + 1
        };
      }
    }
    return null;
  }

  function completedLink(source, start, labelEnd, image, destination, title, end) {
    const openAt = image ? start + 1 : start;
    return {
      type: image ? "image" : "link",
      label: unescapeMarkdown(source.slice(openAt + 1, labelEnd)),
      destination: unescapeDestination(destination),
      title,
      end
    };
  }

  function parseMarkdownLink(source, start) {
    const image = source[start] === "!" && source[start + 1] === "[";
    const openAt = image ? start + 1 : start;
    if (source[openAt] !== "[") return null;

    const labelEnd = findLabelEnd(source, openAt);
    if (labelEnd < 0 || source[labelEnd + 1] !== "(") return null;

    const limit = Math.min(source.length, start + MAX_LINK_LENGTH);
    let cursor = labelEnd + 2;
    const beforeWhitespace = cursor;
    while (cursor < limit && /[\t ]/.test(source[cursor])) cursor += 1;

    if (cursor > beforeWhitespace && ['"', "'", "("].includes(source[cursor])) {
      const emptyDestinationTitle = parseTitle(source, cursor);
      if (emptyDestinationTitle) {
        cursor = emptyDestinationTitle.end;
        while (cursor < limit && /[\t ]/.test(source[cursor])) cursor += 1;
        if (source[cursor] === ")") {
          return completedLink(source, start, labelEnd, image, "", emptyDestinationTitle.title, cursor + 1);
        }
      }
      cursor = beforeWhitespace;
      while (cursor < limit && /[\t ]/.test(source[cursor])) cursor += 1;
    }

    let destination = "";
    if (source[cursor] === "<") {
      const destinationStart = cursor + 1;
      cursor += 1;
      while (cursor < limit) {
        if (source[cursor] === "\\" && cursor + 1 < source.length) {
          cursor += 2;
          continue;
        }
        if (source[cursor] === ">") break;
        if (source[cursor] === "<" || /[\r\n]/.test(source[cursor])) return null;
        cursor += 1;
      }
      if (source[cursor] !== ">") return null;
      destination = source.slice(destinationStart, cursor);
      cursor += 1;
    } else {
      const destinationStart = cursor;
      let depth = 0;
      while (cursor < limit) {
        const char = source[cursor];
        if (char === "\\" && cursor + 1 < source.length) {
          cursor += 2;
          continue;
        }
        if (/\s/.test(char)) {
          if (depth > 0) return null;
          break;
        }
        if (char === "(") {
          depth += 1;
          if (depth > MAX_PARENTHESIS_DEPTH) return null;
        } else if (char === ")") {
          if (depth === 0) {
            destination = source.slice(destinationStart, cursor);
            return completedLink(source, start, labelEnd, image, destination, "", cursor + 1);
          }
          depth -= 1;
        }
        cursor += 1;
      }
      if (depth > 0) return null;
      destination = source.slice(destinationStart, cursor);
    }

    while (cursor < limit && /[\t ]/.test(source[cursor])) cursor += 1;
    if (source[cursor] === ")") {
      return completedLink(source, start, labelEnd, image, destination, "", cursor + 1);
    }

    const parsedTitle = parseTitle(source, cursor);
    if (!parsedTitle) return null;
    cursor = parsedTitle.end;
    while (cursor < limit && /[\t ]/.test(source[cursor])) cursor += 1;
    if (source[cursor] !== ")") return null;
    return completedLink(source, start, labelEnd, image, destination, parsedTitle.title, cursor + 1);
  }

  function parseAngleAutolink(source, start) {
    const limit = Math.min(source.length, start + MAX_LINK_LENGTH);
    let closeAt = -1;
    for (let index = start + 1; index < limit; index += 1) {
      if (source[index] === ">") {
        closeAt = index;
        break;
      }
    }
    if (closeAt < 0) return null;
    const label = source.slice(start + 1, closeAt);
    if (!label || /[\s<>]/.test(label)) return null;

    let destination = label;
    if (/^www\./i.test(label)) {
      destination = `https://${label}`;
    } else if (/^[^@<>\s]+@[^@<>\s]+\.[^@<>\s]+$/.test(label)) {
      destination = `mailto:${label}`;
    } else if (!/^(?:https?:\/\/|file:\/\/|mailto:)/i.test(label)) {
      return null;
    }

    return { type: "autolink", label, destination, title: "", end: closeAt + 1 };
  }

  function trimBareDestination(value) {
    let end = value.length;
    const counts = {};
    for (const [closer, opener] of Object.entries(CLOSING_PAIRS)) {
      counts[closer] = 0;
      counts[opener] = 0;
    }
    for (const char of value) {
      if (Object.prototype.hasOwnProperty.call(counts, char)) counts[char] += 1;
    }

    while (end > 0) {
      const last = value[end - 1];
      if (TRAILING_PUNCTUATION.has(last)) {
        end -= 1;
        continue;
      }
      const opener = CLOSING_PAIRS[last];
      if (opener && counts[last] > counts[opener]) {
        counts[last] -= 1;
        end -= 1;
        continue;
      }
      break;
    }
    return value.slice(0, end);
  }

  function barePrefix(source, start) {
    const prefix = source.slice(start, start + 8).toLowerCase();
    if (prefix.startsWith("https://")) return source.slice(start, start + 8);
    if (prefix.startsWith("http://") || prefix.startsWith("file://")) return source.slice(start, start + 7);
    if (prefix.startsWith("www.")) return source.slice(start, start + 4);
    if (source[start] === "\\" && source[start + 1] === "\\") return "\\\\";
    return "";
  }

  function hasBareLinkBoundary(source, start) {
    if (start === 0) return true;
    const previous = source[start - 1];
    if (previous === "<" || previous === "\\" || /[\p{L}\p{N}_@-]/u.test(previous)) return false;
    if ((previous === "(" || previous === "（") && start > 1 && /[\]］]/.test(source[start - 2])) return false;
    return true;
  }

  function parseBareLink(source, start) {
    const prefix = barePrefix(source, start);
    if (!prefix) return null;
    if (!hasBareLinkBoundary(source, start)) return null;

    const limit = Math.min(source.length, start + MAX_LINK_LENGTH);
    let cursor = start + prefix.length;
    while (cursor < limit && !/[\s<>`]/.test(source[cursor]) && !BARE_LINK_STOPS.has(source[cursor])) cursor += 1;
    const label = trimBareDestination(source.slice(start, cursor));
    if (label.length <= prefix.length) return null;
    const destination = /^www\./i.test(label) ? `https://${label}` : label;
    return { type: "autolink", label, destination, title: "", end: start + label.length };
  }

  function parseCodeSpan(source, start) {
    if (source[start] !== "`") return null;
    let delimiterEnd = start + 1;
    while (source[delimiterEnd] === "`") delimiterEnd += 1;
    const delimiter = source.slice(start, delimiterEnd);
    const limit = Math.min(source.length, start + MAX_LINK_LENGTH);
    let searchAt = delimiterEnd;
    while (searchAt < limit) {
      const closeAt = source.indexOf(delimiter, searchAt);
      if (closeAt < 0 || closeAt >= limit) return null;
      const exactRun = source[closeAt - 1] !== "`" && source[closeAt + delimiter.length] !== "`";
      if (exactRun && closeAt > delimiterEnd) {
        return { type: "code", value: source.slice(delimiterEnd, closeAt), end: closeAt + delimiter.length };
      }
      searchAt = closeAt + delimiter.length;
    }
    return null;
  }

  function appendText(nodes, value) {
    if (!value) return;
    const previous = nodes[nodes.length - 1];
    if (previous && previous.type === "text") previous.value += value;
    else nodes.push({ type: "text", value });
  }

  function parseInlineLinks(source) {
    const nodes = [];
    let textStart = 0;
    let cursor = 0;
    while (cursor < source.length) {
      if (source[cursor] === "\\" && cursor + 1 < source.length && ESCAPABLE.has(source[cursor + 1])) {
        cursor += 2;
        continue;
      }
      let node = null;
      node = parseCodeSpan(source, cursor);
      if (!node && (source[cursor] === "[" || (source[cursor] === "!" && source[cursor + 1] === "["))) {
        node = parseMarkdownLink(source, cursor);
      }
      if (!node && source[cursor] === "<") node = parseAngleAutolink(source, cursor);
      if (!node) node = parseBareLink(source, cursor);

      if (!node) {
        if (source[cursor] === "`") {
          do { cursor += 1; } while (source[cursor] === "`");
        } else {
          cursor += 1;
        }
        continue;
      }
      appendText(nodes, source.slice(textStart, cursor));
      nodes.push(node);
      cursor = node.end;
      textStart = cursor;
    }
    appendText(nodes, source.slice(textStart));
    return nodes;
  }

  return { decodeHtmlReferences, hasBlockedScheme, parseInlineLinks, trimBareDestination, unescapeMarkdown };
});
