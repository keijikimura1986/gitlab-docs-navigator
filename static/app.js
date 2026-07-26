const $ = (selector) => document.querySelector(selector);
const state = { tree: null, query: "", activeDoc: null };
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

function markdown(source) {
  const code = [];
  let text = escapeHtml(source).replace(/```([\s\S]*?)```/g, (_, body) => {
    code.push(`<pre><code>${body.trim()}</code></pre>`);
    return `\n@@CODE${code.length - 1}@@\n`;
  });
  text = text
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/^&gt; (.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^\s*[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/^\s*\d+\. (.+)$/gm, "<li>$1</li>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  text = text.split(/\n{2,}/).map((block) => {
    if (/^<(h\d|pre|blockquote|ul|ol)/.test(block) || /^@@CODE/.test(block)) return block;
    if (block.startsWith("<li>")) return `<ul>${block}</ul>`;
    return `<p>${block.replace(/\n/g, "<br>")}</p>`;
  }).join("\n");
  return text.replace(/@@CODE(\d+)@@/g, (_, i) => code[Number(i)]);
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
        ${project.documents.map((doc) => `<button class="tree-doc" data-doc-id="${escapeHtml(doc.id)}"><span class="tree-icon">▤</span><span>${escapeHtml(doc.title)}</span></button>`).join("") || '<div class="tree-doc">文書なし</div>'}
      </div>
    </details>`).join("");
  return `<div class="tree-group"><details ${root ? "open" : ""}>
    <summary><span class="tree-icon">□</span><span>${escapeHtml(group.name)}</span></summary>
    <div class="tree-children">${childGroups}${projects}</div>
  </details></div>`;
}

async function loadTree() {
  const data = await api("/api/tree");
  state.tree = data;
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
    $("#docContent").innerHTML = markdown(doc.content);
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
  if (docButton) openDoc(docButton.dataset.docId);
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
