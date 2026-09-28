/* 数据层：作品 / 部件的存储、迁移与增删改。不含任何判定与界面逻辑。 */
(function () {
  "use strict";

  const STORAGE_KEY = "zfl42Works";
  const TODAY = new Date().toISOString().slice(0, 10);
  const datePlus = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
  const now = () => new Date().toLocaleString();

  // 部件工序（贴线 → 阴干 → 上金粉 → 完成）；整件看板状态在判定层派生
  const STAGES = ["贴线", "阴干", "上金粉", "完成"];
  const KANBAN = ["部件制作中", "待合拢", "已合拢", "合拢已失效", "已交付"];
  const GOLD_BY_STAGE = { "贴线": "未处理", "阴干": "未处理", "上金粉": "试扫粉", "完成": "已上金粉" };

  let seq = 0;
  function uid(prefix) {
    seq += 1;
    if (window.crypto && crypto.randomUUID) return `${prefix}-${crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${seq}`;
  }

  function makeComponent(data, stage) {
    const st = stage || data.stage || "贴线";
    return {
      id: uid("c"),
      name: data.name || "未命名部件",
      kind: data.kind || "",
      size: data.size || "",
      stage: st,
      rack: data.rack || "",
      rackStart: data.rackStart || "",
      rackEnd: data.rackEnd || "",
      gold: data.gold || GOLD_BY_STAGE[st],
      defect: data.defect || "",
      logs: Array.isArray(data.logs) ? data.logs : [`${now()} 登记部件：${data.name || "未命名部件"}`]
    };
  }

  function seedWorks() {
    return [
      {
        id: uid("w"),
        base: "木胎香盒",
        theme: "海水江崖",
        line: "细线",
        delivery: datePlus(8),
        defect: "",
        note: "边线需保持低浮雕感",
        createdAt: now(),
        assembly: null,
        assemblyHistory: [],
        logs: [`${now()} 创建作品`],
        components: [
          makeComponent({ name: "正板", kind: "正板", size: "20×15cm", rack: "A架-2", rackStart: TODAY, rackEnd: datePlus(2), defect: "" }, "阴干"),
          makeComponent({ name: "侧板", kind: "侧板", size: "20×4cm×2" }, "贴线"),
          makeComponent({ name: "江崖纹样条", kind: "纹样条", size: "18×2cm" }, "贴线")
        ]
      },
      {
        id: uid("w"),
        base: "脱胎盘",
        theme: "折枝梅",
        line: "混合线",
        delivery: datePlus(5),
        defect: "",
        note: "客户要求金粉偏暗",
        createdAt: now(),
        assembly: null,
        assemblyHistory: [],
        logs: [`${now()} 创建作品`],
        components: [
          makeComponent({ name: "正板", kind: "正板", size: "30cm", rack: "B架-1", rackStart: TODAY, rackEnd: datePlus(1) }, "阴干"),
          makeComponent({ name: "梅花纹样条", kind: "纹样条", size: "26×3cm", rack: "A架-2", rackStart: TODAY, rackEnd: datePlus(2), defect: "左侧枝干翘线" }, "阴干"),
          makeComponent({ name: "侧板", kind: "侧板", size: "30×5cm×2" }, "贴线")
        ]
      },
      {
        id: uid("w"),
        base: "竹胎笔筒",
        theme: "云雷纹",
        line: "中线",
        delivery: datePlus(12),
        defect: "",
        note: "",
        createdAt: now(),
        assembly: null,
        assemblyHistory: [],
        logs: [`${now()} 创建作品`],
        components: [
          makeComponent({ name: "正板", kind: "正板", size: "12×10cm" }, "贴线"),
          makeComponent({ name: "雷纹纹样条", kind: "纹样条", size: "30×1.5cm" }, "贴线")
        ]
      },
      {
        id: uid("w"),
        base: "脱胎漆屏",
        theme: "缠枝莲",
        line: "粗线",
        delivery: datePlus(3),
        defect: "",
        note: "合拢后客户要求加宽侧板",
        createdAt: now(),
        assembly: null,
        assemblyHistory: [
          {
            at: now(),
            valid: false,
            reason: "合拢后部件尺寸变更（侧板 25×6cm → 28×6cm），按新值重算，交付资格重新判定",
            snapshot: { base: "脱胎漆屏", componentCount: 3, summary: "正板 / 侧板 / 缠枝莲纹样条，均已完成上金粉" }
          }
        ],
        logs: [`${now()} 创建作品`, `${now()} 部件合拢`, `${now()} 合拢失效：部件尺寸变更，旧记录留档`],
        components: [
          makeComponent({ name: "正板", kind: "正板", size: "40×25cm" }, "完成"),
          makeComponent({ name: "侧板", kind: "侧板", size: "28×6cm" }, "完成"),
          makeComponent({ name: "缠枝莲纹样条", kind: "纹样条", size: "38×4cm" }, "完成")
        ]
      }
    ];
  }

  // 旧版整件数据迁移：把整件视为一块"整件（历史）"部件
  function migrateWork(w) {
    const comp = makeComponent({
      name: "整件（历史）",
      kind: "",
      size: "",
      defect: w.defect || "",
      gold: w.gold || "未处理",
      logs: Array.isArray(w.logs) ? w.logs.slice() : ["旧版整件记录迁移"]
    });
    const oldToStage = { "贴线中": "贴线", "待阴干": "阴干", "上金粉": "上金粉", "待交付": "完成" };
    comp.stage = oldToStage[w.status] || "贴线";
    if (comp.stage === "阴干") {
      comp.rackStart = w.dryDate || "";
      comp.rackEnd = w.dryDate || "";
    }
    comp.gold = w.gold || GOLD_BY_STAGE[comp.stage];
    return {
      id: w.id || uid("w"),
      base: w.base || "",
      theme: w.theme || "",
      line: w.line || "",
      delivery: w.delivery || "",
      defect: w.defect || "",
      note: w.note || "",
      createdAt: now(),
      assembly: null,
      assemblyHistory: [],
      logs: Array.isArray(w.logs) ? w.logs.slice() : ["迁移旧版整件"],
      components: [comp]
    };
  }

  function isNewShape(w) {
    return w && Array.isArray(w.components);
  }

  const Store = {
    STORAGE_KEY,
    TODAY,
    STAGES,
    KANBAN,
    GOLD_BY_STAGE,
    works: [],

    load() {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(raw) && raw.length) {
        this.works = raw.map(w => (isNewShape(w) ? w : migrateWork(w)));
        this.save();
      } else {
        this.works = seedWorks();
        this.save();
      }
      return this.works;
    },

    save() {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.works));
    },

    findWork(id) {
      return this.works.find(w => w.id === id) || null;
    },

    findComponent(workId, compId) {
      const w = this.findWork(workId);
      return w ? w.components.find(c => c.id === compId) || null : null;
    },

    addWork(data) {
      const work = {
        id: uid("w"),
        base: data.base,
        theme: data.theme,
        line: data.line,
        delivery: data.delivery,
        defect: "",
        note: data.note || "",
        createdAt: now(),
        assembly: null,
        assemblyHistory: [],
        logs: [`${now()} 创建作品`],
        components: []
      };
      this.works.unshift(work);
      this.save();
      return work;
    },

    updateWork(id, patch) {
      const w = this.findWork(id);
      if (!w) return null;
      Object.assign(w, patch);
      w.logs.push(`${now()} 更新整件信息：${Object.keys(patch).join("、")}`);
      this.save();
      return w;
    },

    addComponent(workId, data) {
      const w = this.findWork(workId);
      if (!w) return null;
      const comp = makeComponent(data, "贴线");
      w.components.push(comp);
      w.logs.push(`${now()} 登记部件：${comp.name}（${comp.size || "尺寸未填"}）`);
      if (w.assembly && w.assembly.valid) {
        this.voidAssembly(w.id, `合拢后新增部件「${comp.name}」，按新值重算`, false);
      }
      this.save();
      return comp;
    },

    // 更新部件；invalidateFields（尺寸/胎体/工序相关）在合拢后变更会触发合拢失效
    updateComponent(workId, compId, patch) {
      const w = this.findWork(workId);
      const comp = w && w.components.find(c => c.id === compId);
      if (!comp) return null;
      const before = { stage: comp.stage, size: comp.size };
      Object.assign(comp, patch);
      comp.logs.push(`${now()} 部件信息更新：${Object.keys(patch).join("、")}`);
      if (w.assembly && w.assembly.valid) {
        if (patch.size && patch.size !== before.size) {
          this.voidAssembly(w.id, `合拢后部件「${comp.name}」尺寸变更（${before.size || "未填"} → ${patch.size}），按新值重算`, true);
        } else if (patch.stage && patch.stage !== before.stage && before.stage === "完成") {
          this.voidAssembly(w.id, `合拢后部件「${comp.name}」工序回退（完成 → ${patch.stage}），按新值重算`, true);
        }
      }
      this.save();
      return comp;
    },

    // 仅记录部件流转日志（工序推进 / 回退）
    logStage(workId, compId, from, to, extra) {
      const comp = this.findComponent(workId, compId);
      if (!comp) return;
      comp.logs.push(`${now()} 工序：${from} → ${to}${extra ? "（" + extra + "）" : ""}`);
      this.save();
    },

    recordDefect(workId, compId, text) {
      const w = this.findWork(workId);
      const comp = w && w.components.find(c => c.id === compId);
      if (!comp || !text) return;
      comp.defect = comp.defect ? `${comp.defect}; ${text}` : text;
      comp.logs.push(`${now()} 缺陷：${text}`);
      // 整件级缺陷摘要同步（供旧的缺陷总览/导出字段使用）
      w.defect = w.components.filter(c => c.defect).map(c => `${c.name}：${c.defect}`).join("；");
      w.logs.push(`${now()} 记录缺陷：${comp.name} - ${text}`);
      this.save();
    },

    markDelivered(workId) {
      const w = this.findWork(workId);
      if (!w) return;
      w.assembly.deliveredAt = now();
      w.logs.push(`${now()} 交付完成`);
      this.save();
    },

    // 合拢
    saveAssembly(workId) {
      const w = this.findWork(workId);
      if (!w) return null;
      const record = {
        at: now(),
        valid: true,
        deliveredAt: "",
        reason: "",
        snapshot: {
          base: w.base,
          componentCount: w.components.length,
          summary: w.components.map(c => `${c.name}（${c.size || "尺寸未填"}，${c.stage}）`).join(" / ")
        }
      };
      w.assembly = record;
      w.logs.push(`${now()} 部件合拢，共 ${w.components.length} 块`);
      this.save();
      return record;
    },

    // 合拢失效：旧记录留档（assemblyHistory），整件回到待合拢，交付资格重算
    voidAssembly(workId, reason, archive) {
      const w = this.findWork(workId);
      if (!w || !w.assembly) return;
      const old = w.assembly;
      if (archive !== false) {
        w.assemblyHistory.push({
          at: old.at,
          valid: false,
          voidedAt: now(),
          deliveredAt: old.deliveredAt || "",
          reason: reason,
          snapshot: old.snapshot
        });
      } else {
        w.assemblyHistory.push({ at: old.at, valid: false, reason: reason, snapshot: old.snapshot });
      }
      w.assembly = null;
      w.logs.push(`${now()} 合拢失效：${reason}，旧合拢记录留档`);
      this.save();
    }
  };

  window.Store = Store;
})();
