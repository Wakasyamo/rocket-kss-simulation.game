/*
  ファイル名: rocket.js
  依存関係: なし（Physics.estimateApogee等は呼び出し側(script.js/ui.js)から
            渡されるstage引数を通じて間接的に利用される想定。本ファイル
            自体はPhysicsクラスに依存しない）
  ------------------------------------------------------------------
  0.2 状態契約で定義された RocketPart / RocketInstance の形に対応する:
    RocketPart     = { type:'nose|body|transition|fin|engine', x_ref,
                        length, diameter, mass, color?, pattern?, finParams? }
    RocketInstance = { parts:[RocketPart], cg, cp, totalMass, diameter_mm }
  ※ parachute/weightは形状を持たない付加質量のため`parts`配列には含めず、
    Rocket直下の専用プロパティとして扱う（cg/totalMass/価格の計算には
    もちろん算入する）。engineも同様に専用プロパティ(rocket.engine)を
    正とし、`parts`配列には3D表示・CSV出力等の汎用用途向けに
    軽量なRocketPart形のスナップショットとして併載する。
*/

/* ============================================================
   素材データベース
============================================================ */
const MaterialDB = {
  materials: {
    "3Dプリンター":   { weight: 8,  strength: 10, price: 10, parts: ["nose", "fin"] },
    "バルサ材":       { weight: 7,  strength: 6,  price: 12, parts: ["nose", "body", "fin", "transition"] },
    "ベニヤ板":       { weight: 12, strength: 13, price: 15, parts: ["nose", "body", "fin", "transition"] },
    "紙":             { weight: 10, strength: 6,  price: 5,  parts: ["body", "transition"] },
    "厚紙":           { weight: 15, strength: 9,  price: 6,  parts: ["body", "transition"] },
    "発泡スチロール": { weight: 4,  strength: 5,  price: 10, parts: ["nose"] },
    "GFRP":           { weight: 5,  strength: 9,  price: 10, parts: ["nose", "body", "fin", "transition"] },
    "CFRP":           { weight: 5,  strength: 11, price: 15, parts: ["nose", "body", "fin", "transition"] }
  },
  getForPart(partType) {
    return Object.entries(this.materials)
      .filter(([, data]) => data.parts.includes(partType))
      .map(([name, data]) => ({ name, ...data }));
  },
  get(name) { return this.materials[name]; },
  strengthStars(strength, max = 13) {
    return Math.max(1, Math.min(5, Math.round((strength / max) * 5)));
  }
};

const NOSE_SHAPES = {
  "円錐":     { cpFactor: 0.67, cd0: 0.50 },
  "オジーブ": { cpFactor: 0.47, cd0: 0.38 },
  "楕円":     { cpFactor: 0.50, cd0: 0.42 }
};

const FIN_SHAPES = {
  "小型":     { a: 0.05, b: 0.02,  s: 0.03, m: 0.02 },
  "標準":     { a: 0.08, b: 0.04,  s: 0.05, m: 0.03 },
  "大型":     { a: 0.12, b: 0.06,  s: 0.08, m: 0.05 },
  "楕円":     { a: 0.08, b: 0.08,  s: 0.05, m: 0.02, elliptical: true },
  "後退翼":   { a: 0.09, b: 0.03,  s: 0.06, m: 0.07 },
  "デルタ":   { a: 0.11, b: 0.005, s: 0.07, m: 0.10 }
};
const FIN_CUSTOM_LABEL = "カスタム"; // ステージのcustomUnlockedがtrueの時のみ選択可能

const FIN_SECTIONS = {
  "矩形": { massMul: 1.00, strengthMul: 1.00 },
  "丸み": { massMul: 0.90, strengthMul: 0.85 },
  "翼型": { massMul: 0.80, strengthMul: 0.70 }
};

