/* ============================================================
   ROCKET FORGE - rocket.js
   ------------------------------------------------------------
   ロケットを構成する各パーツのクラス、素材/エンジンのデータベース、
   そしてそれらを束ねて質量・重心(CG)・圧力中心(CP)・静的安定性を
   計算する Rocket クラスを定義する。

   長さ・直径はすべて [m]、質量は [kg] で統一する。
   （UI表示のときだけ cm / g に変換する）
============================================================ */

/* ============================================================
   素材データベース
   重さ/強度/価格は 1〜15 程度の「ゲームバランス用の指数」であり、
   実際の物理単位ではない（相対比較用のスコア）。
============================================================ */
const MaterialDB = {
  materials: {
    "3Dプリンター":   { weight: 8,  strength: 10, price: 10, parts: ["nose", "fin"] },
    "バルサ材":       { weight: 7,  strength: 6,  price: 12, parts: ["nose", "body", "fin"] },
    "ベニヤ板":       { weight: 12, strength: 13, price: 15, parts: ["nose", "body", "fin"] },
    "紙":             { weight: 10, strength: 6,  price: 5,  parts: ["body"] },
    "厚紙":           { weight: 15, strength: 9,  price: 6,  parts: ["body"] },
    "発泡スチロール": { weight: 4,  strength: 5,  price: 10, parts: ["nose"] },
    "GFRP":           { weight: 5,  strength: 9,  price: 10, parts: ["nose", "body", "fin"] },
    "CFRP":           { weight: 5,  strength: 11, price: 15, parts: ["nose", "body", "fin"] }
  },
  /** 指定パーツ種別に使える素材一覧を返す */
  getForPart(partType) {
    return Object.entries(this.materials)
      .filter(([, data]) => data.parts.includes(partType))
      .map(([name, data]) => ({ name, ...data }));
  },
  get(name) { return this.materials[name]; }
};

/* ============================================================
   ノーズ形状データ（Barrowman法のCP係数 & 空力抗力の基本係数）
============================================================ */
const NOSE_SHAPES = {
  "円錐":     { cpFactor: 0.67, cd0: 0.50 },
  "オジーブ": { cpFactor: 0.47, cd0: 0.38 },
  "楕円":     { cpFactor: 0.50, cd0: 0.42 }
};

/* ============================================================
   フィン形状プリセット（根本長a・端部長b・高さs・後退長m）[m]
   デルタ翼などはbをほぼ0にして三角形に近似している。
============================================================ */
const FIN_SHAPES = {
  "小型":     { a: 0.05, b: 0.02,  s: 0.03, m: 0.02 },
  "標準":     { a: 0.08, b: 0.04,  s: 0.05, m: 0.03 },
  "大型":     { a: 0.12, b: 0.06,  s: 0.08, m: 0.05 },
  "楕円":     { a: 0.08, b: 0.08,  s: 0.05, m: 0.02, elliptical: true },
  "後退翼":   { a: 0.09, b: 0.03,  s: 0.06, m: 0.07 },
  "デルタ":   { a: 0.11, b: 0.005, s: 0.07, m: 0.10 }
};

/* 断面形状（質量・強度への倍率補正） */
const FIN_SECTIONS = {
  "矩形": { massMul: 1.00, strengthMul: 1.00 },
  "丸み": { massMul: 0.90, strengthMul: 0.85 },
  "翼型": { massMul: 0.80, strengthMul: 0.70 }
};

/* 価格計算用の係数（ゲームバランス調整用に1箇所へ集約） */
const PRICE_COEF = {
  noseBody: 0.15,   // 価格 = 素材価格 × 長さ[cm] × 直径[cm] × この係数
  fin: 0.08,        // 価格 = 素材価格 × 全フィン面積[cm^2] × この係数
  parachutePerCm: 6,  // パラシュートは布地扱い: 価格 = 直径[cm] × この係数
  weightPerGram: 4    // おもりは金属扱い: 価格 = 質量[g] × この係数
};

/* ============================================================
   NoseCone（ノーズコーン）
============================================================ */
class NoseCone {
  constructor({ length = 0.12, diameter = 0.024, material = "バルサ材", shape = "オジーブ" } = {}) {
    this.length = length;
    this.diameter = diameter;
    this.material = material;
    this.shape = shape;
  }

  get materialData() { return MaterialDB.get(this.material); }
  get cnAlpha() { return 2; } // Barrowman法: ノーズは常にCnα=2（形状によらない）

