/* 数据层：作品与部件的登记、持久化、变更留档。纯判定见 rules.js。 */
(function () {
  const STORAGE_KEY = "zfl42WorksV2";

  function uid() { return crypto.randomUUID(); }
  function now() { return new Date().toLocaleString(); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function plusDays(d) { return new Date(Date.now() + d * 86400000).toISOString().slice(0, 10); }

  function makePart(p = {}) {
    const name = p.name || "正板";
    return {
      id: uid(),
      name,
      size: p.size || "",          // 尺寸
      rack: p.rack || "",          // 阴干架位
      stage: p.stage || "贴线",    // 贴线 → 阴干 → 上金粉 → 完成
      dryStart: p.dryStart || today(),
      dryEnd: p.dryEnd || plusDays(2),
      defect: p.defect || "",
      logs: [`${now()} 登记部件「${name}」${p.size ? " · " + p.size : ""}${p.rack ? " · 架位 " + p.rack : ""}`]
    };
  }

  function makeWork(data = {}) {
    return {
      id: uid(),
      base: data.base || "",        // 胎体材质
      theme: data.theme || "",
      line: data.line || "中线",
      delivery: data.delivery || plusDays(5),
      note: data.note || "",
      defect: "",
      parts: (data.parts || []).map(makePart),
      assembledAt: null,            // 当前合拢时间；合拢后被作废则回到 null
      assemblyRevision: null,       // 合拢时的 revision 快照
      assemblyHistory: [],          // 旧合拢记录留档
      revision: 0,                  // 尺寸/胎体/步骤等关键值每改一次累加
      logs: [`${now()} 创建作品，登记部件 ${data.parts ? data.parts.length : 0} 块`]
    };
  }

  function seedWorks() {
    const t = today();
    const w1 = makeWork({
      base: "木胎香盒", theme: "海水江崖", line: "细线", delivery: plusDays(6),
      note: "边线需保持低浮雕感",
      parts: [
        { name: "正板", size: "30×20cm", rack: "A-2", stage: "阴干", dryStart: t, dryEnd: plusDays(2) },
        { name: "侧板", size: "20×8cm", rack: "B-1", stage: "阴干", dryStart: t, dryEnd: plusDays(1) },
        { name: "纹样条", size: "28×3cm", rack: "B-1", stage: "上金粉", dryStart: plusDays(-1), dryEnd: t }
      ]
    });
    const w2 = makeWork({
      base: "脱胎盘", theme: "折枝梅", line: "混合线", delivery: plusDays(3),
      note: "客户要求金粉偏暗",
      parts: [
        { name: "正板", size: "直径26cm", rack: "A-1", stage: "完成", dryStart: plusDays(-4), dryEnd: plusDays(-2) },
        { name: "侧板", size: "18×20cm", rack: "C-3", stage: "完成", dryStart: plusDays(-3), dryEnd: plusDays(-1), defect: "左侧枝干翘线" },
        { name: "纹样条", size: "24×4cm", rack: "C-3", stage: "完成", dryStart: plusDays(-3), dryEnd: plusDays(-1) }
      ]
    });
    w2.assembledAt = `${today()} 09:20:00`;
    w2.assemblyRevision = 0;
    w2.assemblyHistory.push({
      assembledAt: `${plusDays(-2)} 16:40:00`,
      assemblyRevision: 0,
      reason: "尺寸变更：侧板 18×18cm → 18×20cm，原合拢作废、交付资格按新值重算",
      at: `${today()} 08:55:00`,
      snapshot: [
        { name: "正板", size: "直径26cm", stage: "完成", rack: "A-1" },
        { name: "侧板", size: "18×18cm", stage: "完成", rack: "C-3" },
        { name: "纹样条", size: "24×4cm", stage: "完成", rack: "C-3" }
      ]
    });
    w2.logs.push(`${today()} 09:20:00 全部部件完成，重新合拢，交付资格恢复`);
    const w3 = makeWork({
      base: "竹胎笔筒", theme: "云雷纹", line: "中线", delivery: plusDays(9),
      parts: [
        { name: "正板", size: "22×16cm", rack: "B-2", stage: "贴线", dryStart: plusDays(3), dryEnd: plusDays(5) },
        { name: "侧板", size: "16×10cm", rack: "A-3", stage: "阴干", dryStart: plusDays(1), dryEnd: plusDays(3) }
      ]
    });
    return [w1, w2, w3];
  }

  const Store = {
    works: [],

    load() {
      let saved = null;
      try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch (_) { saved = null; }
      const list = saved && saved.version === 2 && Array.isArray(saved.works) ? saved.works : seedWorks();
      this.works = list;
      this.save();
      return this.works;
    },

    save() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, works: this.works }));
    },

    findWork(workId) {
      return this.works.find(w => w.id === workId);
    },

    findPart(workId, partId) {
      const work = this.findWork(workId);
      return work ? [work, work.parts.find(p => p.id === partId)] : [null, null];
    },

    addWork(data) {
      const work = makeWork(data);
      this.works.unshift(work);
      this.save();
      return work;
    },

    addPart(workId, data) {
      const work = this.findWork(workId);
      if (!work) return null;
      const part = makePart(data);
      // 合拢后新增部件 = 构成变化，原合拢作废
      this.invalidateAssembly(work, `新增部件「${part.name}」，部件构成变化`);
      work.parts.push(part);
      work.logs.push(`${now()} 登记部件「${part.name}」${part.size ? " · " + part.size : ""}`);
      work.revision += 1;
      this.save();
      return part;
    },

    /* 合拢后改尺寸等关键值：旧合拢作废留档，资格交给 rules 重算 */
    invalidateAssembly(work, reason) {
      if (!work || !work.assembledAt) return false;
      work.assemblyHistory.push({
        assembledAt: work.assembledAt,
        assemblyRevision: work.assemblyRevision,
        reason,
        at: now(),
        snapshot: work.parts.map(p => ({ name: p.name, size: p.size, stage: p.stage, rack: p.rack }))
      });
      work.assembledAt = null;
      work.assemblyRevision = null;
      work.logs.push(`${now()} ${reason}；旧合拢记录留档，交付资格按新值重算`);
      return true;
    },

    updatePart(workId, partId, patch) {
      const [work, part] = this.findPart(workId, partId);
      if (!part) return;
      const fields = ["name", "size", "rack", "dryStart", "dryEnd"];
      const changed = [];
      fields.forEach(f => {
        if (patch[f] !== undefined && patch[f] !== part[f]) {
          changed.push(`${f}:${part[f]}→${patch[f]}`);
          const reason = window.Rules.changeInvalidatesAssembly(work, f, part[f], patch[f], part);
          if (reason) this.invalidateAssembly(work, reason);
          part[f] = patch[f];
        }
      });
      if (changed.length) {
        part.logs.push(`${now()} 登记信息修改：${changed.join("，")}`);
        work.logs.push(`${now()} 部件「${part.name}」修改：${changed.join("，")}`);
        work.revision += 1;
        this.save();
      }
    },

    setPartStage(workId, partId, stage) {
      const [work, part] = this.findPart(workId, partId);
      if (!part || part.stage === stage) return;
      const from = part.stage;
      const reason = window.Rules.changeInvalidatesAssembly(work, "stage", from, stage, part);
      if (reason) this.invalidateAssembly(work, reason);
      part.stage = stage;
      part.logs.push(`${now()} 工序推进：${from} → ${stage}`);
      work.logs.push(`${now()} 「${part.name}」${from} → ${stage}`);
      work.revision += 1;
      this.save();
    },

    recordDefect(workId, partId, text) {
      const work = this.findWork(workId);
      if (!work || !text) return;
      if (partId) {
        const part = work.parts.find(p => p.id === partId);
        if (!part) return;
        part.defect = part.defect ? `${part.defect}; ${text}` : text;
        part.logs.push(`${now()} 记录缺陷：${text}`);
        work.logs.push(`${now()} 「${part.name}」缺陷：${text}`);
      } else {
        work.defect = work.defect ? `${work.defect}; ${text}` : text;
        work.logs.push(`${now()} 整件缺陷：${text}`);
      }
      this.save();
    },

    updateWork(workId, patch) {
      const work = this.findWork(workId);
      if (!work) return;
      ["theme", "line", "delivery", "note"].forEach(f => {
        if (patch[f] !== undefined && patch[f] !== work[f]) work[f] = patch[f];
      });
      if (patch.base !== undefined && patch.base !== work.base) {
        const reason = window.Rules.changeInvalidatesAssembly(work, "base", work.base, patch.base);
        if (reason) this.invalidateAssembly(work, reason);
        work.base = patch.base;
        work.revision += 1;
      }
      work.logs.push(`${now()} 作品信息修改`);
      this.save();
    },

    assemble(workId) {
      const work = this.findWork(workId);
      if (!work || !window.Rules.canAssemble(work)) return false;
      work.assembledAt = now();
      work.assemblyRevision = work.revision;
      work.logs.push(`${work.assembledAt} 全部 ${work.parts.length} 块部件完成并合拢，获得交付资格`);
      this.save();
      return true;
    }
  };

  window.Store = Store;
  window.PART_STAGES = ["贴线", "阴干", "上金粉", "完成"];
  window.todayStr = today;
})();