/* デカールパターン（設計画面のデザインカスタマイズ機能） */
const DECAL_PATTERNS = {
  none:      { label: "なし",       icon: "—" },
  fire:      { label: "ファイヤー", icon: "🔥" },
  lightning: { label: "稲妻",       icon: "⚡" },
  heart:     { label: "ハート",     icon: "❤️" }
};

const MASS_COEF = {
  nose: 0.016,  // g = Lcm × Dcm² × weight × nose
  body: 0.020,  // g = Lcm × Dcm  × weight × body（薄肉円筒なので直径の1乗）
  fin: 0.007,   // g(1枚) = 面積cm² × weight × fin
  parachutePerCm: 0.15
};
const PRICE_COEF = {
  noseBody: 0.15,
  fin: 0.08,
  parachutePerCm: 6,
  weightPerGram: 4
};

/* ============================================================
   既定カラー（パーツ別カラーリング機能のデフォルト値）
============================================================ */
const DEFAULT_COLORS = {
  nose: "#e8f4f8",
  body: "#cfe8ee",
  transition: "#cfe8ee",
  fin: "#3fb8d6"
};

/* ============================================================
   NoseCone
============================================================ */
class NoseCone {
  constructor({ length = 0.12, diameter = 0.024, material = "バルサ材", shape = "オジーブ", color = DEFAULT_COLORS.nose, massOverride = null } = {}) {
    this.length = length;
    this.diameter = diameter;
    this.material = material;
    this.shape = shape;
    this.color = color;
    this.massOverride = massOverride; // ステージ6限定: 手動指定の重量[g]（nullなら計算値を使用）
  }
  get materialData() { return MaterialDB.get(this.material); }
  get cnAlpha() { return 2; }
  get cpFromTip() { return NOSE_SHAPES[this.shape].cpFactor * this.length; }
  get cd0() { return NOSE_SHAPES[this.shape].cd0; }

  massForMaterial(materialName) {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    const w = MaterialDB.get(materialName).weight;
    return Lcm * Dcm * Dcm * w * MASS_COEF.nose;
  }
  priceForMaterial(materialName) {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    const p = MaterialDB.get(materialName).price;
    return Math.round(p * Lcm * Dcm * PRICE_COEF.noseBody);
  }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : this.massForMaterial(this.material) / 1000; }
  get strength() { return this.materialData.strength; }
  get price() { return this.priceForMaterial(this.material); }
}

/* ============================================================
   BodyTube
============================================================ */
class BodyTube {
  constructor({ length = 0.30, diameter = 0.024, material = "紙", color = DEFAULT_COLORS.body, massOverride = null } = {}) {
    this.length = length;
    this.diameter = diameter;
    this.material = material;
    this.color = color;
    this.massOverride = massOverride;
  }
  get materialData() { return MaterialDB.get(this.material); }
  get cnAlpha() { return 0; }

  massForMaterial(materialName) {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    const w = MaterialDB.get(materialName).weight;
    return Lcm * Dcm * w * MASS_COEF.body;
  }
  priceForMaterial(materialName) {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    const p = MaterialDB.get(materialName).price;
    return Math.round(p * Lcm * Dcm * PRICE_COEF.noseBody);
  }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : this.massForMaterial(this.material) / 1000; }
  get strength() { return this.materialData.strength; }
  get price() { return this.priceForMaterial(this.material); }
}

/* ============================================================
   Transition（トランジション/テーパー形状パーツ）
   ------------------------------------------------------------
   ステージ3〜6（customUnlocked）でのみ有効化できるパーツ。
   構造は ノーズ→ボディ→トランジション→ボディ(下段)→フィン という並び。
   Barrowman法の遷移部公式（前面直径 d_bf、後面直径 d_br、長さL、
   基準直径d）を実装する:
     (CNα)_cb = 2[(d_br/d)^2 - (d_bf/d)^2]
     X̄(前縁からの距離) = (L/3)[1 + (1-d_bf/d_br)/(1-(d_bf/d_br)^2)]
============================================================ */
class Transition {
  constructor({ length = 0.05, diameterFront = 0.024, diameterBack = 0.018, material = "バルサ材", color = DEFAULT_COLORS.transition, massOverride = null } = {}) {
    this.length = length;
    this.diameterFront = diameterFront; // 上段ボディ側（前）
    this.diameterBack = diameterBack;   // 下段ボディ側（後）
    this.material = material;
    this.color = color;
    this.massOverride = massOverride;
  }
  get materialData() { return MaterialDB.get(this.material); }

