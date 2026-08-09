/*
  ファイル名: stage.js
  依存関係: なし（Rocket/EngineDBへの参照はしない。stageオブジェクトを
            受け取る側(rocket.js の EngineDB.codesForStage, physics.js の
            風レンジ判定, result.js の clearGoal.evaluate)がstage.jsの
            データ構造を参照する一方向の依存）
  ------------------------------------------------------------------
  0.2 状態契約の STAGES : stage.js が export する6ステージの配列
  ------------------------------------------------------------------
  resultStats契約（result.jsがclearGoal.evaluate()へ渡すオブジェクトの形）:
    {
      altitude       : number  // 最高到達高度[m]
      airtime        : number  // 滞空時間[s]（離陸〜着地）
      landingDistance: number  // 発射地点からの着地水平距離[m]（定点着地判定用）
    }
*/

class Stage {
  constructor({
    id, name, difficulty, description,
    budget, minDiameterMM, allowedEngineClasses,
    windSpeedRange, gravityMultiplier = 1,
    customUnlocked = false, tutorial = false,
    clearGoal = null,
    altitudeThresholds = [], altitudeBands = [], landingZoneRadius = null
  }) {
    this.id = id;
    this.name = name;
    this.difficulty = difficulty; // 'beginner'|'intermediate'|'advanced'|'custom'
    this.description = description;
    this.budget = budget;                         // Infinity = 予算無制限
    this.minDiameterMM = minDiameterMM;
    this.allowedEngineClasses = allowedEngineClasses; // 配列 または 'ALL'
    this.windSpeedRange = windSpeedRange;          // [min,max] または null(=自由設定)
    this.gravityMultiplier = gravityMultiplier;
    this.customUnlocked = customUnlocked;          // 自由形フィン・トランジション解放
    this.tutorial = tutorial;                      // 各工程前にチュートリアルダイアログを出すか
    this.clearGoal = clearGoal;                    // {label, evaluate(resultStats)} または null(フリー)

    // 打ち上げ画面の目標ガイド表示用（clearGoal.evaluateはロジックのみで
    // 構造化されたしきい値を持たないため、描画用に別途保持する）
    this.altitudeThresholds = altitudeThresholds;  // 「高度◯m以上」を示す黄色いガイド線（単一値の配列）
    this.altitudeBands = altitudeBands;            // [[min,max], ...] 高度レンジ狙いのステージ用
    this.landingZoneRadius = landingZoneRadius;    // 定点着地の許容半径[m]（nullなら非表示）

    // ステージ6のような「風速自由設定」ステージ向けの可変レンジ
    // （launch-prep画面のカスタムUIから上書きされる想定。未設定時のフォールバック値）
    this.customWindSpeedRange = windSpeedRange ? null : [0, 4];
  }

  get isWindless() { return this.windSpeedRange && this.windSpeedRange[0] === 0 && this.windSpeedRange[1] === 0; }
  get isFreeWind() { return this.windSpeedRange === null; }

  get windLabel() {
    if (this.isFreeWind) return "自由設定";
    if (this.isWindless) return "無風";
    return `${this.windSpeedRange[0]}〜${this.windSpeedRange[1]} m/s`;
  }
  get budgetLabel() { return this.budget === Infinity ? "無制限" : `¥${this.budget.toLocaleString()}`; }
  get gravityLabel() { return `${this.gravityMultiplier}G`; }
  get engineLabel() {
    if (this.allowedEngineClasses === "ALL") return "A〜H（全種）";
    const arr = this.allowedEngineClasses;
    return arr.length <= 1 ? arr[0] : `${arr[0]}〜${arr[arr.length - 1]}`;
  }
  get clearGoalLabel() { return this.clearGoal ? this.clearGoal.label : "フリー（クリア目標なし）"; }

  isOverBudget(rocket) {
    if (this.budget === Infinity) return false;
    return rocket.totalPrice > this.budget;
  }

  /** 専門パラメータ(CNα等)を隠して画面を単純化すべきステージか */
  get simplifiedUI() { return this.difficulty === "beginner"; }
}

