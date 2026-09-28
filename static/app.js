const $ = (selector) => document.querySelector(selector);
const state = {
  tree: null,
  query: "",
  activeDoc: null,
  highlightQuery: "",
  documentIndex: new Map(),
  documentUrlIndex: new Map()
};
const views = ["#welcome", "#searchView", "#docView"];
const SIDEBAR_DEFAULT_WIDTH = 292;
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;

function setSidebarWidth(width, persist = true) {
  const value = Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(width)));
  document.documentElement.style.setProperty("--sidebar", `${value}px`);
  const handle = $("#sidebarResizeHandle");
  handle.setAttribute("aria-valuenow", String(value));
  if (persist) localStorage.setItem("docsNavigator.sidebarWidth", String(value));
}

function initializeSidebarResize() {
  const savedWidth = Number(localStorage.getItem("docsNavigator.sidebarWidth"));
  if (Number.isFinite(savedWidth) && savedWidth > 0) setSidebarWidth(savedWidth, false);

  const handle = $("#sidebarResizeHandle");
  handle.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    handle.setPointerCapture(event.pointerId);
    document.body.classList.add("resizing-sidebar");
  });
  handle.addEventListener("pointermove", (event) => {
    if (!handle.hasPointerCapture(event.pointerId)) return;
    setSidebarWidth(event.clientX);
  });
  const finishResize = (event) => {
    if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    document.body.classList.remove("resizing-sidebar");
  };
  handle.addEventListener("pointerup", finishResize);
  handle.addEventListener("pointercancel", finishResize);
  handle.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR_DEFAULT_WIDTH));
  handle.addEventListener("keydown", (event) => {
    if (!["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) return;
    event.preventDefault();
    const current = Number(handle.getAttribute("aria-valuenow")) || SIDEBAR_DEFAULT_WIDTH;
    if (event.key === "Home") setSidebarWidth(SIDEBAR_DEFAULT_WIDTH);
    else setSidebarWidth(current + (event.key === "ArrowRight" ? 16 : -16));
  });
}

initializeSidebarResize();

function showView(selector) {
  views.forEach((id) => $(id).classList.toggle("hidden", id !== selector));
  if (selector !== "#docView") $("#issueButton").classList.add("hidden");
}

function escapeHtml(value = "") {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function highlight(value, query) {
  let safe = escapeHtml(value);
  const terms = [...query.matchAll(/"([^"]+)"|(\S+)/g)].map((m) => m[1] || m[2]).filter(Boolean);
  for (const term of terms.sort((a, b) => b.length - a.length)) {
    const pattern = new RegExp(`(${escapeHtml(term).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "giu");
    safe = safe.replace(pattern, "<mark>$1</mark>");
  }
  return safe;
}

function normalizeRepoPath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function normalizedDocumentUrl(url, base) {
  try {
    const parsed = new URL(url, base);
    const pathname = decodeURIComponent(parsed.pathname).replace(/\/+$/, "");
    return `${parsed.origin}${pathname}`;
  } catch {
    return "";
  }
}

function resolveLink(url, doc) {
  if (/^mailto:/i.test(url)) return { href: url, external: false };
  if (url.startsWith("#")) return { href: url, external: false };
  if (!doc || /^(javascript:|data:|vbscript:)/i.test(url)) return { href: "#", external: false };

  const [pathWithQuery, anchor = ""] = url.split("#", 2);
  const indexedUrl = normalizedDocumentUrl(pathWithQuery, doc.webUrl);
  const linkedDocument = state.documentUrlIndex.get(indexedUrl);
  if (linkedDocument) {
    return {
      href: `?doc=${encodeURIComponent(linkedDocument.id)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`,
      docId: linkedDocument.id,
      external: false
    };
  }
  if (/^https?:/i.test(url)) return { href: url, external: true };

  const [relativePath, query = ""] = pathWithQuery.split("?", 2);
  let decodedPath = relativePath;
  try { decodedPath = decodeURIComponent(relativePath); } catch {}
  const base = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
  const targetPath = normalizeRepoPath(base + decodedPath);
  const target = state.documentIndex.get(`${doc.projectPath}:${targetPath}`);
  if (target) {
    return { href: `?doc=${encodeURIComponent(target.id)}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`, docId: target.id, external: false };
  }

  if (doc.webUrl) {
    const marker = "/-/blob/";
    const markerAt = doc.webUrl.indexOf(marker);
    if (markerAt >= 0) {
      const afterMarker = doc.webUrl.slice(markerAt + marker.length);
      const branch = afterMarker.split("/")[0];
      const encodedPath = targetPath.split("/").map(encodeURIComponent).join("/");
      const suffix = `${query ? `?${query}` : ""}${anchor ? `#${encodeURIComponent(anchor)}` : ""}`;
      return { href: `${doc.webUrl.slice(0, markerAt)}${marker}${branch}/${encodedPath}${suffix}`, external: true };
    }
  }
  return { href: "#", external: false };
}

function resolveImageUrl(url, doc) {
  if (/^https?:/i.test(url)) return url;
  if (!doc || /^(javascript:|data:|vbscript:)/i.test(url) || !doc.webUrl) return "";

  const marker = "/-/blob/";
  const markerAt = doc.webUrl.indexOf(marker);
  if (markerAt < 0) return "";
  const projectUrl = doc.webUrl.slice(0, markerAt);
  if (url.startsWith("/uploads/")) return `${projectUrl}${url}`;

  const cleanUrl = url.split(/[?#]/, 1)[0];
  let decodedPath = cleanUrl;
  try { decodedPath = decodeURIComponent(cleanUrl); } catch {}
  const base = doc.path.includes("/") ? doc.path.slice(0, doc.path.lastIndexOf("/") + 1) : "";
  const targetPath = normalizeRepoPath(base + decodedPath);
  const afterMarker = doc.webUrl.slice(markerAt + marker.length);
  const branch = afterMarker.split("/")[0];
  const encodedPath = targetPath.split("/").map(encodeURIComponent).join("/");
  return `${projectUrl}/-/raw/${branch}/${encodedPath}`;
}

function gitLabBranchUrl(url, branch) {
  const marker = "/-/blob/";
  const markerAt = url.indexOf(marker);
  if (markerAt < 0) return url;
  const afterMarker = url.slice(markerAt + marker.length);
  const pathAt = afterMarker.indexOf("/");
  if (pathAt < 0) return url;
  return `${url.slice(0, markerAt + marker.length)}${encodeURIComponent(branch)}${afterMarker.slice(pathAt)}`;
}

function gitLabNewIssueUrl(documentUrl) {
  const markerAt = documentUrl.indexOf("/-/blob/");
  if (markerAt < 0) return "";
  return `${documentUrl.slice(0, markerAt)}/-/issues/new`;
}

function inlineMarkdown(value, doc) {
  const tokens = [];
  const token = (html) => {
    tokens.push(html);
    return `@@INLINE${tokens.length - 1}@@`;
  };
  let text = value
    .replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
    .replace(/!\[([^\]]*)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, alt, url, title) => {
      const source = resolveImageUrl(url, doc);
      if (!source) return token(`<span class="image-error">画像を表示できません: ${escapeHtml(alt || url)}</span>`);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return token(`<img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy" decoding="async">`);
    })
    .replace(/\[([^\]]+)\]\((\S+?)(?:\s+["']([^"']*)["'])?\)/g, (_, label, url, title) => {
      const resolved = resolveLink(url, doc);
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      const targetAttr = resolved.external ? ' target="_blank" rel="noopener noreferrer"' : "";
      const docAttr = resolved.docId ? ` data-doc-id="${escapeHtml(resolved.docId)}"` : "";
      return token(`<a href="${escapeHtml(resolved.href)}"${titleAttr}${targetAttr}${docAttr}>${escapeHtml(label)}</a>`);
    });
  text = escapeHtml(text)
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, "$1<em>$2</em>")
    .replace(/(^|[\s(])_([^_\n]+)_/g, "$1<em>$2</em>");
  return text.replace(/@@INLINE(\d+)@@/g, (_, index) => tokens[Number(index)]);
}

function splitTableRow(line) {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|")) value = value.slice(0, -1);
  return value.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.replace(/\s/g, "")));
}