  /** @param referenceDiameter 機体の基準直径（通常はノーズ/上段ボディの直径） */
  cnAlphaGiven(referenceDiameter) {
    const d = referenceDiameter;
    return 2 * (Math.pow(this.diameterBack / d, 2) - Math.pow(this.diameterFront / d, 2));
  }

  /** トランジション前縁からのCP距離 [m] */
  get cpFromFront() {
    const ratio = this.diameterFront / this.diameterBack;
    if (Math.abs(1 - ratio) < 1e-6) return this.length / 2; // テーパーなし(円柱)の場合は中央とみなす
    const term = (1 - ratio) / (1 - ratio * ratio);
    return (this.length / 3) * (1 + term);
  }

  massForMaterial(materialName) {
    const avgDcm = ((this.diameterFront + this.diameterBack) / 2) * 100;
    const Lcm = this.length * 100;
    const w = MaterialDB.get(materialName).weight;
    return Lcm * avgDcm * w * MASS_COEF.body; // 薄肉テーパー管として body と同係数を流用
  }
  priceForMaterial(materialName) {
    const avgDcm = ((this.diameterFront + this.diameterBack) / 2) * 100;
    const Lcm = this.length * 100;
    const p = MaterialDB.get(materialName).price;
    return Math.round(p * Lcm * avgDcm * PRICE_COEF.noseBody);
  }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : this.massForMaterial(this.material) / 1000; }
  get strength() { return this.materialData.strength; }
  get price() { return this.priceForMaterial(this.material); }
}

/* ============================================================
   Fin
   ------------------------------------------------------------
   customUnlockedステージでは shape="カスタム" とし、
   setCustomGeometry() で根本幅/端部幅/後退角/高さを直接指定できる。
============================================================ */
class Fin {
  constructor({ count = 3, shape = "標準", section = "矩形", material = "バルサ材", color = DEFAULT_COLORS.fin, massOverride = null } = {}) {
    this.count = count;
    this.shape = shape;
    this.section = section;
    this.material = material;
    this.color = color;
    this.customGeometry = null; // {a,b,s,m} 「カスタム」選択時のみ使用
    this.massOverride = massOverride; // ステージ6限定: n枚合計の手動重量[g]
  }

  get materialData() { return MaterialDB.get(this.material); }

  /** @returns {a,b,s,m} 根本長・端部長・高さ・後退長 [m] */
  get geometry() {
    if (this.shape === FIN_CUSTOM_LABEL && this.customGeometry) return this.customGeometry;
    return FIN_SHAPES[this.shape] || FIN_SHAPES["標準"];
  }

  /**
   * 自由形フィンのパラメータを設定する。
   * @param rootWidth 根本幅[m] @param tipWidth 端部幅[m]
   * @param sweepAngleDeg 後退角[度] @param height 高さ[m]
   */
  setCustomGeometry({ rootWidth, tipWidth, sweepAngleDeg, height }) {
    const m = height * Math.tan((sweepAngleDeg * Math.PI) / 180);
    this.customGeometry = { a: rootWidth, b: tipWidth, s: height, m: Math.max(0, m) };
    this.shape = FIN_CUSTOM_LABEL;
  }

  get sectionData() { return FIN_SECTIONS[this.section]; }
  get areaSingle() { const { a, b, s } = this.geometry; return ((a + b) / 2) * s; }
  get midChordLength() { const { s, m } = this.geometry; return Math.sqrt(s * s + m * m); }

