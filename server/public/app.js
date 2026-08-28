const state = {
  key: localStorage.getItem("rr-admin-key") || "",
  view: "overview",
  articles: [],
  users: [],
  selectedArticles: new Set(),
  selectedUsers: new Set(),
  pushExam: "",
  pushType: "",
  pushSearch: "",
};

const $ = (selector) => document.querySelector(selector);
const content = $("#content");
const titles = {
  overview: ["OPERATION OVERVIEW", "运营总览"],
  articles: ["QUESTION BANK", "题库管理"],
  sync: ["CONTENT SYNC", "内容同步"],
  push: ["MANUAL DELIVERY", "手动推送"],
  users: ["USER OPERATION", "用户运营"],
};
const examNames = {
  toefl: "托福",
  ielts: "雅思",
  toeic: "托业",
  high: "高中",
  middle: "初中",
};
const interestNames = {
  mecha: "高达机甲",
  cultivation: "修仙奇遇",
  tiger: "虎小满",
  cat: "猫成成",
  military: "军事科技",
  art: "画画与设计",
  science: "科普知识",
  why: "十万个为什么",
  fantasy: "奇幻冒险",
};

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set("x-admin-key", state.key);
  headers.set("accept", "application/json");
  if (options.body) headers.set("content-type", "application/json");
  const response = await fetch(`/api/v1/admin${path}`, { ...options, headers });
  const payload =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) showLogin("管理员密钥无效");
    throw new Error(payload?.error?.message || `请求失败 (${response.status})`);
  }
  return payload?.data;
}