function markdown(source, doc) {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    if (/^\s*```/.test(line)) {
      const language = line.trim().slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push(`<pre${language ? ` data-language="${escapeHtml(language)}"` : ""}><code>${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const label = headingMatch[2].replace(/\s+#+\s*$/, "");
      const id = normalizeRepoPath(label).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase();
      blocks.push(`<h${level} id="${escapeHtml(id)}">${inlineMarkdown(label, doc)}</h${level}>`);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const separators = splitTableRow(lines[index + 1]);
      const alignments = separators.map((cell) => cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "");
      index += 2;
      const rows = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) rows.push(splitTableRow(lines[index++]));
      const headerHtml = headers.map((cell, i) => `<th${alignments[i] ? ` style="text-align:${alignments[i]}"` : ""}>${inlineMarkdown(cell, doc)}</th>`).join("");
      const bodyHtml = rows.map((row) => `<tr>${headers.map((_, i) => `<td${alignments[i] ? ` style="text-align:${alignments[i]}"` : ""}>${inlineMarkdown(row[i] || "", doc)}</td>`).join("")}</tr>`).join("");
      blocks.push(`<div class="table-scroll"><table><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quote = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) quote.push(lines[index++].replace(/^\s*>\s?/, ""));
      blocks.push(`<blockquote>${quote.map((item) => inlineMarkdown(item, doc)).join("<br>")}</blockquote>`);
      continue;
    }

    const listMatch = line.match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
    if (listMatch) {
      const ordered = Boolean(listMatch[2]);
      const items = [];
      while (index < lines.length) {
        const match = lines[index].match(/^\s*(?:([-+*])|(\d+)\.)\s+(.+)$/);
        if (!match || Boolean(match[2]) !== ordered) break;
        items.push(`<li>${inlineMarkdown(match[3], doc)}</li>`);
        index += 1;
      }
      blocks.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length && lines[index].trim() &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*(```|>|\s*[-+*]\s+|\s*\d+\.\s+)/.test(lines[index]) &&
      !(index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1]))
    ) paragraph.push(lines[index++]);
    blocks.push(`<p>${paragraph.map((item) => inlineMarkdown(item, doc)).join("<br>")}</p>`);
  }
  return blocks.join("\n");
}