  cnAlphaFinsOnly(bodyDiameter) {
    const { a, b, s } = this.geometry;
    const l = this.midChordLength;
    const n = this.count;
    const d = bodyDiameter;
    const term = 2 * l / (a + b);
    return (4 * n * Math.pow(s / d, 2)) / (1 + Math.sqrt(1 + term * term));
  }
  kfb(bodyDiameter) {
    const R = bodyDiameter / 2;
    const S = this.geometry.s;
    return 1 + R / (S + R);
  }
  cnAlphaWithInterference(bodyDiameter) {
    return this.kfb(bodyDiameter) * this.cnAlphaFinsOnly(bodyDiameter);
  }
  cpFromRootLeadingEdge() {
    const { a, b, m } = this.geometry;
    const term1 = (m * (a + 2 * b)) / (3 * (a + b));
    const term2 = (1 / 6) * (a + b - (a * b) / (a + b));
    return term1 + term2;
  }

  massForMaterial(materialName) {
    const areaCm2 = this.areaSingle * 10000;
    const w = MaterialDB.get(materialName).weight;
    const perFin = areaCm2 * w * MASS_COEF.fin * this.sectionData.massMul;
    return perFin * this.count;
  }
  priceForMaterial(materialName) {
    const areaCm2 = this.areaSingle * 10000;
    const p = MaterialDB.get(materialName).price;
    return Math.round(p * areaCm2 * this.count * PRICE_COEF.fin);
  }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : this.massForMaterial(this.material) / 1000; }
  get strength() { return this.materialData.strength * this.sectionData.strengthMul; }
  get price() { return this.priceForMaterial(this.material); }
}

/* ============================================================
   Parachute / Weight
============================================================ */
class Parachute {
  constructor({ diameter = 0.30, massOverride = null } = {}) { this.diameter = diameter; this.massOverride = massOverride; }
  get area() { const r = this.diameter / 2; return Math.PI * r * r; }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : (this.diameter * 100 * MASS_COEF.parachutePerCm) / 1000; }
  get price() { return Math.round(this.diameter * 100 * PRICE_COEF.parachutePerCm); }
}

class Weight {
  constructor({ mass = 0.01, position = 0.2 } = {}) { this.mass = mass; this.position = position; }
  get price() { return Math.round(this.mass * 1000 * PRICE_COEF.weightPerGram); }
}

/* ============================================================
   エンジン
============================================================ */
const IMPULSE_CLASS_MAP = {
  "1/2A": 0.625, "A": 1.25, "B": 2.5, "C": 5,
  "D": 10, "E": 20, "F": 40, "G": 80, "H": 160
};
const ENGINE_MASS_MAP = {
  "1/2A": 13.8, "A": 16, "B": 20, "C": 30,
  "D": 40, "E": 60, "F": 80, "G": 120, "H": 180
};
function enginePriceForClass(classKey) {
  if (["1/2A", "A", "B", "C"].includes(classKey)) return 1000;
  if (["D", "E"].includes(classKey)) return 2000;
  if (classKey === "F") return 4000;
  if (classKey === "G") return 5000;
  if (classKey === "H") return 6000;
  return 1000;
}

const EngineDB = {
  // A〜H全クラスを最低1本ずつカバー（ステージ4:D〜F, ステージ6:A〜H等に対応）
  codes: [
    "1/2A6-2", "A8-3", "B4-2", "B4-4", "C6-3", "C11-7",
    "D12-3", "D9-7", "E9-6", "E12-4",
    "F67-4", "F42-4", "F40-4",
    "G80-4", "G40-7", "H128-6", "H180-4"
  ],
  parse(code) {
    const match = code.match(/^(1\/2)?([A-Z])(\d+)-(\d+)$/);
    if (!match) throw new Error(`不正なエンジンコード: ${code}`);
    const [, half, letter, thrustStr, delayStr] = match;
    const classKey = half ? `1/2${letter}` : letter;
    const totalImpulse = IMPULSE_CLASS_MAP[classKey];
    if (totalImpulse === undefined) throw new Error(`未対応のクラス: ${classKey}`);
    return { code, classKey, totalImpulse, avgThrust: parseFloat(thrustStr), delay: parseFloat(delayStr) };
  },
  /** ステージのallowedEngineClasses('ALL'または配列)に応じて選択可能なコードを絞り込む */
  codesForStage(stage) {
    if (!stage || stage.allowedEngineClasses === "ALL") return this.codes;
    const allowed = stage.allowedEngineClasses || [];
    return this.codes.filter(code => allowed.includes(this.parse(code).classKey));
  }
};

