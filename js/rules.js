/* 判定层：纯函数。部件卡点、架位冲突、作品状态、合拢/交付资格、筛选排序。 */
(function () {
  const STAGES = window.PART_STAGES; // ["贴线","阴干","上金粉","完成"]
  const WORK_STATUSES = ["贴线", "阴干", "上金粉", "合拢", "待交付"];
  const today = () => window.todayStr();

  /* 某块当前占用架位的时段；未完成且架位、起止日期齐全才算占用 */
  function occupancy(p) {
    if (!p || p.stage === "完成" || !p.rack || !p.dryStart || !p.dryEnd) return null;
    return { rack: p.rack, start: p.dryStart, end: p.dryEnd };
  }

  function overlaps(a, b) {
    return a.rack === b.rack && a.start <= b.end && b.start <= a.end;
  }

  /* 全局扫描架位占用，返回 conflictByPartId: "workId:partId" -> 占用人说明 */
  function rackConflicts(works) {
    const occ = [];
    works.forEach(w => w.parts.forEach(p => {
      const o = occupancy(p);
      if (o) occ.push({ key: `${w.id}:${p.id}`, work: w, part: p, ...o });
    }));
    const map = {};
    occ.forEach(a => {
      occ.forEach(b => {
        if (a.key === b.key) return;
        if (overlaps(a, b)) {
          map[a.key] = map[a.key] || [];
          const label = `「${b.work.theme}」的${b.part.name}（${b.start}~${b.end}，${b.part.stage}中）`;
          if (!map[a.key].includes(label)) map[a.key].push(label);
        }
      });
    });
    return map;
  }

  /* 单块部件的卡点（阻断点），数组形式，空数组=可继续推进 */
  function partBlockers(work, part, conflicts) {
    const out = [];
    const key = `${work.id}:${part.id}`;
    if (part.defect) out.push(`存在缺陷待处理：${part.defect}`);
    if (conflicts[key]) out.push(`架位 ${part.rack} 时段冲突，被 ${conflicts[key].join("、")} 占着`);
    if (part.stage !== "完成") {
      if (!part.rack) out.push("未登记阴干架位");
      if (!part.dryStart || !part.dryEnd) out.push("未登记阴干起止时段");
    }
    if (part.stage === "阴干" && part.dryEnd && today() < part.dryEnd) {
      out.push(`阴干未满（${part.dryEnd} 到期）`);
    }
    return out;
  }

  function partReady(work, part, conflicts) {
    return partBlockers(work, part, conflicts).length === 0;
  }

  /* 合拢资格：每块都要走到「完成」，且无缺陷/架位卡点 */
  function assemblyCheck(worksOrWork) {
    const works = Array.isArray(worksOrWork) ? worksOrWork : [worksOrWork];
    const conflicts = rackConflicts(works);
    return function check(work) {
      if (!work.parts.length) return { ok: false, conflicts, blockers: [{ part: null, reasons: ["尚未登记任何部件"] }] };
      const blockers = [];
      work.parts.forEach(p => {
        const reasons = partBlockers(work, p, conflicts);
        if (p.stage !== "完成") reasons.unshift(`工序停在「${p.stage}」，未完成`);
        if (reasons.length) blockers.push({ part: p, reasons });
      });
      if (work.defect) blockers.push({ part: null, reasons: [`整件缺陷未处理：${work.defect}`] });
      return { ok: blockers.length === 0, conflicts, blockers };
    };
  }

  function canAssemble(work, allWorks) {
    return assemblyCheck(allWorks || window.Store.works)(work).ok;
  }

  /* 作品展示状态（由部件状态派生；保留旧筛选档位） */
  function workStatus(work) {
    if (!work.parts.length) return "贴线";
    if (work.assembledAt) return "待交付";
    const idx = work.parts.map(p => STAGES.indexOf(p.stage));
    const min = Math.min(...idx);
    if (min === 3) return "合拢";          // 各块都完成，等待/需要合拢
    return STAGES[min];                    // 贴线/阴干/上金粉
  }

  /* 交付资格：合拢有效、合拢后没有关键修改作废、且当前无缺陷 */
  function deliveryEligibility(work) {
    const hasDefect = work.defect || work.parts.some(p => p.defect);
    if (work.assembledAt && work.assemblyRevision === work.revision && !hasDefect) {
      return { ok: true, stale: false, text: `已合拢（${work.assembledAt}），具备交付资格` };
    }
    if (work.assembledAt && hasDefect) {
      return { ok: false, stale: false, text: "已合拢，但仍登记有缺陷，缺陷未处理前不具备交付资格" };
    }
    if (work.assemblyHistory.length) {
      const last = work.assemblyHistory[work.assemblyHistory.length - 1];
      return {
        ok: false, stale: true,
        text: `原合拢（${last.assembledAt}）已作废：${last.reason}；需各部件重新完成后再次合拢`
      };
    }
    if (work.parts.length && work.parts.every(p => p.stage === "完成")) {
      return { ok: false, stale: false, text: "各部件均已完成，待合拢后才可交付" };
    }
    return { ok: false, stale: false, text: "部件未全部完成，暂不具备交付资格" };
  }

  /* 合拢后哪些修改要让旧合拢作废、资格按新值重算 */
  function changeInvalidatesAssembly(work, field, oldVal, newVal, part) {
    if (!work || !work.assembledAt) return null;
    if (oldVal === newVal) return null;
    if (field === "size") return `尺寸变更：${part ? "「" + part.name + "」" : ""}${oldVal || "未填"} → ${newVal || "未填"}，原合拢作废`;
    if (field === "base") return `胎体材质变更：${oldVal} → ${newVal}，原合拢作废`;
    if (field === "stage") return `步骤变更：${part ? "「" + part.name + "」" : ""}${oldVal} → ${newVal}，原合拢作废`;
    if (field === "rack") return null; // 仅换架位，不影响尺寸/胎体/步骤
    if (field === "dryStart" || field === "dryEnd") return null;
    return null;
  }

  /* 整件卡点汇总（页面展示「每块卡点」用；"工序未完成"由 assemblyCheck 统一标注，避免重复） */
  function workBlockers(work, conflicts) {
    const list = [];
    work.parts.forEach(p => {
      partBlockers(work, p, conflicts).forEach(r => list.push({ part: p, text: r }));
    });
    if (!work.parts.length) list.push({ part: null, text: "未登记部件" });
    const elig = deliveryEligibility(work);
    if (!elig.ok) list.push({ part: null, text: elig.text });
    return list;
  }

  function earliestDry(work) {
    const ds = work.parts.map(p => p.dryStart).filter(Boolean).sort();
    return ds[0] || "9999-12-31";
  }

  function filtered(works, opts) {
    return works
      .filter(w => !opts.status || workStatus(w) === opts.status)
      .filter(w => !opts.theme || w.theme.includes(opts.theme.trim()))
      .sort((a, b) => {
        const key = opts.sort === "dry" ? earliestDry(a) : (a.delivery || "");
        const other = opts.sort === "dry" ? earliestDry(b) : (b.delivery || "");
        return key.localeCompare(other);
      });
  }

  window.Rules = {
    STAGES, WORK_STATUSES,
    occupancy, rackConflicts, partBlockers, partReady,
    assemblyCheck, canAssemble, workStatus, deliveryEligibility,
    changeInvalidatesAssembly, workBlockers, filtered
  };
})();