function renderedDocumentHtml(doc) {
  const key = doc.renderHash ? `docsNavigator.renderedHtml.${doc.renderHash}` : "";
  if (key) {
    try {
      const cached = localStorage.getItem(key);
      if (cached !== null) return cached;
    } catch {}
  }

  const html = markdown(doc.content, doc);
  if (key) {
    try {
      localStorage.setItem(key, html);
    } catch {
      // Rendering still succeeds when storage is unavailable or full.
    }
  }
  return html;
}

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "通信に失敗しました");
  return data;
}

function groupHtml(group, root = false) {
  const childGroups = group.groups.map((child) => groupHtml(child)).join("");
  const projects = group.projects.map((project) => `
    <details class="tree-project-wrap" open>
      <summary class="tree-project"><span class="tree-icon">◇</span><span>${escapeHtml(project.name)}</span></summary>
      <div class="tree-children">
        ${documentTreeHtml(project.documentTree || project.documents.map((doc) => ({ type: "document", ...doc }))) || '<div class="tree-doc">文書なし</div>'}
      </div>
    </details>`).join("");
  return `<div class="tree-group"><details ${root ? "open" : ""}>
    <summary><span class="tree-icon">□</span><span>${escapeHtml(group.name)}</span></summary>
    <div class="tree-children">${childGroups}${projects}</div>
  </details></div>`;
}

function documentTreeHtml(nodes) {
  return nodes.map((node) => {
    if (node.type === "directory") {
      return `<details class="tree-directory" open>
        <summary><span class="tree-icon">▱</span><span>${escapeHtml(node.name)}</span></summary>
        <div class="tree-children">${documentTreeHtml(node.children)}</div>
      </details>`;
    }
    const fileName = node.path.split("/").pop();
    return `<button class="tree-doc" data-doc-id="${escapeHtml(node.id)}" title="${escapeHtml(node.title)}">
      <span class="tree-icon">▤</span><span>${escapeHtml(fileName)}</span>
    </button>`;
  }).join("");
}