class Engine {
  constructor(code = "C6-3") {
    const data = EngineDB.parse(code);
    this.code = data.code;
    this.classKey = data.classKey;
    this.totalImpulse = data.totalImpulse;
    this.avgThrust = data.avgThrust;
    this.delay = data.delay;
    this.price = enginePriceForClass(data.classKey);
    this.length = 0.07; // 7cm固定（指定仕様）
    this.massOverride = null; // ステージ6限定: 手動指定の重量[g]
  }
  get mass() { return this.massOverride != null ? this.massOverride / 1000 : (ENGINE_MASS_MAP[this.classKey] || 30) / 1000; }
  /** エンジン自身の重心位置（エンジン前端からの距離）[m]。7cmの中央=3.5cm固定 */
  get centerOffset() { return this.length / 2; }
}

/* ============================================================
   Rocket
============================================================ */
class Rocket {
  constructor() {
    this.nose = new NoseCone();
    this.body = new BodyTube();
    this.fins = new Fin();
    this.parachute = new Parachute();
    this.weight = new Weight();
    this.engine = new Engine("C6-3");

    // トランジション（デフォルトは無効。customUnlockedステージでのみON可）
    this.transitionEnabled = false;
    this.transition = new Transition();
    this.bodyLower = new BodyTube({ length: 0.15, diameter: 0.018 });

    // デザインカスタマイズ: デカール（全体 or ボディに適用）
    this.decal = { pattern: "none", scope: "body" };
  }

  setTransitionEnabled(enabled) { this.transitionEnabled = !!enabled; }

  /* ---------- 幾何 ---------- */
  get totalLength() {
    let len = this.nose.length + this.body.length;
    if (this.transitionEnabled) len += this.transition.length + this.bodyLower.length;
    return len;
  }
  /** 基準直径（ノーズ/上段ボディ側）[m] */
  get diameter() { return this.nose.diameter; }
  /** 契約フィールド: 基準直径[mm] */
  get diameter_mm() { return this.diameter * 1000; }

  get referenceArea() { const r = this.diameter / 2; return Math.PI * r * r; }

  /** フィン取付部の直径（トランジション有効時は下段ボディ、無効時は上段ボディ） */
  get finMountDiameter() {
    return this.transitionEnabled ? this.bodyLower.diameter : this.body.diameter;
  }

  /** フィン根本前縁の位置（先端から）[m]。常に最後尾に配置 */
  get finRootLeadingEdgeX() {
    return this.totalLength - this.fins.geometry.a;
  }

  /* ---------- 質量・重心(cg) ---------- */
  get totalMass() {
    let m = this.nose.mass + this.body.mass + this.fins.mass +
      this.parachute.mass + this.weight.mass + this.engine.mass;
    if (this.transitionEnabled) m += this.transition.mass + this.bodyLower.mass;
    return m;
  }

