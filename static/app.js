const $ = (selector) => document.querySelector(selector);
const state = { tree: null, query: "", activeDoc: null, documentIndex: new Map() };
const views = ["#welcome", "#searchView", "#docView"];

function showView(selector) {
  views.forEach((id) => $(id).classList.toggle("hidden", id !== selector));
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

function resolveLink(url, doc) {
  if (/^(https?:|mailto:)/i.test(url)) {
    return { href: url, external: /^https?:/i.test(url) };
  }
  if (url.startsWith("#")) return { href: url, external: false };
  if (!doc || /^(javascript:|data:|vbscript:)/i.test(url)) return { href: "#", external: false };

  const [pathWithQuery, anchor = ""] = url.split("#", 2);
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

function inlineMarkdown(value, doc) {
  const tokens = [];
  const token = (html) => {
    tokens.push(html);
    return `@@INLINE${tokens.length - 1}@@`;
  };
  let text = value
    .replace(/`([^`\n]+)`/g, (_, code) => token(`<code>${escapeHtml(code)}</code>`))
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
  const indexGroup = (group) => {
    group.projects.forEach((project) => project.documents.forEach((doc) => {
      state.documentIndex.set(`${project.path}:${doc.path}`, doc);
    }));
    group.groups.forEach(indexGroup);
  };
  indexGroup(data.root);
  $("#tree").innerHTML = groupHtml(data.root, true);
  $("#stats").innerHTML = `${data.source === "demo" ? '<span class="demo-badge">DEMO MODE</span><br>' : ""}${data.stats.groups} グループ ・ ${data.stats.projects} リポジトリ<br>${data.stats.documents} 文書をインデックス`;
}

async function openDoc(id, push = true) {
  try {
    const doc = await api(`/api/doc?id=${encodeURIComponent(id)}`);
    state.activeDoc = id;
    $("#docTitle").textContent = doc.title;
    $("#filePath").textContent = doc.path;
    $("#breadcrumbs").innerHTML = [...doc.groupPath.split("/"), doc.project].map((x) => `<span>${escapeHtml(x)}</span>`).join("");
    $("#docContent").innerHTML = markdown(doc.content, doc);
    $("#gitlabLink").classList.toggle("hidden", !doc.webUrl);
    $("#gitlabLink").href = doc.webUrl || "#";
    document.querySelectorAll(".tree-doc").forEach((node) => node.classList.toggle("active", node.dataset.docId === id));
    showView("#docView");
    if (push) history.pushState({ doc: id }, "", `?doc=${encodeURIComponent(id)}`);
    closeMenu();
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (error) { toast(error.message); }
}

async function search(query, push = true) {
  query = query.trim();
  state.query = query;
  if (!query) {
    showView("#welcome");
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
    openDoc(docButton.dataset.docId);
  }
  const quick = event.target.closest("[data-query]");
  if (quick) { $("#searchInput").value = quick.dataset.query; search(quick.dataset.query); }
});
$("#refreshButton").addEventListener("click", async () => {
  const button = $("#refreshButton");
  button.classList.add("loading");
  try { await api("/api/refresh", { method: "POST" }); await loadTree(); toast("文書インデックスを更新しました"); }
  catch (error) { toast(error.message); }
  finally { button.classList.remove("loading"); }
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
  if (params.has("doc")) openDoc(params.get("doc"), push);
  else if (params.has("q")) { $("#searchInput").value = params.get("q"); search(params.get("q"), push); }
  else showView("#welcome");
}
loadTree().then(() => route(false)).catch((error) => { $("#tree").innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`; toast(error.message); });