async function loadTree() {
  const data = await api("/api/tree");
  state.tree = data;
  state.documentIndex.clear();
  state.documentUrlIndex.clear();
  let homeDocument = null;
  let gitLabOrigin = "";
  const indexGroup = (group) => {
    group.projects.forEach((project) => {
      project.documents.forEach((doc) => {
        state.documentIndex.set(`${project.path}:${doc.path}`, doc);
        const documentUrl = normalizedDocumentUrl(doc.webUrl);
        if (documentUrl) {
          state.documentUrlIndex.set(documentUrl, doc);
          if (!gitLabOrigin) gitLabOrigin = new URL(doc.webUrl).origin;
        }
        if (doc.id === data.homeDocumentId) homeDocument = doc;
      });
      const projectReadme = project.documents.find((doc) => !doc.path.includes("/") && /^readme\./i.test(doc.path));
      const projectUrl = normalizedDocumentUrl(project.webUrl);
      if (projectReadme && projectUrl) state.documentUrlIndex.set(projectUrl, projectReadme);
    });
    group.groups.forEach(indexGroup);
  };
  indexGroup(data.root);
  if (homeDocument && gitLabOrigin) {
    const groupUrl = normalizedDocumentUrl(`/${data.root.path}`, gitLabOrigin);
    state.documentUrlIndex.set(groupUrl, homeDocument);
  }
  $("#tree").innerHTML = groupHtml(data.root, true);
  const fetchedAt = new Intl.DateTimeFormat("ja-JP", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit"
  }).format(new Date(data.fetchedAt));
  $("#stats").innerHTML = `${data.source === "demo" ? '<span class="demo-badge">DEMO MODE</span><br>' : ""}${data.stats.groups} グループ ・ ${data.stats.projects} リポジトリ<br>${data.stats.documents} 文書をインデックス<br><span class="fetched-at">取得日時: ${escapeHtml(fetchedAt)}</span>`;
  const nextBranch = data.branch === "draft" ? "main" : "draft";
  $("#branchButton span").textContent = `${nextBranch}を取得`;
  $("#branchButton").title = `${nextBranch}ブランチの文書を取得`;
  $("#branchButton").dataset.branch = nextBranch;
}

function showHome() {
  if (state.tree?.homeDocumentId) openDoc(state.tree.homeDocumentId, false);
  else showView("#welcome");
}

function queryTerms(query) {
  return [...query.matchAll(/"([^"]+)"|(\S+)/g)]
    .map((match) => match[1] || match[2])
    .filter(Boolean);
}

function highlightDocument(query) {
  const status = $("#highlightStatus");
  status.classList.add("hidden");
  status.textContent = "";
  const terms = queryTerms(query);
  if (!terms.length) return;

  const escapedTerms = terms
    .sort((a, b) => b.length - a.length)
    .map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(`(${escapedTerms.join("|")})`, "giu");
  const root = $("#docContent");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue.trim() || node.parentElement.closest("mark, script, style, h1")) {
        return NodeFilter.FILTER_REJECT;
      }
      pattern.lastIndex = 0;
      return pattern.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const matchingNodes = [];
  while (walker.nextNode()) matchingNodes.push(walker.currentNode);

  let count = 0;
  matchingNodes.forEach((node) => {
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    pattern.lastIndex = 0;
    for (const match of node.nodeValue.matchAll(pattern)) {
      fragment.append(document.createTextNode(node.nodeValue.slice(lastIndex, match.index)));
      const mark = document.createElement("mark");
      mark.className = "search-highlight";
      mark.textContent = match[0];
      fragment.append(mark);
      lastIndex = match.index + match[0].length;
      count += 1;
    }
    fragment.append(document.createTextNode(node.nodeValue.slice(lastIndex)));
    node.replaceWith(fragment);
  });

  if (count) {
    status.textContent = `検索語「${query}」に一致する箇所: ${count}件`;
    status.classList.remove("hidden");
  }
}

async function openDoc(id, push = true, highlightQuery = "") {
  try {
    const doc = await api(`/api/doc?id=${encodeURIComponent(id)}`);
    state.activeDoc = id;
    state.highlightQuery = highlightQuery;
    $("#docTitle").textContent = doc.title;
    $("#filePath").textContent = doc.path;
    $("#breadcrumbs").innerHTML = [...doc.groupPath.split("/"), doc.project].map((x) => `<span>${escapeHtml(x)}</span>`).join("");
    $("#docContent").innerHTML = renderedDocumentHtml(doc);
    highlightDocument(highlightQuery);
    $("#gitlabLink").classList.toggle("hidden", !doc.webUrl);
    $("#gitlabLink").href = doc.webUrl ? gitLabBranchUrl(doc.webUrl, doc.linkBranch || "main") : "#";
    const issueUrl = doc.webUrl ? gitLabNewIssueUrl(doc.webUrl) : "";
    $("#issueButton").classList.toggle("hidden", !issueUrl);
    $("#issueButton").href = issueUrl || "#";
    document.querySelectorAll(".tree-doc").forEach((node) => node.classList.toggle("active", node.dataset.docId === id));
    showView("#docView");
    if (push) {
      const queryPart = highlightQuery ? `&q=${encodeURIComponent(highlightQuery)}` : "";
      history.pushState({ doc: id, query: highlightQuery }, "", `?doc=${encodeURIComponent(id)}${queryPart}`);
    }
    closeMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) { toast(error.message); }
}