  /** 契約フィールド: 重心位置（先端からの距離）[m]（モーメント法） */
  get cg() {
    const parts = [
      { m: this.nose.mass, x: this.nose.length * 0.45 },
      { m: this.body.mass, x: this.nose.length + this.body.length / 2 },
      { m: this.fins.mass, x: this.finRootLeadingEdgeX + this.fins.geometry.a * 0.5 },
      { m: this.parachute.mass, x: this.nose.length + this.body.length * 0.25 },
      { m: this.weight.mass, x: this.weight.position },
      // エンジンは全長7cmで機体最後尾に位置し、自身の中央(3.5cm)に重心があるとみなす
      { m: this.engine.mass, x: this.totalLength - this.engine.centerOffset }
    ];
    if (this.transitionEnabled) {
      const transX = this.nose.length + this.body.length;
      parts.push({ m: this.transition.mass, x: transX + this.transition.length / 2 });
      parts.push({ m: this.bodyLower.mass, x: transX + this.transition.length + this.bodyLower.length / 2 });
    }
    const totalM = parts.reduce((s, p) => s + p.m, 0);
    if (totalM <= 0) return 0;
    return parts.reduce((s, p) => s + p.m * p.x, 0) / totalM;
  }

  /* ---------- 空力・圧力中心(cp) ---------- */
  get cnAlpha() {
    const finCn = this.fins.cnAlphaWithInterference(this.finMountDiameter);
    let total = this.nose.cnAlpha + this.body.cnAlpha + finCn;
    if (this.transitionEnabled) total += this.transition.cnAlphaGiven(this.diameter);
    return total;
  }

  /** 契約フィールド: 圧力中心位置（先端からの距離）[m]（各部品Cnαの加重平均） */
  get cp() {
    const finCn = this.fins.cnAlphaWithInterference(this.finMountDiameter);
    const finCp = this.finRootLeadingEdgeX + this.fins.cpFromRootLeadingEdge();
    const items = [
      { cn: this.nose.cnAlpha, x: this.nose.cpFromTip },
      { cn: this.body.cnAlpha, x: this.nose.length + this.body.length / 2 },
      { cn: finCn, x: finCp }
    ];
    if (this.transitionEnabled) {
      const transX = this.nose.length + this.body.length;
      items.push({
        cn: this.transition.cnAlphaGiven(this.diameter),
        x: transX + this.transition.cpFromFront
      });
    }
    const totalCn = items.reduce((s, i) => s + i.cn, 0);
    if (totalCn <= 0) return this.totalLength * 0.5;
    return items.reduce((s, i) => s + i.cn * i.x, 0) / totalCn;
  }

  get staticMargin() { return (this.cp - this.cg) / this.diameter; }
  get staticMarginMeters() { return this.cp - this.cg; }
  get cd0() { return this.nose.cd0; }

  /* ---------- 強度・価格 ---------- */
  get totalStrength() {
    let s = this.nose.strength + this.body.strength + this.fins.strength;
    if (this.transitionEnabled) s += this.transition.strength;
    return s;
  }
  get strengthStars() {
    const MIN = 8, MAX = 42;
    const t = (this.totalStrength - MIN) / (MAX - MIN);
    return Math.max(1, Math.min(5, Math.round(t * 5)));
  }
  get totalPrice() {
    let p = this.nose.price + this.body.price + this.fins.price +
      this.parachute.price + this.weight.price + this.engine.price;
    if (this.transitionEnabled) p += this.transition.price + this.bodyLower.price;
    return p;
  }
  /**
   * 「軽さ」の評価をエンジンの全力積(Total Impulse)に対する相対値に変更。
   * ------------------------------------------------------------
   * 従来は質量の絶対値(0.05〜0.40kg)だけで8段階評価していたが、
   * これだとエンジンの出力とのバランスが分からなかった。
   * 「全力積[Ns] ÷ 総質量[kg]」＝ 単位質量あたりに得られる力積（推力重量比に近い指標）
   * が大きいほど「エンジンの力に対して機体が軽い＝よく飛ぶ」とみなし、
   * これを8段階のバー表示に変換する。
   */
  get lightnessLevel() {
    const impulseToMassRatio = this.engine.totalImpulse / Math.max(0.001, this.totalMass); // [Ns/kg]
    const MIN = 15, MAX = 250; // 経験的に決めたゲームバランス用レンジ
    const t = (impulseToMassRatio - MIN) / (MAX - MIN);
    return Math.max(1, Math.min(8, Math.round(t * 8)));
  }

