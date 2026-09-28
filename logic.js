/* 判定层：工序卡点、阴干架位冲突、合拢资格、交付资格、看板状态派生。
   只读写 Store，不接触 DOM。 */
(function () {
  "use strict";

  const { STAGES, KANBAN, TODAY, GOLD_BY_STAGE } = window.Store;

  // ---------- 基础派生 ----------

  function allComponents(work) {
    return work.components || [];
  }

  // 整件看板状态
  function getWorkStatus(work) {
    const comps = allComponents(work);
    const joined = work.assembly && work.assembly.valid;
    if (joined && work.assembly.deliveredAt) return "已交付";
    if (joined) return "已合拢";
    if (!joined && (work.assemblyHistory || []).length) return "合拢已失效";
    if (comps.length && comps.every(c => c.stage === "完成")) return "待合拢";
    return "部件制作中";
  }

  function progress(work) {
    const comps = allComponents(work);
    if (!comps.length) return 0;
    const score = { "贴线": 0, "阴干": 0.5, "上金粉": 0.8, "完成": 1 };
    return Math.round(comps.reduce((sum, c) => sum + (score[c.stage] ?? 0), 0) / comps.length * 100);
  }

  function dryDate(work) {
    // 整件"阴干日期"取在阴干部件的最早架位起始日，兼容旧筛选/排序
    const starts = allComponents(work)
      .filter(c => c.stage === "阴干" && c.rackStart)
      .map(c => c.rackStart);
    return starts.sort()[0] || "";
  }

  function goldState(work) {
    const comps = allComponents(work);
    if (!comps.length) return "未处理";
    if (comps.every(c => c.gold === "已上金粉")) return "已上金粉";
    if (comps.some(c => c.gold !== "未处理")) return "试扫粉";
    return "未处理";
  }

  // ---------- 阴干架位冲突 ----------

  // 返回当前占用某架位、与给定时段重叠的其它部件
  function rackOccupants(workId, rack, start, end, selfCompId) {
    const key = (rack || "").trim();
    if (!key || !start || !end) return [];
    const out = [];
    window.Store.works.forEach(w => {
      allComponents(w).forEach(c => {
        if (c.id === selfCompId) return;
        if (c.stage !== "阴干" || !c.rack || c.rack.trim() !== key) return;
        if (!c.rackStart || !c.rackEnd) return;
        // 日期区间重叠
        if (start <= c.rackEnd && end >= c.rackStart) {
          out.push({ work: w, comp: c });
        }
      });
    });
    return out;
  }

  function conflictText(occ) {
    return `架位 ${occ.comp.rack.trim()} 时段冲突：${occ.work.theme}「${occ.comp.name}」占用 ${occ.comp.rackStart}～${occ.comp.rackEnd}`;
  }

  // ---------- 部件卡点 ----------

  function componentBlocks(work, comp) {
    const blocks = [];
    const idx = STAGES.indexOf(comp.stage);

    if (comp.defect) blocks.push({ level: "warn", text: `未处理缺陷：${comp.defect}` });

    if (comp.stage === "贴线") {
      if (!comp.rack || !comp.rackStart || !comp.rackEnd) {
        blocks.push({ level: "info", text: "登记阴干架位与起止日期后可推进阴干" });
      } else {
        const occ = rackOccupants(work.id, comp.rack, comp.rackStart, comp.rackEnd, comp.id);
        if (occ.length) {
          occ.forEach(o => blocks.push({ level: "block", text: conflictText(o) }));
        } else {
          blocks.push({ level: "info", text: `已预约架位 ${comp.rack.trim()}（${comp.rackStart}～${comp.rackEnd}），可进阴干` });
        }
      }
    }

    if (comp.stage === "阴干") {
      if (!comp.rack || !comp.rackStart || !comp.rackEnd) {
        blocks.push({ level: "block", text: "缺少阴干架位或起止日期" });
      } else {
        const occ = rackOccupants(work.id, comp.rack, comp.rackStart, comp.rackEnd, comp.id);
        if (occ.length) {
          occ.forEach(o => blocks.push({ level: "block", text: conflictText(o) }));
        }
        blocks.push({ level: "info", text: `架位 ${comp.rack.trim()} 阴干中（${comp.rackStart}～${comp.rackEnd}）` });
        if (TODAY > comp.rackEnd) blocks.push({ level: "warn", text: `阴干时段已于 ${comp.rackEnd} 到期，请及时下架上金粉` });
      }
    }

    if (comp.stage === "上金粉") {
      blocks.push({ level: "info", text: "金粉试扫后可推进完成" });
    }

    if (comp.stage === "完成") {
      blocks.push({ level: "info", text: "部件已完成，等待合拢" });
    }
    return blocks;
  }

  // ---------- 工序推进 / 回退 ----------

  function setStage(workId, compId, target) {
    const work = window.Store.findWork(workId);
    const comp = work && allComponents(work).find(c => c.id === compId);
    if (!comp) return { ok: false, error: "找不到部件" };
    const from = comp.stage;
    if (target === from) return { ok: true };
    const idx = STAGES.indexOf(from);
    const tidx = STAGES.indexOf(target);
    if (tidx < 0) return { ok: false, error: "未知工序" };

    if (tidx === idx + 1) {
      // 前进一步
      if (target === "阴干") {
        if (!comp.rack || !comp.rackStart || !comp.rackEnd) {
          return { ok: false, error: "请先登记阴干架位、上架日期与预计下架日期" };
        }
        if (comp.rackStart > comp.rackEnd) {
          return { ok: false, error: "上架日期不能晚于下架日期" };
        }
        const occ = rackOccupants(workId, comp.rack, comp.rackStart, comp.rackEnd, compId);
        if (occ.length) {
          return { ok: false, error: conflictText(occ[0]) + (occ.length > 1 ? ` 等 ${occ.length} 处冲突` : "") };
        }
      }
      if (target === "上金粉" && TODAY < comp.rackEnd) {
        return { ok: false, error: `阴干时段未满，预计 ${comp.rackEnd} 下架（架位 ${comp.rack || "未登记"} 现为本部件占用）` };
      }
      const patch = { stage: target };
      patch.gold = target === "上金粉" ? "试扫粉" : GOLD_BY_STAGE[target];
      window.Store.updateComponent(workId, compId, patch);
      window.Store.logStage(workId, compId, from, target);
      return { ok: true };
    }

    if (tidx < idx) {
      // 回退（合拢后从完成回退会使合拢失效，由 Store 处理）
      const patch = { stage: target, gold: GOLD_BY_STAGE[target] };
      if (target === "贴线") {
        patch.gold = "未处理";
      }
      window.Store.updateComponent(workId, compId, patch);
      window.Store.logStage(workId, compId, from, target, "工序回退");
      return { ok: true };
    }

    return { ok: false, error: "工序需按 贴线 → 阴干 → 上金粉 → 完成 顺序推进" };
  }

  // ---------- 合拢与交付资格 ----------

  function assemblyBlocks(work) {
    const blocks = [];
    const comps = allComponents(work);
    const joined = work.assembly && work.assembly.valid;

    if (!comps.length) blocks.push({ level: "block", text: "尚未登记任何部件，无法合拢" });
    const unfinished = comps.filter(c => c.stage !== "完成");
    if (unfinished.length) {
      blocks.push({ level: "block", text: `以下 ${unfinished.length} 块部件未完成，不能合拢：` +
        unfinished.map(c => `「${c.name}」${c.stage}`).join("、") });
    }

    const defective = comps.filter(c => c.defect);
    if (defective.length) {
      blocks.push({ level: "warn", text: "合拢前请确认缺陷处理：" +
        defective.map(c => `「${c.name}」${c.defect}`).join("、") });
    }

    if ((work.assemblyHistory || []).length && !joined) {
      const last = work.assemblyHistory[work.assemblyHistory.length - 1];
      blocks.push({ level: "warn", text: `已有合拢因变更失效并留档（${last.reason}），当前按新值重算，请重新合拢` });
    }

    if (joined) {
      blocks.push({ level: "info", text: work.assembly.deliveredAt
        ? `已于 ${work.assembly.deliveredAt} 交付`
        : "各部件均已完成并合拢，具备交付资格" });
    } else if (comps.length && !unfinished.length) {
      blocks.push({ level: "info", text: "全部部件完成，可以合拢" });
    }
    return blocks;
  }

  function canAssemble(work) {
    const comps = allComponents(work);
    return comps.length > 0 && comps.every(c => c.stage === "完成");
  }

  function joinWork(workId) {
    const work = window.Store.findWork(workId);
    if (!work) return { ok: false, error: "找不到作品" };
    const comps = allComponents(work);
    if (!comps.length) return { ok: false, error: "尚未登记部件，无法合拢" };
    const unfinished = comps.filter(c => c.stage !== "完成");
    if (unfinished.length) {
      return {
        ok: false,
        error: `合拢前各部件都要完成。未完成：` +
          unfinished.map(c => `「${c.name}」当前 ${c.stage}`).join("、")
      };
    }
    window.Store.saveAssembly(workId);
    return { ok: true };
  }

  function deliveryEligibility(work) {
    const joined = work.assembly && work.assembly.valid;
    if (joined && work.assembly.deliveredAt) {
      return { eligible: true, text: `已交付（${work.assembly.deliveredAt}）` };
    }
    if (joined) return { eligible: true, text: "已合拢，具备交付资格" };
    if ((work.assemblyHistory || []).length) {
      return { eligible: false, text: "合拢已按新值重算、旧记录留档，需重新合拢后方可交付" };
    }
    if (canAssemble(work)) return { eligible: false, text: "部件全部完成，合拢后即可交付" };
    const unfinished = allComponents(work).filter(c => c.stage !== "完成");
    return {
      eligible: false,
      text: unfinished.length
        ? `部件未齐，不具备交付资格（${unfinished.map(c => "「" + c.name + "」" + c.stage).join("、")}）`
        : "尚未登记部件"
    };
  }

  // 合拢后修改胎体（整件层面），同样令合拢失效
  function changeBase(workId, newBase) {
    const work = window.Store.findWork(workId);
    if (!work) return { ok: false };
    const old = work.base;
    if (!newBase || newBase === old) return { ok: true, changed: false };
    window.Store.updateWork(workId, { base: newBase });
    if (work.assembly && work.assembly.valid) {
      window.Store.voidAssembly(workId, `合拢后胎体变更（${old} → ${newBase}），按新值重算`, true);
    }
    return { ok: true, changed: true };
  }

  // ---------- 筛选 / 总览 ----------

  function filteredWorks(filters) {
    let list = window.Store.works.slice();
    const theme = (filters.theme || "").trim();
    if (theme) list = list.filter(w => (w.theme || "").includes(theme));
    if (filters.status) list = list.filter(w => getWorkStatus(w) === filters.status);
    list.sort((a, b) => {
      if (filters.sort === "dry") return (dryDate(a) || "9999").localeCompare(dryDate(b) || "9999");
      return (a.delivery || "").localeCompare(b.delivery || "");
    });
    return list;
  }

  // 今日仍在架（含逾期未下架）的部件
  function todayDrying() {
    const out = [];
    window.Store.works.forEach(w => {
      allComponents(w).forEach(c => {
        if (c.stage === "阴干" && c.rackStart && c.rackEnd && c.rackStart <= TODAY && c.rackEnd >= TODAY) {
          out.push({ work: w, comp: c, overdue: false });
        } else if (c.stage === "阴干" && c.rackEnd && TODAY > c.rackEnd) {
          out.push({ work: w, comp: c, overdue: true });
        }
      });
    });
    out.sort((a, b) => (a.comp.rackEnd || "").localeCompare(b.comp.rackEnd || ""));
    return out;
  }

  function defectiveComponents() {
    const out = [];
    window.Store.works.forEach(w => {
      allComponents(w).filter(c => c.defect).forEach(c => out.push({ work: w, comp: c }));
    });
    return out;
  }

  window.Logic = {
    KANBAN,
    STAGES,
    getWorkStatus,
    progress,
    dryDate,
    goldState,
    rackOccupants,
    conflictText,
    componentBlocks,
    assemblyBlocks,
    canAssemble,
    joinWork,
    setStage,
    deliveryEligibility,
    changeBase,
    filteredWorks,
    todayDrying,
    defectiveComponents
  };
})();