async function search(query, push = true) {
  query = query.trim();
  state.query = query;
  if (!query) {
    showHome();
    if (push) history.pushState({}, "", location.pathname);
    return;
  }
  showView("#searchView");
  $("#queryLabel").textContent = query;
  $("#resultCount").textContent = "検索中…";
  $("#results").innerHTML = '<div class="skeleton tall"></div>';
  try {
    const data = await api(`/api/search?q=${encodeURIComponent(query)}`);
    $("#resultCount").textContent = `${data.results.length} 件`;
    $("#results").innerHTML = data.results.length ? data.results.map((item) => `
      <button class="result-card" data-doc-id="${escapeHtml(item.id)}">
        <div class="result-meta">${escapeHtml(item.projectPath)} / ${escapeHtml(item.path)}</div>
        <h2>${highlight(item.title, query)}</h2>
        <p>${highlight(item.excerpt, query)}</p>
      </button>`).join("") : '<div class="empty">一致する文書はありません。<br>キーワードを短くしてお試しください。</div>';
    if (push) history.pushState({ query }, "", `?q=${encodeURIComponent(query)}`);
  } catch (error) {
    $("#results").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  }
}

let searchTimer;
$("#searchInput").addEventListener("input", (event) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(event.target.value), 250);
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault(); $("#searchInput").focus();
  }
  if (event.key === "Escape") { $("#searchInput").blur(); closeMenu(); }
});
document.addEventListener("click", (event) => {
  const docButton = event.target.closest("[data-doc-id]");
  if (docButton) {
    event.preventDefault();
    const fromSearch = Boolean(docButton.closest("#results"));
    const fromDocument = Boolean(docButton.closest("#docContent"));
    const query = fromSearch ? state.query : fromDocument ? state.highlightQuery : "";
    openDoc(docButton.dataset.docId, true, query);
  }
  const quick = event.target.closest("[data-query]");
  if (quick) { $("#searchInput").value = quick.dataset.query; search(quick.dataset.query); }
});
async function refreshBranch(branch, button) {
  button.classList.add("loading");
  try {
    await api(`/api/refresh?branch=${encodeURIComponent(branch)}`, { method: "POST" });
    await loadTree();
    route(false);
    toast(`${branch}ブランチの文書を取得しました`);
  }
  catch (error) { toast(error.message); }
  finally { button.classList.remove("loading"); }
}
$("#refreshButton").addEventListener("click", () => {
  refreshBranch(state.tree?.branch || "main", $("#refreshButton"));
});
$("#branchButton").addEventListener("click", () => {
  refreshBranch($("#branchButton").dataset.branch || "draft", $("#branchButton"));
});
$("#collapseAll").addEventListener("click", () => document.querySelectorAll("#tree details").forEach((node) => node.open = false));
$("#menuButton").addEventListener("click", () => { $("#sidebar").classList.toggle("open"); $("#overlay").classList.toggle("open"); });
$("#overlay").addEventListener("click", closeMenu);
function closeMenu() { $("#sidebar").classList.remove("open"); $("#overlay").classList.remove("open"); }
let toastTimer;
function toast(message) { clearTimeout(toastTimer); $("#toast").textContent = message; $("#toast").classList.remove("hidden"); toastTimer = setTimeout(() => $("#toast").classList.add("hidden"), 3500); }
window.addEventListener("popstate", () => route(false));
function route(push = false) {
  const params = new URLSearchParams(location.search);
  if (params.has("doc")) {
    const query = params.get("q") || "";
    state.query = query;
    $("#searchInput").value = query;
    openDoc(params.get("doc"), push, query);
  }
  else if (params.has("q")) { $("#searchInput").value = params.get("q"); search(params.get("q"), push); }
  else showHome();
}
loadTree().then(() => route(false)).catch((error) => { $("#tree").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; toast(error.message); });
