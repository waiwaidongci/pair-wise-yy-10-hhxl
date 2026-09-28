/* 界面层：渲染看板、部件卡点、详情弹窗；所有判定调用 Logic，所有数据变更走 Store。 */
(function () {
  "use strict";

  const Store = window.Store;
  const Logic = window.Logic;
  const STAGES = Logic.STAGES;

  Store.load();

  const form = document.querySelector("#workForm");
  const board = document.querySelector("#board");
  const statusFilter = document.querySelector("#statusFilter");
  const themeFilter = document.querySelector("#themeFilter");
  const sortMode = document.querySelector("#sortMode");
  const dialog = document.querySelector("#detailDialog");
  const detailContent = document.querySelector("#detailContent");
  const detailTitle = document.querySelector("#detailTitle");
  let activeId = null;

  form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
  statusFilter.innerHTML = `<option value="">全部状态</option>` +
    Logic.KANBAN.map(s => `<option>${s}</option>`).join("");

  function esc(v) {
    return String(v == null ? "" : v)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function renderBlockLines(blocks, levels) {
    return blocks
      .filter(b => !levels || levels.includes(b.level))
      .map(b => `<div class="blockline ${b.level}">${esc(b.text)}</div>`)
      .join("");
  }

  // ---------- 顶部三个小列表 ----------

  function renderSummaries() {
    const drying = Logic.todayDrying();
    const defects = Logic.defectiveComponents();
    const deliveries = Store.works.slice()
      .sort((a, b) => (a.delivery || "").localeCompare(b.delivery || ""))
      .slice(0, 4);

    document.querySelector("#todayDry").innerHTML = drying.length
      ? drying.map(({ work, comp, overdue }) => `
        <div class="item ${overdue ? "overdue" : ""}" data-action="open" data-id="${work.id}">
          <b>${esc(work.theme)}</b> · ${esc(comp.name)}
          <div class="meta">架位 ${esc(comp.rack)} · ${comp.rackStart}～${comp.rackEnd}${overdue ? " · 已逾期未下架" : ""}</div>
        </div>`).join("")
      : `<div class="empty">暂无在架部件</div>`;

    document.querySelector("#defectList").innerHTML = defects.length
      ? defects.map(({ work, comp }) => `
        <div class="item overdue" data-action="open" data-id="${work.id}">
          <b>${esc(work.theme)}</b> · ${esc(comp.name)}
          <div class="meta">${esc(comp.defect)}</div>
        </div>`).join("")
      : `<div class="empty">暂无</div>`;

    document.querySelector("#deliveryList").innerHTML = deliveries.map(w => {
      const elig = Logic.deliveryEligibility(w);
      return `<div class="item ${elig.eligible ? "" : "overdue"}" data-action="open" data-id="${w.id}">
        <b>${esc(w.theme)}</b>
        <div class="meta">交付 ${w.delivery || "未定"} · ${Logic.getWorkStatus(w)}<br>${esc(elig.text)}</div>
      </div>`;
    }).join("");
  }

  // ---------- 看板 ----------

  function compLine(work, c) {
    const blocks = Logic.componentBlocks(work, c);
    const rack = c.stage === "阴干" && c.rack
      ? `<span class="rack">架位 ${esc(c.rack)}（${esc(c.rackStart)}～${esc(c.rackEnd)}）</span>` : "";
    return `<div class="comp">
      <div class="comp-head">
        <b>${esc(c.name)}</b>
        <span class="stage st${STAGES.indexOf(c.stage)}">${c.stage}</span>
        ${rack}
      </div>
      <div class="meta">${esc(c.size || "尺寸未填")} · 金粉：${esc(c.gold)}${c.defect ? " · 缺陷：" + esc(c.defect) : ""}</div>
      ${renderBlockLines(blocks, ["block", "warn"])}
    </div>`;
  }

  function renderBoard() {
    const list = Logic.filteredWorks({
      theme: themeFilter.value,
      status: statusFilter.value,
      sort: sortMode.value
    });
    board.innerHTML = Logic.KANBAN.map(status => {
      const cards = list.filter(w => Logic.getWorkStatus(w) === status);
      return `<section class="col">
        <h3><span>${status}</span><span>${cards.length}</span></h3>
        ${cards.length ? cards.map(w => cardHtml(w, status)).join("") : `<div class="empty">暂无作品</div>`}
      </section>`;
    }).join("");
  }

  function cardHtml(w, status) {
    const joined = w.assembly && w.assembly.valid;
    const canJoin = Logic.canAssemble(w) && !joined;
    const actions = [
      `<button data-action="open" data-id="${w.id}">部件详情</button>`
    ];
    if (canJoin) actions.push(`<button class="violet" data-action="join" data-id="${w.id}">合拢</button>`);
    if (joined && !w.assembly.deliveredAt) {
      actions.push(`<button class="warn" data-action="deliver" data-id="${w.id}">交付</button>`);
    }
    return `<article class="item ${w.components.some(c => c.defect) ? "overdue" : ""}">
      <b>${esc(w.theme)}</b>
      <div class="meta">${esc(w.base)} · ${esc(w.line)} · 总进度 ${Logic.progress(w)}% · 交付 ${esc(w.delivery)}</div>
      ${w.components.map(c => compLine(w, c)).join("")}
      <div class="actions">${actions.join("")}</div>
    </article>`;
  }

  // ---------- 详情弹窗 ----------

  function bannerHtml(w) {
    const blocks = Logic.assemblyBlocks(w);
    const joined = w.assembly && w.assembly.valid;
    const elig = Logic.deliveryEligibility(w);
    let cls, extra = "";
    if (joined) {
      cls = "ok";
      if (!w.assembly.deliveredAt) {
        extra = `<div class="actions"><button class="warn" data-action="deliver" data-id="${w.id}">确认交付</button></div>`;
      }
    } else if ((w.assemblyHistory || []).length) {
      cls = "void";
      if (Logic.canAssemble(w)) extra = `<div class="actions"><button class="violet" data-action="join" data-id="${w.id}">按新值重新合拢</button></div>`;
    } else if (Logic.canAssemble(w)) {
      cls = "ready";
      extra = `<div class="actions"><button class="violet" data-action="join" data-id="${w.id}">合拢</button></div>`;
    } else {
      cls = "void";
    }
    return `<div class="banner ${cls}">
      <b>${joined ? "已合拢" : "合拢与交付资格"}</b>：${esc(elig.text)}
      ${renderBlockLines(blocks, ["block", "warn"])}
      ${extra}
    </div>`;
  }

  function compHtml(w, c) {
    const blocks = Logic.componentBlocks(w, c);
    const stageBtns = STAGES.map((s, i) =>
      `<button type="button" class="${s === c.stage ? "secondary" : ""}" data-action="stage" data-comp="${c.id}" data-stage="${s}" ${s === c.stage ? "disabled" : ""}>${s}</button>`
    ).join("");
    return `
    <div class="dsec">
      <h3>部件：${esc(c.name)}</h3>
      <form data-form="comp" data-comp="${c.id}" class="compform">
        <div class="grid3">
          <label>部件名称<input name="name" value="${esc(c.name)}" required></label>
          <label>部件类型<input name="kind" value="${esc(c.kind)}" placeholder="正板/侧板/纹样条"></label>
          <label>尺寸<input name="size" value="${esc(c.size)}" placeholder="如 20×15cm"></label>
        </div>
        <div class="grid3">
          <label>阴干架位<input name="rack" value="${esc(c.rack)}" placeholder="如 A架-2"></label>
          <label>上架日期<input name="rackStart" type="date" value="${esc(c.rackStart)}"></label>
          <label>预计下架<input name="rackEnd" type="date" value="${esc(c.rackEnd)}"></label>
        </div>
        <div class="meta">金粉状态：${esc(c.gold)}</div>
        <label>工序推进（顺序：贴线 → 阴干 → 上金粉 → 完成；可回退）
          <div class="stagebtns">${stageBtns}</div>
        </label>
        <button type="submit" class="secondary">保存部件信息</button>
        ${renderBlockLines(blocks)}
      </form>
      <form data-form="defect" data-comp="${c.id}" style="display:flex; gap:8px; align-items:end;">
        <label style="flex:1">记录缺陷（断线/翘线位置）
          <input name="defect" placeholder="${esc(c.defect || "无")}" value="">
        </label>
        <button class="warn" type="submit">保存缺陷</button>
      </form>
      <div class="meta">最近记录：${esc(c.logs.slice(-2).join(" / "))}</div>
    </div>`;
  }

  function renderDetail() {
    const w = Store.findWork(activeId);
    if (!w) return;
    detailTitle.textContent = `${w.theme} · ${w.base}`;
    detailContent.innerHTML = `
      ${bannerHtml(w)}

      <form data-form="workInfo" class="dsec">
        <h3>整件信息${(w.assembly && w.assembly.valid) ? "（合拢后修改胎体将令合拢失效并按新值重算）" : ""}</h3>
        <div class="grid2">
          <label>胎体材质<input name="base" value="${esc(w.base)}" required></label>
          <label>纹样主题<input name="theme" value="${esc(w.theme)}" required></label>
        </div>
        <div class="grid2">
          <label>线条粗细<select name="line">
            ${["细线", "中线", "粗线", "混合线"].map(l => `<option ${l === w.line ? "selected" : ""}>${l}</option>`).join("")}
          </select></label>
          <label>交付日期<input name="delivery" type="date" value="${esc(w.delivery)}"></label>
        </div>
        <label>备注<textarea name="note">${esc(w.note)}</textarea></label>
        <button type="submit" class="secondary">保存整件信息</button>
      </form>

      <div class="dsec">
        <h3>部件工序（共 ${w.components.length} 块，全部完成方可合拢）</h3>
        ${w.components.map(c => compHtml(w, c)).join("")}
      </div>

      <form data-form="addComp" class="dsec">
        <h3>登记新部件</h3>
        <div class="grid3">
          <label>部件名称<input name="name" required placeholder="如 左侧板"></label>
          <label>类型<input name="kind" placeholder="正板/侧板/纹样条"></label>
          <label>尺寸<input name="size" placeholder="如 20×4cm"></label>
        </div>
        <button class="violet" type="submit">登记部件</button>
      </form>

      <div class="dsec">
        <h3>合拢留档</h3>
        ${(w.assemblyHistory || []).length ? historyBlock(w) : `<div class="empty">暂无失效留档</div>`}
      </div>

      <div class="dsec">
        <h3>整件流转记录</h3>
        <div class="meta">${esc(w.logs.slice(-8).join(" / "))}</div>
      </div>
    `;
  }

  function historyBlock(w) {
    return (w.assemblyHistory || []).map(h => `
      <div class="history">
        <div><b>旧合拢（已失效留档）</b> · ${esc(h.at)}${h.voidedAt ? " · 失效于 " + esc(h.voidedAt) : ""}</div>
        ${h.deliveredAt ? `<div>交付时间：${esc(h.deliveredAt)}</div>` : ""}
        <div class="snapshot">留档快照：${esc(h.snapshot ? h.snapshot.summary : "")}</div>
        <div>失效原因：${esc(h.reason || "")}</div>
      </div>`).join("");
  }

  function openDetail(id) {
    activeId = id;
    renderDetail();
    dialog.showModal();
  }

  function refresh() {
    Store.save();
    renderSummaries();
    renderBoard();
    if (activeId && dialog.open) renderDetail();
  }

  function report(res, successMsg) {
    if (!res.ok && res.error) window.alert(res.error);
    else if (successMsg) console.info(successMsg);
  }

  // ---------- 事件 ----------

  form.addEventListener("submit", event => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const work = Store.addWork(data);
    form.reset();
    form.delivery.value = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    renderSummaries();
    renderBoard();
    openDetail(work.id);
  });

  // 看板 / 列表按钮统一委托
  document.addEventListener("click", event => {
    const btn = event.target.closest("[data-action]");
    if (!btn) return;
    const id = btn.dataset.id || activeId;
    if (btn.dataset.action === "open") {
      openDetail(btn.dataset.id);
    } else if (btn.dataset.action === "join") {
      report(Logic.joinWork(id));
      refresh();
    } else if (btn.dataset.action === "deliver") {
      const w = Store.findWork(id);
      if (w && w.assembly && w.assembly.valid && !w.assembly.deliveredAt) {
        Store.markDelivered(id);
      }
      refresh();
    } else if (btn.dataset.action === "stage") {
      const res = Logic.setStage(id, btn.dataset.comp, btn.dataset.stage);
      report(res);
      refresh();
    }
  });

  // 弹窗内表单统一委托
  document.addEventListener("submit", event => {
    const f = event.target.closest("form[data-form]");
    if (!f) return;
    event.preventDefault();
    const data = Object.fromEntries(new FormData(f).entries());
    const kind = f.dataset.form;
    if (kind === "workInfo") {
      const w = Store.findWork(activeId);
      if (data.base !== w.base) Logic.changeBase(activeId, data.base);
      const patch = {};
      ["theme", "line", "delivery", "note"].forEach(key => {
        if (data[key] !== w[key]) patch[key] = data[key];
      });
      if (Object.keys(patch).length) Store.updateWork(activeId, patch);
      refresh();
    } else if (kind === "addComp") {
      Store.addComponent(activeId, data);
      refresh();
    } else if (kind === "comp") {
      Store.updateComponent(activeId, f.dataset.comp, {
        name: data.name, kind: data.kind, size: data.size,
        rack: data.rack, rackStart: data.rackStart, rackEnd: data.rackEnd
      });
      refresh();
    } else if (kind === "defect") {
      if (data.defect.trim()) Store.recordDefect(activeId, f.dataset.comp, data.defect.trim());
      refresh();
    }
  });

  document.querySelector("#closeDialog").addEventListener("click", () => dialog.close());
  document.querySelector("#clearFilters").addEventListener("click", () => {
    themeFilter.value = "";
    statusFilter.value = "";
    renderBoard();
  });
  [statusFilter, themeFilter, sortMode].forEach(el => el.addEventListener("input", renderBoard));

  document.querySelector("#exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify(Store.works, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "lacquer-thread-works.json";
    link.click();
    URL.revokeObjectURL(link.href);
  });

  renderSummaries();
  renderBoard();
})();
