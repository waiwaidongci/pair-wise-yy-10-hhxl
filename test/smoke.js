/* Node 冒烟测试：node test/smoke.js。给 data/rules 提供最小浏览器桩。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const mem = {};
const sandbox = {
  console,
  localStorage: {
    getItem: k => (k in mem ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); }
  },
  crypto: { randomUUID: () => "id-" + Math.random().toString(36).slice(2, 10) },
  Date,
  window: {}
};
sandbox.window = sandbox;
vm.createContext(sandbox);
["../js/data.js", "../js/rules.js"].forEach(f =>
  vm.runInContext(fs.readFileSync(path.join(__dirname, f), "utf8"), sandbox, { filename: f })
);
const { Store, Rules } = sandbox.window;

let pass = 0, fail = 0;
function assert(cond, msg) {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
}

Store.load();
console.log("种子数据：" + Store.works.length + " 件作品");

/* 场景1：架位同时段冲突必须指出谁占着 */
const conflicts = Rules.rackConflicts(Store.works);
const w1 = Store.works[0]; // 海水江崖：正板 A-2 今天~+2，侧板 B-1 今天~+1，纹样条 B-1 -1~今天
const zhengban = w1.parts.find(p => p.name === "正板");
const ceban = w1.parts.find(p => p.name === "侧板");
const tiaorow = w1.parts.find(p => p.name === "纹样条");
assert(conflicts[`${w1.id}:${ceban.id}`] && conflicts[`${w1.id}:${ceban.id}`][0].includes("纹样条"),
  "侧板 B-1 冲突时说明被同件纹样条占着");
assert(conflicts[`${w1.id}:${tiaorow.id}`] && conflicts[`${w1.id}:${tiaorow.id}`][0].includes("侧板"),
  "纹样条 B-1 反向也能看到占用方侧板");
assert(!conflicts[`${w1.id}:${zhengban.id}`], "正板 A-2 无冲突");

/* 场景2：单块完成不等于整件可合拢；必须每块完成且无卡点 */
const check = Rules.assemblyCheck(Store.works)(w1);
assert(!check.ok, "海水江崖尚有部件在阴干，不能合拢");
const check0 = Rules.assemblyCheck(Store.works)(Store.works[0]);
assert(check0.blockers.some(b => b.part && b.part.name === "正板"), "卡点定位到具体块（正板）");

/* 场景3：折枝梅三块都完成，可以合拢/已合拢 */
const w2 = Store.works.find(w => w.theme === "折枝梅");
const c2 = Rules.assemblyCheck(Store.works)(w2);
/* 折枝梅侧板有缺陷 → 合拢前必须先处理缺陷 */
assert(!c2.ok && c2.blockers.some(b => b.reasons.join().includes("翘线")), "有缺陷的部件即使完成也卡合拢");
Store.recordDefect(w2.id, w2.parts.find(p => p.name === "侧板").id, "翘线已补线修复");
w2.parts.find(p => p.name === "侧板").defect = ""; /* 模拟缺陷已消除（登记清除） */
assert(Rules.assemblyCheck(Store.works)(w2).ok, "缺陷清除后三块完成可合拢");

/* 场景4：合拢后改尺寸，旧合拢作废、留档、资格按新值重算 */
assert(w2.assembledAt && Rules.deliveryEligibility(w2).ok, "折枝梅当前具备交付资格");
Store.updatePart(w2.id, w2.parts[0].id, { size: "直径28cm" });
const elig = Rules.deliveryEligibility(w2);
assert(!elig.ok && elig.stale && elig.text.includes("尺寸变更"), "改尺寸后原合拢与交付资格作废重算");
assert(w2.assemblyHistory.length >= 2, "旧合拢记录留档（种子已有1条 + 本次1条）");
const archived = w2.assemblyHistory[w2.assemblyHistory.length - 1];
assert(archived.reason.includes("直径26cm") && archived.snapshot.length === 3, "留档含旧值和当时各部件快照");

/* 场景5：合拢后把某块步骤回退，旧合拢按步骤变更作废 */
const w5 = Store.addWork({
  base: "木胎盒", theme: "回退工序测试件", line: "粗线", delivery: "2026-12-01",
  parts: [
    { name: "正板", size: "12×12cm", rack: "Y-1" },
    { name: "侧板", size: "12×6cm", rack: "Y-2" }
  ]
});
w5.parts.forEach(p => Store.setPartStage(w5.id, p.id, "完成"));
Store.assemble(w5.id);
Store.setPartStage(w5.id, w5.parts[0].id, "阴干");
assert(Rules.deliveryEligibility(w5).text.includes("步骤变更"), "合拢后回退工序，旧合拢按步骤变更作废");
assert(Rules.workStatus(w5) === "阴干", "作品状态随最慢部件回退到阴干");

/* 场景6：仅换架位不作废合拢；部件未齐不能合拢 */
const w3 = Store.works.find(w => w.theme === "云雷纹");
const w6 = Store.addWork({
  base: "脱胎盒", theme: "临时测试件", line: "细线", delivery: "2026-12-01",
  parts: [
    { name: "正板", size: "10×10cm", rack: "Z-1" },
    { name: "侧板", size: "10×5cm", rack: "Z-2" },
    { name: "纹样条", size: "9×2cm", rack: "Z-3" }
  ]
});
w6.parts.forEach(p => Store.setPartStage(w6.id, p.id, "完成"));
assert(Store.assemble(w6.id) && Rules.deliveryEligibility(w6).ok, "三块全部完成后合拢，获得交付资格");
assert(Rules.changeInvalidatesAssembly(w6, "rack", "A-1", "A-9", w6.parts[0]) === null,
  "合拢后仅换架位，不影响合拢资格");
assert(Rules.changeInvalidatesAssembly(w6, "size", "旧", "新", w6.parts[0]) !== null,
  "合拢后改尺寸则需作废重算");
assert(Rules.changeInvalidatesAssembly(w6, "base", "脱胎盒", "木胎盒") !== null,
  "合拢后改胎体则需作废重算");
Store.updateWork(w6.id, { base: "木胎盒" });
assert(!Rules.deliveryEligibility(w6).ok && Rules.deliveryEligibility(w6).text.includes("胎体材质"),
  "胎体实际改入后交付资格立即作废重算");
assert(!Rules.canAssemble(w3, Store.works), "云雷纹部件未齐，不能合拢");

/* 场景7：筛选仍可用 */
assert(Rules.filtered(Store.works, { status: "阴干", theme: "", sort: "delivery" })
  .every(w => Rules.workStatus(w) === "阴干"), "状态筛选保留");
assert(Rules.filtered(Store.works, { status: "", theme: "梅", sort: "delivery" })
  .every(w => w.theme.includes("梅")), "主题筛选保留");

/* 场景8：新登记部件三件套（正板/侧板/纹样条），字段齐全 */
const nw = Store.addWork({
  base: "脱胎盒", theme: "测试缠枝", line: "细线", delivery: "2026-12-01",
  parts: [
    { name: "正板", size: "10×10cm", rack: "Z-1" },
    { name: "侧板", size: "10×5cm", rack: "Z-2" },
    { name: "纹样条", size: "9×2cm", rack: "Z-3" }
  ]
});
assert(nw.parts.length === 3 && nw.parts.every(p => p.name && p.size && p.rack && p.stage === "贴线"),
  "新作品三块登记齐全，初始工序为贴线");
assert(!Rules.canAssemble(nw, Store.works), "新作品贴线阶段不能合拢");

console.log(`\n${pass} 通过，${fail} 失败`);
process.exit(fail ? 1 : 0);