  /** 先端から見たCP位置 [m] = 形状係数 × 長さ */
  get cpFromTip() {
    return NOSE_SHAPES[this.shape].cpFactor * this.length;
  }

  get cd0() { return NOSE_SHAPES[this.shape].cd0; }

  /** 質量 [kg] = 長さ×直径²÷500×素材重量  （指定式。単位はcmに変換して計算） */
  get mass() {
    const Lcm = this.length * 100;
    const Dcm = this.diameter * 100;
    const raw = (Lcm * Dcm * Dcm) / 500 * this.materialData.weight;
    return raw / 1000; // g -> kg
  }

  get strength() { return this.materialData.strength; }

  get price() {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    return Math.round(this.materialData.price * Lcm * Dcm * PRICE_COEF.noseBody);
  }
}

/* ============================================================
   BodyTube（ボディチューブ）
============================================================ */
class BodyTube {
  constructor({ length = 0.30, diameter = 0.024, material = "紙" } = {}) {
    this.length = length;
    this.diameter = diameter;
    this.material = material;
  }

  get materialData() { return MaterialDB.get(this.material); }
  get cnAlpha() { return 0; } // Barrowman法: 円筒部はCnα=0（本体は揚力を生まない）

  get mass() {
    const Lcm = this.length * 100;
    const Dcm = this.diameter * 100;
    const raw = (Lcm * Dcm * Dcm) / 500 * this.materialData.weight;
    return raw / 1000;
  }

  get strength() { return this.materialData.strength; }

  get price() {
    const Lcm = this.length * 100, Dcm = this.diameter * 100;
    return Math.round(this.materialData.price * Lcm * Dcm * PRICE_COEF.noseBody);
  }
}

/* ============================================================
   Fin（フィン） - Barrowman法による法線力係数(CnΑ)とCP位置を計算
============================================================ */
class Fin {
  constructor({ count = 3, shape = "標準", section = "矩形", material = "バルサ材" } = {}) {
    this.count = count;         // 3〜6枚
    this.shape = shape;
    this.section = section;
    this.material = material;
  }

  get materialData() { return MaterialDB.get(this.material); }
  get geometry() { return FIN_SHAPES[this.shape]; }
  get sectionData() { return FIN_SECTIONS[this.section]; }

  /** 単枚あたりの面積 [m^2]（台形近似） */
  get areaSingle() {
    const { a, b, s } = this.geometry;
    return ((a + b) / 2) * s;
  }

  /** 中翼線長 l（Barrowman式の干渉係数計算に使う、後退線の斜辺長で近似） */
  get midChordLength() {
    const { s, m } = this.geometry;
    return Math.sqrt(s * s + m * m);
  }

  /**
   * Barrowman法によるフィン単体のCnα（機体全体に対する寄与, n枚分）
   * @param bodyDiameter 取り付け部の胴体直径 [m]
   */
  cnAlphaFinsOnly(bodyDiameter) {
    const { a, b, s } = this.geometry;
    const l = this.midChordLength;
    const n = this.count;
    const d = bodyDiameter;
    const term = 2 * l / (a + b);
    return (4 * n * Math.pow(s / d, 2)) / (1 + Math.sqrt(1 + term * term));
  }

  /** 胴体干渉係数 Kfb = 1 + R/(S+R) */
  kfb(bodyDiameter) {
    const R = bodyDiameter / 2;
    const S = this.geometry.s;
    return 1 + R / (S + R);
  }

  /** 胴体干渉を含めたフィンのCnα（(CNα)_fb = Kfb × (CNα)_f） */
  cnAlphaWithInterference(bodyDiameter) {
    return this.kfb(bodyDiameter) * this.cnAlphaFinsOnly(bodyDiameter);
  }

  /**
   * フィンのCP位置（フィン根本前縁 xf からの相対距離）[m]
   *   X̄f = xf + m(a+2b)/3(a+b) + 1/6・(a+b - ab/(a+b))
   */
  cpFromRootLeadingEdge() {
    const { a, b, m } = this.geometry;
    const term1 = (m * (a + 2 * b)) / (3 * (a + b));
    const term2 = (1 / 6) * (a + b - (a * b) / (a + b));
    return term1 + term2;
  }

  /** 全フィン合計質量 [kg] = 面積÷500×素材重量 （n枚分, 断面形状による補正込み） */
  get mass() {
    const areaCm2 = this.areaSingle * 10000; // m^2 -> cm^2
    const raw = (areaCm2 / 500) * this.materialData.weight * this.sectionData.massMul;
    return (raw * this.count) / 1000; // g -> kg
  }