  /** ステージの最小直径制限を満たしているか */
  meetsMinDiameter(stage) {
    if (!stage || !stage.minDiameterMM) return true;
    return this.diameter_mm >= stage.minDiameterMM;
  }

  /* ---------- 0.2契約: RocketPart配列（3D表示/CSV等の汎用スナップショット用） ---------- */
  get parts() {
    const list = [];
    let cursor = 0;
    list.push({ type: "nose", x_ref: cursor, length: this.nose.length, diameter: this.nose.diameter, mass: this.nose.mass, color: this.nose.color });
    cursor += this.nose.length;
    list.push({ type: "body", x_ref: cursor, length: this.body.length, diameter: this.body.diameter, mass: this.body.mass, color: this.body.color, pattern: this.decal.scope === "body" ? this.decal.pattern : "none" });
    cursor += this.body.length;
    if (this.transitionEnabled) {
      list.push({ type: "transition", x_ref: cursor, length: this.transition.length, diameter: this.transition.diameterFront, mass: this.transition.mass, color: this.transition.color });
      cursor += this.transition.length;
      list.push({ type: "body", x_ref: cursor, length: this.bodyLower.length, diameter: this.bodyLower.diameter, mass: this.bodyLower.mass, color: this.bodyLower.color, pattern: this.decal.scope === "body" ? this.decal.pattern : "none" });
      cursor += this.bodyLower.length;
    }
    list.push({
      type: "fin", x_ref: this.finRootLeadingEdgeX, length: this.fins.geometry.a, diameter: this.finMountDiameter,
      mass: this.fins.mass, color: this.fins.color,
      finParams: { count: this.fins.count, ...this.fins.geometry }
    });
    list.push({ type: "engine", x_ref: this.totalLength - this.engine.length, length: this.engine.length, diameter: this.diameter * 0.7, mass: this.engine.mass });
    return list;
  }

  /* ---------- 保存/読込用シリアライズ ---------- */
  toJSON() {
    return {
      nose: { length: this.nose.length, diameter: this.nose.diameter, material: this.nose.material, shape: this.nose.shape, color: this.nose.color, massOverride: this.nose.massOverride },
      body: { length: this.body.length, diameter: this.body.diameter, material: this.body.material, color: this.body.color, massOverride: this.body.massOverride },
      fins: {
        count: this.fins.count, shape: this.fins.shape, section: this.fins.section, material: this.fins.material,
        color: this.fins.color, customGeometry: this.fins.customGeometry, massOverride: this.fins.massOverride
      },
      parachute: { diameter: this.parachute.diameter, massOverride: this.parachute.massOverride },
      weight: { mass: this.weight.mass, position: this.weight.position },
      engineCode: this.engine.code,
      engineMassOverride: this.engine.massOverride,
      transitionEnabled: this.transitionEnabled,
      transition: { length: this.transition.length, diameterFront: this.transition.diameterFront, diameterBack: this.transition.diameterBack, material: this.transition.material, color: this.transition.color, massOverride: this.transition.massOverride },
      bodyLower: { length: this.bodyLower.length, diameter: this.bodyLower.diameter, material: this.bodyLower.material, color: this.bodyLower.color },
      decal: { ...this.decal }
    };
  }

  static fromJSON(data) {
    const r = new Rocket();
    Object.assign(r.nose, data.nose);
    Object.assign(r.body, data.body);
    Object.assign(r.fins, data.fins);
    Object.assign(r.parachute, data.parachute);
    Object.assign(r.weight, data.weight);
    r.engine = new Engine(data.engineCode);
    if (data.engineMassOverride != null) r.engine.massOverride = data.engineMassOverride;
    if (data.transition) Object.assign(r.transition, data.transition);
    if (data.bodyLower) Object.assign(r.bodyLower, data.bodyLower);
    r.transitionEnabled = !!data.transitionEnabled;
    if (data.decal) r.decal = { ...data.decal };
    return r;
  }
}