function toast(message, error = false) {
  const element = $("#toast");
  element.textContent = message;
  element.className = `toast show${error ? " error" : ""}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (element.className = "toast"), 2800);
}

function showLogin(message = "") {
  $("#login").classList.remove("hidden");
  $("#app").classList.add("hidden");
  $("#login-error").textContent = message;
  $("#admin-key").value = state.key;
}

async function login() {
  state.key = $("#admin-key").value.trim();
  $("#login-error").textContent = "";
  $("#login-button").disabled = true;
  try {
    await api("/overview");
    localStorage.setItem("rr-admin-key", state.key);
    $("#login").classList.add("hidden");
    $("#app").classList.remove("hidden");
    await render("overview");
  } catch (error) {
    $("#login-error").textContent = error.message;
  } finally {
    $("#login-button").disabled = false;
  }
}

async function render(view) {
  state.view = view;
  const [eyebrow, title] = titles[view];
  $("#page-eyebrow").textContent = eyebrow;
  $("#page-title").textContent = title;
  document.querySelectorAll(".nav-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.view === view);
  });
  $(".sidebar").classList.remove("open");
  content.innerHTML = '<div class="skeleton"></div>';
  try {
    if (view === "overview") await renderOverview();
    if (view === "articles") await renderArticles();
    if (view === "sync") await renderSync();
    if (view === "push") await renderPush();
    if (view === "users") await renderUsers();
  } catch (error) {
    content.innerHTML = `<div class="panel empty"><div><strong>加载失败</strong><p>${escapeHtml(error.message)}</p><button class="button secondary" onclick="window.retryView()">重试</button></div></div>`;
  }
}

async function renderOverview() {
  const data = await api("/overview");
  const metrics = [
    ["注册用户", data.metrics.users, "已建立设备身份"],
    ["题库文章", data.metrics.articles, `含 ${data.metrics.interestArticles || 0} 篇兴趣内容`],
    ["累计推送", data.metrics.pushedArticles, "每日 + 手动推送"],
    ["完成阅读", data.metrics.readArticles, "已提交答案的文章"],
  ];
  content.innerHTML = `
    <section class="metric-grid">
      ${metrics.map(([label, value, foot]) => `<article class="metric-card"><span class="metric-label">${label}</span><div class="metric-value">${value}</div><div class="metric-foot">${foot}</div></article>`).join("")}
    </section>
    <section class="grid-two">
      <article class="panel">
        <div class="section-head"><div><h3>运营漏斗</h3><p>从推送到完成阅读的整体表现</p></div></div>
        ${funnel(data.metrics)}
      </article>
      <article class="panel">
        <div class="section-head"><div><h3>最近操作</h3><p>题库同步与人工推送记录</p></div></div>
        <div class="activity-list">${data.recent.length ? data.recent.map(activityRow).join("") : '<div class="empty">暂无后台操作记录</div>'}</div>
      </article>
    </section>
  `;
}

function funnel(metrics) {
  const pushed = Number(metrics.pushedArticles) || 0;
  const read = Number(metrics.readArticles) || 0;
  const rate = pushed ? Math.min(100, Math.round((read / pushed) * 100)) : 0;
  return `
    <div style="margin-top:26px">
      <div class="push-summary"><div><strong>${pushed} 篇已送达</strong><br><span>用户收到的全部阅读内容</span></div><span>100%</span></div>
      <div class="push-summary"><div><strong>${read} 篇已完成</strong><br><span>用户提交过答案的内容</span></div><span>${rate}%</span></div>
      <div style="height:10px;margin-top:18px;border-radius:99px;background:var(--line);overflow:hidden"><i style="display:block;width:${rate}%;height:100%;background:var(--primary);border-radius:inherit"></i></div>
    </div>`;
}

function activityRow(item) {
  const labels = {
    "articles.import": "导入题库",
    "articles.sync": "在线同步",
    "pushes.create": "创建推送",
  };
  return `<div class="activity"><i class="activity-dot"></i><div><strong>${labels[item.action] || item.action}</strong><span>${new Date(item.createdAt).toLocaleString()} · ${escapeHtml(JSON.stringify(item.detail))}</span></div></div>`;
}

async function renderArticles() {
  const categories = await api("/interests");
  categories.forEach((category) => {
    interestNames[category.id] = category.name;
  });
  const search = state.articleSearch || "";
  const exam = state.articleExam || "";
  const kind = state.articleKind || "";
  const interest = state.articleInterest || "";
  const query = new URLSearchParams({ limit: "100" });
  if (search) query.set("search", search);
  if (exam) query.set("examId", exam);
  if (kind) query.set("contentKind", kind);
  if (interest) query.set("interestId", interest);
  const result = await fetch(`/api/v1/admin/articles?${query}`, {
    headers: { "x-admin-key": state.key },
  }).then(async (response) => {
    const payload = await response.json();
    if (!response.ok)
      throw new Error(payload?.error?.message || "题库加载失败");
    return payload;
  });
  state.articles = result.data;
  content.innerHTML = `
    <div class="section-head"><div><h2>全部阅读题</h2><p>共 ${result.pagination.total} 篇，答案在用户提交后返回</p></div><div class="actions"><button class="button secondary" data-go="sync">导入题库</button><button class="button primary" data-go="push">选择并推送</button></div></div>
    <div class="toolbar"><input id="article-search" placeholder="搜索标题或主题" value="${escapeHtml(search)}"><select id="article-exam"><option value="">全部考试</option>${examOptions(exam)}</select><select id="article-kind"><option value="">全部内容</option><option value="exam" ${kind === "exam" ? "selected" : ""}>考试阅读</option><option value="interest" ${kind === "interest" ? "selected" : ""}>兴趣阅读</option></select><select id="article-interest"><option value="">全部兴趣</option>${Object.entries(interestNames).map(([id, name]) => `<option value="${id}" ${interest === id ? "selected" : ""}>${name}</option>`).join("")}</select><button id="article-filter" class="button secondary">筛选</button></div>
    <div class="table-wrap"><table><thead><tr><th>文章</th><th>内容类型</th><th>考试</th><th>年份</th><th>题目数</th><th>难度</th><th>来源</th></tr></thead><tbody>
      ${state.articles.map((item) => `<tr><td><strong>${escapeHtml(item.title)}</strong><br><span class="muted">${escapeHtml(item.seriesTitle ? `${item.seriesTitle} · 第 ${item.episodeNumber} 章` : item.eyebrow)} · ${item.readMinutes} 分钟</span></td><td><span class="badge">${item.contentKind === "interest" ? interestNames[item.interestId] || "兴趣阅读" : "考试阅读"}</span></td><td><span class="badge">${examNames[item.examId]}</span></td><td>${item.year}</td><td>${item.questionCount}</td><td>${"●".repeat(item.difficulty)}<span style="color:#d7dcda">${"●".repeat(5 - item.difficulty)}</span></td><td>${escapeHtml(item.sourceName)}</td></tr>`).join("") || '<tr><td colspan="7" class="empty">没有匹配的题目</td></tr>'}
    </tbody></table></div>`;
  $("#article-filter").onclick = () => {
    state.articleSearch = $("#article-search").value.trim();
    state.articleExam = $("#article-exam").value;
    state.articleKind = $("#article-kind").value;
    state.articleInterest = $("#article-interest").value;
    render("articles");
  };
  $("#article-search").onkeydown = (event) =>
    event.key === "Enter" && $("#article-filter").click();
  bindGoButtons();
}

async function renderSync() {
  const categories = await api("/interests");
  categories.forEach((category) => {
    interestNames[category.id] = category.name;
  });
  const sample = JSON.stringify(
    {
      articles: [
        {
          externalId: "authorized-2025-reading-01",
          year: 2025,
          title: "An Authorized Reading Passage",
          eyebrow: "EDUCATION",
          readMinutes: 7,
          difficulty: 3,
          contentKind: "interest",
          interestId: "science",
          seriesTitle: null,
          episodeNumber: null,
          paragraphs: [
            "Paste the licensed reading passage here. This example sentence is intentionally long enough for validation.",
          ],
          questions: [
            {
              prompt: "What is the main idea of the passage?",
              options: ["Option A", "Option B", "Option C", "Option D"],
              answer: 0,
              explanation: "Explain why option A is correct.",
            },
          ],
        },
      ],
    },
    null,
    2,
  );
  content.innerHTML = `
    <div class="callout"><strong>内容合规要求：</strong>官方示例页可用于了解题型，但不等于获得批量转载权。请仅同步自有、已购买授权或明确允许再分发的题库内容，并保存授权说明。</div>
    <section class="grid-two">
      <form id="sync-form" class="panel form-grid">
        <div class="span-2"><h3>从授权 JSON Feed 同步</h3><p class="muted">域名需先加入服务端 SYNC_ALLOWED_HOSTS</p></div>
        <label class="field span-2"><span>HTTPS Feed 地址</span><input name="url" type="url" required placeholder="https://content.example.com/reading.json"></label>
        <label class="field"><span>考试分类</span><select name="examId">${examOptions("toefl")}</select></label>
        <label class="field"><span>来源名称</span><input name="sourceName" required placeholder="授权题库供应商"></label>
        <label class="field span-2"><span>授权说明</span><textarea name="licenseNote" required placeholder="合同编号、开放许可或内部版权确认说明"></textarea></label>
        <label class="check-row span-2"><input name="rightsConfirmed" type="checkbox" required><span>我确认拥有这些内容的存储、展示和向用户分发权利。</span></label>
        <button class="button primary span-2">开始同步</button>
      </form>
      <form id="import-form" class="panel form-grid">
        <div class="span-2"><h3>手动导入 JSON</h3><p class="muted">适用于供应商文件或内部整理数据</p></div>
        <label class="field"><span>考试分类</span><select name="examId">${examOptions("toefl")}</select></label>
        <label class="field"><span>来源名称</span><input name="sourceName" required value="内部授权导入"></label>
        <label class="field span-2"><span>授权说明</span><input name="licenseNote" required value="内部已确认内容使用权"></label>
        <label class="field span-2"><span>JSON 数据</span><textarea name="json" class="code-input" required>${escapeHtml(sample)}</textarea></label>
        <label class="check-row span-2"><input name="rightsConfirmed" type="checkbox" required><span>我确认拥有这些内容的存储、展示和向用户分发权利。</span></label>
        <button class="button primary span-2">校验并导入</button>
      </form>
    </section>
    <section class="panel form-grid" style="margin-top:14px">
      <div class="span-2"><h3>新增或更新兴趣栏目</h3><p class="muted">保存后客户端兴趣选择和故事生成导入会自动识别，无需修改代码枚举。</p></div>
      <form id="interest-form" class="span-2 form-grid">
        <label class="field"><span>栏目 ID</span><input name="id" required pattern="[a-z][a-z0-9-]{1,39}" placeholder="例如 dinosaur"></label>
        <label class="field"><span>栏目名称</span><input name="name" required placeholder="恐龙探险"></label>
        <label class="field span-2"><span>栏目简介</span><input name="subtitle" required placeholder="化石、史前世界与科学冒险"></label>
        <label class="field"><span>图标 Emoji</span><input name="emoji" required value="🦕"></label>
        <label class="field"><span>主题颜色</span><input name="color" type="color" required value="#55766d"></label>
        <label class="field span-2"><span>故事生成方向</span><textarea name="storyPrompt" required placeholder="围绕恐龙、化石和野外考察创作连续冒险，知识必须来自观察和证据。"></textarea></label>
        <label class="field span-2"><span>阅读后互动任务</span><input name="activityPrompt" required value="用一句英文记录本章发现，并预测下一集。"></label>
        <button class="button primary span-2">保存兴趣栏目</button>
      </form>
      <div class="span-2"><strong>当前栏目：</strong> ${categories.map((item) => `${escapeHtml(item.emoji)} ${escapeHtml(item.name)} <span class="muted">(${escapeHtml(item.id)})</span>`).join(" · ")}</div>
    </section>`;
  $("#sync-form").onsubmit = submitSync;
  $("#import-form").onsubmit = submitImport;
  $("#interest-form").onsubmit = submitInterest;
}

async function submitInterest(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    const category = await api("/interests", {
      method: "POST",
      body: JSON.stringify({
        id: form.get("id"),
        name: form.get("name"),
        subtitle: form.get("subtitle"),
        emoji: form.get("emoji"),
        color: form.get("color"),
        storyPrompt: form.get("storyPrompt"),
        activityPrompt: form.get("activityPrompt"),
      }),
    });
    interestNames[category.id] = category.name;
    toast(`兴趣栏目“${category.name}”已保存`);
    await render("sync");
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function submitSync(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    const data = await api("/articles/sync", {
      method: "POST",
      body: JSON.stringify({
        url: form.get("url"),
        examId: form.get("examId"),
        sourceName: form.get("sourceName"),
        licenseNote: form.get("licenseNote"),
        rightsConfirmed: form.get("rightsConfirmed") === "on",
      }),
    });
    toast(`同步完成，写入 ${data.imported} 篇文章`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function submitImport(event) {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    const form = new FormData(event.currentTarget);
    const parsed = JSON.parse(form.get("json"));
    const data = await api("/articles/import", {
      method: "POST",
      body: JSON.stringify({
        examId: form.get("examId"),
        sourceName: form.get("sourceName"),
        licenseNote: form.get("licenseNote"),
        rightsConfirmed: form.get("rightsConfirmed") === "on",
        articles: parsed.articles,
      }),
    });
    toast(`导入完成，写入 ${data.imported} 篇文章`);
  } catch (error) {
    toast(error.message, true);
  } finally {
    button.disabled = false;
  }
}

async function renderPush() {
  const [articlePayload, users, types, categories] = await Promise.all([
    api("/articles?limit=500"),
    api("/users"),
    api("/article-types"),
    api("/interests"),
  ]);
  categories.forEach((category) => {
    interestNames[category.id] = category.name;
  });
  state.articles = articlePayload;
  state.users = users;
  state.articleTypes = types;
  state.selectedArticles.clear();
  state.selectedUsers.clear();
  content.innerHTML = `
    <div class="section-head"><div><h2>创建一次手动推送</h2><p>适合运营补充、测试题或特定用户专项练习</p></div></div>
    <section class="panel form-grid">
      <label class="field"><span>推送名称</span><input id="push-name" placeholder="例如：托福周末加练" value="运营测试推送"></label>
      <label class="field"><span>用户端消息</span><input id="push-message" placeholder="推荐给用户的简短说明" value="为你准备了一组专项阅读练习"></label>
      <div class="span-2 push-filters">
        <label><span>考试分类</span><select id="push-exam"><option value="">全部考试</option>${examOptions("")}</select></label>
        <label><span>文章类型</span><select id="push-type"><option value="">全部类型</option>${articleTypeOptions(types)}</select></label>
        <label><span>搜索文章</span><input id="push-search" placeholder="标题或主题关键词"></label>
      </div>
      <div class="span-2 selection-grid">
        <div class="selection-box"><div class="selection-head"><span id="article-filter-summary">选择文章 · ${state.articles.length} 篇</span><span id="article-selected">0 篇</span></div><div id="push-article-list">${state.articles.map(articleCheck).join("")}</div></div>
        <div class="selection-box"><div class="selection-head"><span>选择用户</span><label><input id="all-users" type="checkbox"> 推送全部用户</label></div>${state.users.map(userCheck).join("") || '<div class="empty">暂无注册用户</div>'}</div>
      </div>
      <div class="span-2 push-summary"><div><strong id="delivery-count">预计产生 0 条推送</strong><br><span>手动推送不会占用每日 3 篇计划</span></div><button id="send-push" class="button primary" disabled>确认推送</button></div>
    </section>
    <section class="panel" style="margin-top:14px"><div class="section-head"><div><h3>最近推送</h3><p>查看目标人数与打开情况</p></div></div><div id="push-history" class="empty">加载中…</div></section>`;
  bindArticleChecks();
  document
    .querySelectorAll("[data-user-id]")
    .forEach((box) => (box.onchange = updatePushSelection));
  $("#all-users").onchange = updatePushSelection;
  $("#push-exam").onchange = () => {
    updatePushTypeOptions();
    filterPushArticles();
  };
  $("#push-type").onchange = filterPushArticles;
  $("#push-search").oninput = filterPushArticles;
  $("#send-push").onclick = sendPush;
  renderPushHistory();
}

function articleTypeOptions(types) {
  return types
    .map(
      (item) =>
        `<option value="${escapeHtml(item.eyebrow)}">${escapeHtml(item.eyebrow)}（${item.count}）</option>`,
    )
    .join("");
}

function updatePushTypeOptions() {
  const exam = $("#push-exam").value;
  const counts = new Map();
  state.articles
    .filter((article) => !exam || article.examId === exam)
    .forEach((article) =>
      counts.set(article.eyebrow, (counts.get(article.eyebrow) || 0) + 1),
    );
  const types = [...counts.entries()]
    .map(([eyebrow, count]) => ({ eyebrow, count }))
    .sort((left, right) => right.count - left.count || left.eyebrow.localeCompare(right.eyebrow));
  $("#push-type").innerHTML = `<option value="">全部类型</option>${articleTypeOptions(types)}`;
}

function bindArticleChecks() {
  document.querySelectorAll("[data-article-id]").forEach((box) => {
    box.checked = state.selectedArticles.has(box.dataset.articleId);
    box.onchange = updatePushSelection;
  });
}

function filterPushArticles() {
  const exam = $("#push-exam").value;
  const type = $("#push-type").value;
  const search = $("#push-search").value.trim().toLowerCase();
  const visible = state.articles.filter(
    (article) =>
      (!exam || article.examId === exam) &&
      (!type || article.eyebrow === type) &&
      (!search ||
        article.title.toLowerCase().includes(search) ||
        article.eyebrow.toLowerCase().includes(search)),
  );
  const visibleIds = new Set(visible.map((item) => item.id));
  state.selectedArticles = new Set(
    [...state.selectedArticles].filter((id) => visibleIds.has(id)),
  );
  $("#push-article-list").innerHTML =
    visible.map(articleCheck).join("") ||
    '<div class="empty">没有符合筛选条件的文章</div>';
  $("#article-filter-summary").textContent = `选择文章 · ${visible.length} 篇`;
  bindArticleChecks();
  updatePushSelection();
}

function articleCheck(article) {
  return `<label class="check-item"><input type="checkbox" data-article-id="${article.id}"><span><strong>${escapeHtml(article.title)}</strong><span>${examNames[article.examId]} · ${article.year} · ${article.questionCount} 题</span></span></label>`;
}
function userCheck(user) {
  return `<label class="check-item"><input type="checkbox" data-user-id="${user.id}"><span><strong>${escapeHtml(user.deviceId)}</strong><span>${examNames[user.examId]} · 已读 ${user.readArticles} 篇</span></span></label>`;
}
function updatePushSelection() {
  state.selectedArticles = new Set(
    [...document.querySelectorAll("[data-article-id]:checked")].map(
      (box) => box.dataset.articleId,
    ),
  );
  state.selectedUsers = new Set(
    [...document.querySelectorAll("[data-user-id]:checked")].map(
      (box) => box.dataset.userId,
    ),
  );
  const userCount = $("#all-users").checked
    ? state.users.length
    : state.selectedUsers.size;
  const deliveries = state.selectedArticles.size * userCount;
  $("#article-selected").textContent = `${state.selectedArticles.size} 篇`;
  $("#delivery-count").textContent = `预计产生 ${deliveries} 条推送`;
  $("#send-push").disabled = deliveries === 0;
}

async function sendPush() {
  const allUsers = $("#all-users").checked;
  const count =
    state.selectedArticles.size *
    (allUsers ? state.users.length : state.selectedUsers.size);
  if (!confirm(`将创建 ${count} 条用户推送，确认继续吗？`)) return;
  $("#send-push").disabled = true;
  try {
    const data = await api("/pushes", {
      method: "POST",
      body: JSON.stringify({
        name: $("#push-name").value,
        message: $("#push-message").value,
        articleIds: [...state.selectedArticles],
        userIds: allUsers ? undefined : [...state.selectedUsers],
        allUsers,
      }),
    });
    toast(`推送成功，共送达 ${data.deliveries} 条`);
    await render("push");
  } catch (error) {
    toast(error.message, true);
    $("#send-push").disabled = false;
  }
}

async function renderPushHistory() {
  try {
    const pushes = await api("/pushes");
    $("#push-history").outerHTML =
      `<div id="push-history" class="table-wrap"><table><thead><tr><th>推送</th><th>文章</th><th>用户</th><th>已打开</th><th>创建时间</th></tr></thead><tbody>${pushes.map((p) => `<tr><td><strong>${escapeHtml(p.name)}</strong><br><span class="muted">${escapeHtml(p.message)}</span></td><td>${p.articleCount}</td><td>${p.userCount}</td><td>${p.openedCount || 0}</td><td>${new Date(p.createdAt).toLocaleString()}</td></tr>`).join("") || '<tr><td colspan="5" class="empty">暂无手动推送</td></tr>'}</tbody></table></div>`;
  } catch (error) {
    $("#push-history").textContent = error.message;
  }
}

async function renderUsers() {
  state.users = await api("/users");
  content.innerHTML = `
    <div class="section-head"><div><h2>用户运营数据</h2><p>查看每个设备收到、打开和完成的阅读与题目</p></div><button class="button primary" data-go="push">给用户推送</button></div>
    <div class="table-wrap"><table><thead><tr><th>用户设备</th><th>考试目标</th><th>推送文章</th><th>阅读文章</th><th>答题进度</th><th>生词</th><th>最近阅读</th></tr></thead><tbody>
      ${
        state.users
          .map((user) => {
            const rate = user.pushedQuestions
              ? Math.round(
                  (user.answeredQuestions / user.pushedQuestions) * 100,
                )
              : 0;
            return `<tr><td><strong>${escapeHtml(user.deviceId)}</strong><br><span class="muted">${user.id.slice(0, 8)}…</span></td><td><span class="badge">${examNames[user.examId]}</span></td><td>${user.pushedArticles} 篇<br><span class="muted">${user.pushedQuestions} 题</span></td><td>${user.readArticles} 篇</td><td><div class="progress-cell"><div class="mini-progress"><i style="width:${Math.min(100, rate)}%"></i></div><span>${user.answeredQuestions}/${user.pushedQuestions}</span></div></td><td>${user.savedWords}</td><td>${user.lastReadAt ? new Date(user.lastReadAt).toLocaleString() : "尚未阅读"}</td></tr>`;
          })
          .join("") ||
        '<tr><td colspan="7" class="empty">暂无用户数据</td></tr>'
      }
    </tbody></table></div>`;
  bindGoButtons();
}

function examOptions(selected) {
  return Object.entries(examNames)
    .map(
      ([id, name]) =>
        `<option value="${id}" ${id === selected ? "selected" : ""}>${name}</option>`,
    )
    .join("");
}
function bindGoButtons() {
  document
    .querySelectorAll("[data-go]")
    .forEach((button) => (button.onclick = () => render(button.dataset.go)));
}

$("#login-button").onclick = login;
const isLocalAdmin = ["127.0.0.1", "localhost", "::1"].includes(
  window.location.hostname,
);
if (isLocalAdmin) {
  $("#local-dev-login").classList.remove("hidden");
}
$("#local-dev-login").onclick = () => {
  $("#admin-key").value = "dev-admin-change-me";
  login();
};
$("#toggle-key").onclick = () => {
  const input = $("#admin-key");
  const revealed = input.classList.toggle("revealed");
  $("#toggle-key").textContent = revealed ? "隐藏" : "显示";
  $("#toggle-key").setAttribute(
    "aria-label",
    revealed ? "隐藏管理员密钥" : "显示管理员密钥",
  );
  input.focus();
};
$("#admin-key").oninput = () => {
  $("#login-error").textContent = "";
};
$("#admin-key").onkeydown = (event) => event.key === "Enter" && login();
$("#logout").onclick = () => {
  localStorage.removeItem("rr-admin-key");
  state.key = "";
  showLogin();
};
$("#menu-button").onclick = () => $(".sidebar").classList.toggle("open");
document
  .querySelectorAll(".nav-item")
  .forEach((item) => (item.onclick = () => render(item.dataset.view)));
window.retryView = () => render(state.view);

// Do not auto-submit a cached key. A stale validation response can otherwise
// finish while the operator is typing and replace the new input value.
showLogin();