  get strength() {
    return this.materialData.strength * this.sectionData.strengthMul;
  }

  get price() {
    const areaCm2 = this.areaSingle * 10000;
    return Math.round(this.materialData.price * areaCm2 * this.count * PRICE_COEF.fin);
  }
}

/* ============================================================
   Parachute（パラシュート）
============================================================ */
class Parachute {
  constructor({ diameter = 0.30 } = {}) {
    this.diameter = diameter; // [m]
  }

  /** 展開時の投影面積 [m^2] */
  get area() {
    const r = this.diameter / 2;
    return Math.PI * r * r;
  }

  /** 質量はナイロン布地を想定した簡易近似（直径に比例） */
  get mass() {
    return this.diameter * 0.08; // [kg]
  }

  get price() {
    return Math.round(this.diameter * 100 * PRICE_COEF.parachutePerCm);
  }
}

/* ============================================================
   Weight（おもり）
============================================================ */
class Weight {
  constructor({ mass = 0.01, position = 0.2 } = {}) {
    this.mass = mass;         // [kg]
    this.position = position; // 先端からの距離 [m]（スライダーで指定）
  }

  get price() {
    return Math.round(this.mass * 1000 * PRICE_COEF.weightPerGram);
  }
}

/* ============================================================
   エンジンデータベース & Engine クラス
   ------------------------------------------------------------
   コード表記例: "C6-3" → 1文字目C=全備力積クラス, 6=平均推力[N], 3=遅延[秒]
   1文字目のクラスは "倍々" で全力積 [Ns] が決まる。
============================================================ */
const IMPULSE_CLASS_MAP = {
  "1/2A": 0.625,
  "A": 1.25,
  "B": 2.5,
  "C": 5,
  "D": 10,
  "E": 20,
  "F": 40,
  "G": 80
};

const EngineDB = {
  codes: ["1/2A6-2", "A8-3", "B4-2", "B4-4", "C6-3", "C11-7", "F67-4", "F42-4", "F40-4"],
  price: 1000, // 全エンジン共通価格

  /** エンジンコードを解析し {impulseClass, avgThrust, delay, totalImpulse} を返す */
  parse(code) {
    // 例: "1/2A6-2" / "C6-3" / "F67-4" にマッチする正規表現
    const match = code.match(/^(1\/2)?([A-Z])(\d+)-(\d+)$/);
    if (!match) throw new Error(`不正なエンジンコード: ${code}`);
    const [, half, letter, thrustStr, delayStr] = match;
    const classKey = half ? `1/2${letter}` : letter;
    const totalImpulse = IMPULSE_CLASS_MAP[classKey];
    if (totalImpulse === undefined) throw new Error(`未対応のクラス: ${classKey}`);
    return {
      code,
      classKey,
      totalImpulse,                 // [Ns]
      avgThrust: parseFloat(thrustStr), // [N]
      delay: parseFloat(delayStr)       // [s]
    };
  }
};

class Engine {
  constructor(code = "C6-3") {
    const data = EngineDB.parse(code);
    this.code = data.code;
    this.totalImpulse = data.totalImpulse;
    this.avgThrust = data.avgThrust;
    this.delay = data.delay;
    this.price = EngineDB.price;
  }

  /**
   * エンジン質量の近似 [kg]。
   * 実物のモデルロケットエンジンは全力積にほぼ比例して重くなる傾向があるため、
   * 「全力積 × 係数 + ケース基本質量」という単純な線形モデルで近似する。
   */
  get mass() {
    return this.totalImpulse * 0.014 + 0.02;
  }
}

/* ============================================================
   Rocket クラス
   ------------------------------------------------------------
   全パーツを束ね、質量・CG・CP・安定性・空力係数・価格・強度など
   ロケット全体の物理量を計算する「集約ルート」。
   design画面/物理演算(physics.js)の両方から参照される。
============================================================ */
class Rocket {
  constructor() {
    this.nose = new NoseCone();
    this.body = new BodyTube();
    this.fins = new Fin();
    this.parachute = new Parachute();
    this.weight = new Weight();
    this.engine = new Engine("C6-3");
  }

  /* ---------- 幾何 ---------- */

  get totalLength() {
    return this.nose.length + this.body.length;
  }

  /** 基準直径（ノーズ＝ボディ直径として統一）[m] */
  get diameter() {
    return this.nose.diameter;
  }