/* ============================================================
   6ステージ定義
============================================================ */
const STAGES = [

  // ---- Stage 1: チュートリアル / 初心者 ----
  new Stage({
    id: "stage1",
    name: "STAGE 1 - はじめての打ち上げ",
    difficulty: "beginner",
    description: "無風の中、基本パーツだけでロケットを作って飛ばしてみよう。",
    budget: 3000,
    minDiameterMM: 18,
    allowedEngineClasses: ["A", "B", "C"],
    windSpeedRange: [0, 0],
    gravityMultiplier: 1,
    customUnlocked: false,
    tutorial: true,
    clearGoal: {
      label: "高度50m以上 かつ 滞空時間10s以上",
      evaluate: (stats) => stats.altitude >= 50 && stats.airtime >= 10
    },
    altitudeThresholds: [50]
  }),

  // ---- Stage 2: チュートリアル / 初心者 ----
  new Stage({
    id: "stage2",
    name: "STAGE 2 - 風にも負けず",
    difficulty: "beginner",
    description: "弱い風が吹く中、もう少し高く長く飛ばすことに挑戦しよう。",
    budget: 4000,
    minDiameterMM: 18,
    allowedEngineClasses: ["A", "B", "C"],
    windSpeedRange: [0, 4],
    gravityMultiplier: 1,
    customUnlocked: false,
    tutorial: true,
    clearGoal: {
      label: "高度150m以上 かつ 滞空時間30s以上",
      evaluate: (stats) => stats.altitude >= 150 && stats.airtime >= 30
    },
    altitudeThresholds: [150]
  }),

  // ---- Stage 3: 中級者 / 全国大会風 ----
  new Stage({
    id: "stage3",
    name: "STAGE 3 - 全国大会チャレンジ",
    difficulty: "intermediate",
    description: "限られた予算とエンジンで、高度・滞空・着地精度のいずれかを狙う競技志向ステージ。",
    budget: 2000,
    minDiameterMM: 24,
    allowedEngineClasses: ["1/2A"],
    windSpeedRange: [2, 4],
    gravityMultiplier: 1,
    customUnlocked: true, // 自由形フィン・トランジションを解放
    tutorial: false,
    clearGoal: {
      label: "（高度100m以上）または（滞空時間60s以上）または（定点着地10m以内）のいずれか",
      evaluate: (stats) => stats.altitude >= 100 || stats.airtime >= 60 || stats.landingDistance <= 10
    },
    altitudeThresholds: [100],
    landingZoneRadius: 10
  }),

  // ---- Stage 4: 中級者 / 甲子園風 ----
  new Stage({
    id: "stage4",
    name: "STAGE 4 - グラウンド甲子園",
    difficulty: "intermediate",
    description: "太い機体・大型エンジンで、狙った高度と滞空時間のレンジにぴったり収める精密ステージ。",
    budget: 8000,
    minDiameterMM: 65,
    allowedEngineClasses: ["D", "E", "F"],
    windSpeedRange: [3, 4],
    gravityMultiplier: 1,
    customUnlocked: true,
    tutorial: false,
    clearGoal: {
      label: "（高度200〜220m かつ 滞空30〜35s）または（高度230〜250m かつ 滞空32〜38s）",
      evaluate: (stats) => {
        const pattern1 = stats.altitude >= 200 && stats.altitude <= 220 && stats.airtime >= 30 && stats.airtime <= 35;
        const pattern2 = stats.altitude >= 230 && stats.altitude <= 250 && stats.airtime >= 32 && stats.airtime <= 38;
        return pattern1 || pattern2;
      }
    },
    altitudeBands: [[200, 220], [230, 250]]
  }),

  // ---- Stage 5: 上級者 / エキスパートテクニカル ----
  new Stage({
    id: "stage5",
    name: "STAGE 5 - エキスパートテクニカル",
    difficulty: "advanced",
    description: "小型エンジン・強風という悪条件下で、高度・滞空・着地精度のすべてを同時に満たす総合力が試される上級ステージ。",
    budget: 3000,
    minDiameterMM: 18,
    allowedEngineClasses: ["A", "B", "C"],
    windSpeedRange: [2, 6],
    gravityMultiplier: 1,
    customUnlocked: true,
    tutorial: false,
    clearGoal: {
      label: "高度100m以上 かつ 滞空時間20s以上 かつ 定点着地15m以内（すべて同時達成）",
      evaluate: (stats) => stats.altitude >= 100 && stats.airtime >= 20 && stats.landingDistance <= 15
    },
    altitudeThresholds: [100],
    landingZoneRadius: 15
  }),

  // ---- Stage 6: フリー / カスタム・練習用 ----
  new Stage({
    id: "stage6",
    name: "STAGE 6 - フリープレイ",
    difficulty: "custom",
    description: "予算・部品・風速すべて自由。じっくり試作したいときの練習モード。",
    budget: Infinity,
    minDiameterMM: 18,
    allowedEngineClasses: "ALL",
    windSpeedRange: null, // 自由設定（launch-prep画面でユーザーが調整。既定[0,4]）
    gravityMultiplier: 1,
    customUnlocked: true,
    tutorial: false,
    clearGoal: null // フリープレイのためクリア判定なし
  })
];
