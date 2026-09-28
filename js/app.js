/* 界面层：渲染与交互。数据走 Store，判定走 Rules；筛选、缺陷、导出沿用原逻辑。 */
(function () {
  const $ = sel => document.querySelector(sel);
  const STAGES = window.PART_STAGES;
  const today = window.todayStr();

  let works = window.Store.load();
  let activeId = null;

  const form = $("#workForm");
  const board = $("#board");
  const statusFilter = $("#statusFilter");
  const themeFilter = $("#themeFilter");
  const sortMode = $("#sortMode");
  const dialog = $("#detailDialog");

  function esc(v) {
    return String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  /* ---------- 新增作品表单：部件行 ---------- */
  function partRowHTML(name) {
    return `<div class="partrow">
      <input class="p-name" placeholder="名称(正板/侧板/纹样条)" value="${name || ""}" required>
      <input class="p-size" placeholder="尺寸，如30×20cm" required>
      <input class="p-rack" placeholder="阴干架位，如A-2" required>
      <input class="p-ds" type="date" value="${today}">
      <input class="p-de" type="date" value="${defaultEnd()}">
      <button type="button" class="secondary rm-row" title="移除该块">×</button>
    </div>`;
  }
  function defaultEnd() {
    return new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10);
  }

  function defaultPartRows() {
    const box = $("#partRows");
    box.innerHTML = ["正板", "侧板", "纹样条"].map(n => partRowHTML(n)).join("");
  }
  function ensurePartRows() {
    if (!$("#partRows").children.length) defaultPartRows();
  }

  form.addEventListener("click", e => {
    if (e.target.classList.contains("rm-row")) e.target.closest(".partrow").remove();
    if (e.target.id === "addPartRow") $("#partRows").insertAdjacentHTML("beforeend", partRowHTML(""));
  });

  form.addEventListener("reset", () => setTimeout(defaultPartRows, 0));

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const parts = [...document.querySelectorAll("#partRows .partrow")].map(row => ({
      name: row.querySelector(".p-name").value.trim(),
      size: row.querySelector(".p-size").value.trim(),
      rack: row.querySelector(".p-rack").value.trim(),
      dryStart: row.querySelector(".p-ds").value,
      dryEnd: row.querySelector(".p-de").value
    })).filter(p => p.name || p.size || p.rack);
    if (!parts.length) { alert("至少登记一块部件（名称、尺寸、阴干架位）"); return; }
    const missing = parts.find(p => !p.name || !p.size || !p.rack || !p.dryStart || !p.dryEnd);
    if (missing) { alert("每块都要登记名称、尺寸、阴干架位与阴干时段"); return; }
    window.Store.addWork({ ...data, parts });
    works = window.Store.works;
    form.reset();
    render();
  });

  /* ---------- 操作 ---------- */
  function setPartStage(workId, partId, stage) {
    window.Store.setPartStage(workId, partId, stage);
    works = window.Store.works;
    render();
    if (activeId === workId) showDetail(workId);
  }

  function recordDefect(workId, partId, text) {
    const value = text || prompt("输入断线/翘线位置");
    if (!value) return;
    window.Store.recordDefect(workId, partId, value.trim());
    works = window.Store.works;
    render();
    if (activeId === workId) showDetail(workId);
  }

  function patchPart(workId, partId, field, el) {
    window.Store.updatePart(workId, partId, { [field]: el.value });
    works = window.Store.works;
    render();
    showDetail(workId);
  }

  function patchWork(workId, field, el) {
    window.Store.updateWork(workId, { [field]: el.value });
    works = window.Store.works;
    render();
    showDetail(workId);
  }

  function addPart(workId) {
    const name = prompt("部件名称（正板/侧板/纹样条/其他）", "纹样条");
    if (!name) return;
    const size = prompt("尺寸，如 28×3cm");
    if (size === null) return;
    const rack = prompt("阴干架位，如 A-2");
    if (rack === null) return;
    window.Store.addPart(workId, { name: name.trim(), size: size.trim(), rack: rack.trim() });
    works = window.Store.works;
    render();
    showDetail(workId);
  }

  function assemble(workId) {
    if (!window.Rules.canAssemble(window.Store.findWork(workId), works)) {
      alert("还有部件未完成或存在卡点，不能合拢（见详情中的卡点列表）");
      return;
    }
    window.Store.assemble(workId);
    works = window.Store.works;
    render();
    showDetail(workId);
  }

  /* ---------- 概览三列表（沿用原有：今日待阴干 / 缺陷 / 最近交付） ---------- */
  function renderSummaries() {
    const conflicts = window.Rules.rackConflicts(works);
    const drying = [];
    works.forEach(w => w.parts.forEach(p => {
      if (p.stage === "阴干" && p.dryStart <= today) {
        drying.push({ w, p, conflict: conflicts[`${w.id}:${p.id}`] });
      }
    }));
    $("#todayDry").innerHTML = drying.length ? drying.map(({ w, p, conflict }) =>
      `<div class="item ${conflict ? "overdue" : ""}" onclick="showDetail('${w.id}')">
        <b>${esc(w.theme)} · ${esc(p.name)}</b>
        <div class="meta">架位 ${esc(p.rack)} · ${esc(p.dryStart)}~${esc(p.dryEnd)}${conflict ? "<br>架位冲突：见详情" : ""}</div>
      </div>`).join("") : `<div class="empty">暂无</div>`;

    const defects = works.filter(w => w.defect || w.parts.some(p => p.defect));
    $("#defectList").innerHTML = defects.length ? defects.map(w => {
      const ds = [w.defect && `整件：${w.defect}`, ...w.parts.filter(p => p.defect).map(p => `${p.name}：${p.defect}`)].filter(Boolean);
      return `<div class="item overdue" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(ds.join("；"))}</div></div>`;
    }).join("") : `<div class="empty">暂无</div>`;

    const delivery = [...works].sort((a, b) => a.delivery.localeCompare(b.delivery)).slice(0, 4);
    $("#deliveryList").innerHTML = delivery.map(w =>
      `<div class="item" onclick="showDetail('${w.id}')"><b>${esc(w.theme)}</b><div class="meta">${esc(w.delivery)} · ${window.Rules.workStatus(w)}</div></div>`).join("");
  }

  /* ---------- 看板：按作品派生状态分列，卡片展示每块卡点 ---------- */
  function dotsHTML(w, p, conflicts) {
    return `<span class="dots" onclick="event.stopPropagation()">` + STAGES.map(s => {
      const cls = s === p.stage ? "on" : (STAGES.indexOf(s) < STAGES.indexOf(p.stage) ? "done" : "");
      return `<span class="dot ${cls}" title="推进到${s}" onclick="setPartStage('${w.id}','${p.id}','${s}')">${s}</span>`;
    }).join("") + `</span>`;
  }

  function partCardHTML(w, p, conflicts) {
    const blockers = window.Rules.partBlockers(w, p, conflicts);
    return `<div class="prow ${p.defect ? "hasdef" : ""}">
      <div><b>${esc(p.name)}</b> <span class="meta">${p.size ? esc(p.size) : "未登记尺寸"} · 架位 ${p.rack ? esc(p.rack) : "未登记"} · ${esc(p.dryStart) || "?"}~${esc(p.dryEnd) || "?"}</span></div>
      ${dotsHTML(w, p, conflicts)}
      ${blockers.map(r => `<div class="block">⛔ ${esc(r)}</div>`).join("")}
      ${p.defect ? `<div class="block warn">缺陷：${esc(p.defect)}</div>` : ""}
    </div>`;
  }

  function renderBoard() {
    const list = window.Rules.filtered(works, {
      status: statusFilter.value,
      theme: themeFilter.value,
      sort: sortMode.value
    });
    const check = window.Rules.assemblyCheck(works);
    board.innerHTML = window.Rules.WORK_STATUSES.map(status => {
      const cards = list.filter(w => window.Rules.workStatus(w) === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => {
          const conflicts = check(w).conflicts;
          const elig = window.Rules.deliveryEligibility(w);
          const anyDefect = w.defect || w.parts.some(p => p.defect);
          return `<article class="item ${anyDefect ? "overdue" : ""}" onclick="showDetail('${w.id}')">
            <b>${esc(w.theme)}</b>
            <div class="meta">${esc(w.base)} · ${esc(w.line)} · ${w.parts.length}块 · 交付 ${esc(w.delivery)}</div>
            ${w.parts.map(p => partCardHTML(w, p, conflicts)).join("") || `<div class="block">未登记部件</div>`}
            <div class="elig ${elig.ok ? "ok" : "bad"} ${elig.stale ? "stale" : ""}">${elig.ok ? "✓" : "⛔"} ${esc(elig.text)}</div>
            <div class="actions" onclick="event.stopPropagation()">
              <button class="secondary" onclick="showDetail('${w.id}')">详情/修改</button>
              ${window.Rules.workStatus(w) === "合拢" ? `<button onclick="assemble('${w.id}')">合拢</button>` : ""}
              <button class="warn" onclick="recordDefect('${w.id}','')">记缺陷</button>
            </div>
          </article>`;
        }).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  /* ---------- 详情弹窗：改尺寸/胎体/步骤即重算，旧合拢留档 ---------- */
  function partEditHTML(w, p, conflicts) {
    const blockers = window.Rules.partBlockers(w, p, conflicts);
    return `<div class="partedit ${p.defect ? "hasdef" : ""}">
      <div class="pe-head"><b>${esc(p.name)}</b>${dotsHTML(w, p, conflicts)}</div>
      <div class="pe-grid">
        <label>名称<input value="${esc(p.name)}" onchange="patchPart('${w.id}','${p.id}','name',this)"></label>
        <label>尺寸<input value="${esc(p.size)}" placeholder="30×20cm" onchange="patchPart('${w.id}','${p.id}','size',this)"></label>
        <label>架位<input value="${esc(p.rack)}" placeholder="A-2" onchange="patchPart('${w.id}','${p.id}','rack',this)"></label>
        <label>阴干起<input type="date" value="${esc(p.dryStart)}" onchange="patchPart('${w.id}','${p.id}','dryStart',this)"></label>
        <label>阴干止<input type="date" value="${esc(p.dryEnd)}" onchange="patchPart('${w.id}','${p.id}','dryEnd',this)"></label>
      </div>
      ${blockers.map(r => `<div class="block">⛔ ${esc(r)}</div>`).join("")}
      ${p.defect ? `<div class="block warn">缺陷：${esc(p.defect)}</div>` : ""}
      <div class="inline">
        <input id="def-${p.id}" placeholder="该块断线/翘线位置">
        <button class="warn" onclick="recordDefect('${w.id}','${p.id}',document.getElementById('def-${p.id}').value)">记该块缺陷</button>
      </div>
    </div>`;
  }

  function showDetail(id) {
    activeId = id;
    const w = window.Store.findWork(id);
    if (!w) return;
    const result = window.Rules.assemblyCheck(works)(w);
    const elig = window.Rules.deliveryEligibility(w);
    $("#detailTitle").textContent = `${w.theme} · ${w.base}`;
    $("#detailContent").innerHTML = `
      <div class="pe-grid">
        <label>纹样主题<input value="${esc(w.theme)}" onchange="patchWork('${w.id}','theme',this)"></label>
        <label>胎体材质<input value="${esc(w.base)}" onchange="patchWork('${w.id}','base',this)"></label>
        <label>线条粗细
          <select onchange="patchWork('${w.id}','line',this)">
            ${["细线", "中线", "粗线", "混合线"].map(l => `<option ${l === w.line ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </label>
        <label>交付日期<input type="date" value="${esc(w.delivery)}" onchange="patchWork('${w.id}','delivery',this)"></label>
      </div>
      <label>备注<textarea onchange="patchWork('${w.id}','note',this)">${esc(w.note)}</textarea></label>
      ${w.defect ? `<div class="block warn">整件缺陷：${esc(w.defect)}</div>` : ""}
      <h4>各部件（${w.parts.length} 块，合拢前每块都要完成）</h4>
      ${w.parts.map(p => partEditHTML(w, p, result.conflicts)).join("") || `<div class="empty">尚未登记部件</div>`}
      <button class="violet" onclick="addPart('${w.id}')">+ 登记一块部件</button>
      <h4>合拢与交付资格</h4>
      <div class="elig ${elig.ok ? "ok" : "bad"} ${elig.stale ? "stale" : ""}">${elig.ok ? "✓" : "⛔"} ${esc(elig.text)}</div>
      ${!result.ok ? `<div class="checklist"><b>合拢前卡点：</b>${result.blockers.map(b =>
        `<div class="block">⛔ ${b.part ? esc(b.part.name) + "：" : ""}${b.reasons.map(esc).join("；")}</div>`).join("")}</div>`
        : `<div class="empty">全部部件已完成、无卡点，可以合拢。</div>`}
      <button ${result.ok ? "" : "disabled"} onclick="assemble('${w.id}')">${result.ok ? "执行合拢" : "尚有卡点，不能合拢"}</button>
      ${w.assemblyHistory.length ? `<h4>旧合拢记录留档（${w.assemblyHistory.length}）</h4>` + w.assemblyHistory.slice().reverse().map(h => `
        <div class="archive">
          <div><b>${esc(h.assembledAt)}</b> 合拢，于 ${esc(h.at)} 作废</div>
          <div class="block warn">原因：${esc(h.reason)}</div>
          <div class="meta">当时登记：${h.snapshot.map(s => `${esc(s.name)}(${esc(s.size)},${esc(s.stage)},架${esc(s.rack)})`).join("；")}</div>
        </div>`).join("") : ""}
      <details><summary>流转记录</summary><div class="meta logs">${w.logs.slice().reverse().map(esc).join("<br>")}</div></details>
    `;
    dialog.showModal();
  }

  function render() {
    renderSummaries();
    renderBoard();
  }

  /* ---------- 工具栏与导出（沿用原有） ---------- */
  statusFilter.innerHTML = `<option value="">全部状态</option>` + window.Rules.WORK_STATUSES.map(s => `<option>${s}</option>`).join("");
  $("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    sortMode.value = "delivery";
    render();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", render));

  $("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({ version: 2, works: window.Store.works }, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });
  $("#closeDialog").addEventListener("click", () => dialog.close());

  window.setPartStage = setPartStage;
  window.recordDefect = recordDefect;
  window.patchPart = patchPart;
  window.patchWork = patchWork;
  window.addPart = addPart;
  window.assemble = assemble;
  window.showDetail = showDetail;

  ensurePartRows();
  form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  render();
})();