  /** 空力計算の基準断面積 [m^2] */
  get referenceArea() {
    const r = this.diameter / 2;
    return Math.PI * r * r;
  }

  /** フィン根本前縁の位置（先端から）[m]。ボディ後端にフィン後端が一致するよう配置 */
  get finRootLeadingEdgeX() {
    return this.nose.length + this.body.length - this.fins.geometry.a;
  }

  /* ---------- 質量・重心(CG) ---------- */

  get totalMass() {
    return this.nose.mass + this.body.mass + this.fins.mass +
      this.parachute.mass + this.weight.mass + this.engine.mass;
  }

  /**
   * モーメント法による重心位置 Xcg = Σ(m_i * x_i) / Σm_i
   * 各部品の質量中心位置(x_i)は先端からの距離 [m] で近似する。
   */
  get centerOfGravity() {
    const parts = [
      { m: this.nose.mass, x: this.nose.length * 0.45 }, // 先細形状のため幾何中心よりやや前寄り
      { m: this.body.mass, x: this.nose.length + this.body.length / 2 },
      { m: this.fins.mass, x: this.finRootLeadingEdgeX + this.fins.geometry.a * 0.5 },
      { m: this.parachute.mass, x: this.nose.length + this.body.length * 0.25 },
      { m: this.weight.mass, x: this.weight.position },
      { m: this.engine.mass, x: this.totalLength - 0.02 }
    ];
    const totalM = parts.reduce((s, p) => s + p.m, 0);
    if (totalM <= 0) return 0;
    const moment = parts.reduce((s, p) => s + p.m * p.x, 0);
    return moment / totalM;
  }

  /* ---------- 空力・圧力中心(CP) ---------- */

  /** 機体全体のCnα（Barrowman法: 各部品のCnαの合計） */
  get cnAlpha() {
    const finCn = this.fins.cnAlphaWithInterference(this.diameter);
    return this.nose.cnAlpha + this.body.cnAlpha + finCn;
  }

  /**
   * 機体全体のCP位置 Xcp = Σ(Cnα_i × X_i) / Σ Cnα_i
   * （各部品のCnαを重みとした位置の加重平均 = Barrowman法の標準的な合成方法）
   */
  get centerOfPressure() {
    const finCn = this.fins.cnAlphaWithInterference(this.diameter);
    const finCp = this.finRootLeadingEdgeX + this.fins.cpFromRootLeadingEdge();

    const items = [
      { cn: this.nose.cnAlpha, x: this.nose.cpFromTip },
      { cn: this.body.cnAlpha, x: this.nose.length + this.body.length / 2 }, // Cnα=0なので寄与なし
      { cn: finCn, x: finCp }
    ];
    const totalCn = items.reduce((s, i) => s + i.cn, 0);
    if (totalCn <= 0) return this.totalLength * 0.5;
    const moment = items.reduce((s, i) => s + i.cn * i.x, 0);
    return moment / totalCn;
  }

  /** Static Margin（口径単位）= (Xcp - Xcg) / 直径 */
  get staticMargin() {
    return (this.centerOfPressure - this.centerOfGravity) / this.diameter;
  }

  /** Static Margin をメートル単位で（physics.jsのトルク計算で使用） */
  get staticMarginMeters() {
    return this.centerOfPressure - this.centerOfGravity;
  }

  /* ---------- 空気抵抗基本係数 ---------- */
  get cd0() {
    return this.nose.cd0;
  }

  /* ---------- 強度・価格 ---------- */

  /** 全部品の強度を合計 */
  get totalStrength() {
    return this.nose.strength + this.body.strength + this.fins.strength;
  }

  get totalPrice() {
    return this.nose.price + this.body.price + this.fins.price +
      this.parachute.price + this.weight.price + this.engine.price;
  }

  /* ---------- 性能バー（8段階） ---------- */

  /** 軽さレベル 1〜8（軽いほど高評価。0.05kg〜0.5kgの範囲でスケーリング） */
  get lightnessLevel() {
    const MIN = 0.05, MAX = 0.5;
    const t = 1 - (this.totalMass - MIN) / (MAX - MIN);
    return Math.max(1, Math.min(8, Math.round(t * 8)));
  }

  /** 強度レベル 1〜8（総強度 5〜35 の範囲でスケーリング） */
  get strengthLevel() {
    const MIN = 5, MAX = 35;
    const t = (this.totalStrength - MIN) / (MAX - MIN);
    return Math.max(1, Math.min(8, Math.round(t * 8)));
  }
}
