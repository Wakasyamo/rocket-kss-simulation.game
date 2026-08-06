/* ============================================================
   ROCKET FORGE - stage.js
   ------------------------------------------------------------
   ステージ（Level1〜3）の設定を保持する Stage クラスと、
   全ステージを束ねる StageDB を定義する。
============================================================ */

class Stage {
  /**
   * @param id ステージ識別子
   * @param name 表示名
   * @param description 一言説明
   * @param windSpeedRange [min, max] 風速レンジ [m/s]（[0,0]なら無風）
   * @param budget 予算 [円]
   * @param gravityMultiplier 重力倍率（1 = 標準1G）
   */
  constructor({ id, name, description, windSpeedRange, budget, gravityMultiplier }) {
    this.id = id;
    this.name = name;
    this.description = description;
    this.windSpeedRange = windSpeedRange;
    this.budget = budget;
    this.gravityMultiplier = gravityMultiplier;
  }

  get isWindless() {
    return this.windSpeedRange[0] === 0 && this.windSpeedRange[1] === 0;
  }

  get windLabel() {
    return this.isWindless ? "無風" : `${this.windSpeedRange[0]}〜${this.windSpeedRange[1]} m/s`;
  }

  get budgetLabel() {
    return `¥${this.budget.toLocaleString()}`;
  }

  get gravityLabel() {
    return `${this.gravityMultiplier}G`;
  }

  /** ロケットの合計価格が予算を超えているか判定 */
  isOverBudget(rocket) {
    return rocket.totalPrice > this.budget;
  }
}

/* ============================================================
   ステージデータベース
   ------------------------------------------------------------
   予算額はゲームバランスとして以下の方針で設計:
   - Level1: 標準予算 … 基本構成一式に少し余裕がある額
   - Level2: 予算少   … 素材選択にシビアな取捨選択を迫られる額
   - Level3: 予算多   … 高級素材やフィン強化に予算を回せる額
     （3Gの重力に耐える剛性を持たせる必要があるため多めに設定）
============================================================ */
const StageDB = {
  stages: [
    new Stage({
      id: "level1",
      name: "LEVEL 1 - FIRST FLIGHT",
      description: "無風・標準予算。基礎を学ぶ入門ステージ。",
      windSpeedRange: [0, 0],
      budget: 6000,
      gravityMultiplier: 1
    }),
    new Stage({
      id: "level2",
      name: "LEVEL 2 - CROSSWIND",
      description: "弱い風が吹く中、限られた予算で機体を仕上げる。",
      windSpeedRange: [0, 4],
      budget: 4000,
      gravityMultiplier: 1
    }),
    new Stage({
      id: "level3",
      name: "LEVEL 3 - HEAVY WORLD",
      description: "強風と3Gの重力。潤沢な予算で頑丈な機体を作れ。",
      windSpeedRange: [2, 6],
      budget: 9000,
      gravityMultiplier: 3
    })
  ],

  getById(id) {
    return this.stages.find(s => s.id === id);
  }
};
