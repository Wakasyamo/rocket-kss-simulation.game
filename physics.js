/* ============================================================
   ROCKET FORGE - physics.js
   ------------------------------------------------------------
   このファイルには「力学計算そのもの」を担当する2つのクラスを
   定義する。

   - Physics    : 力の計算式を集めた「純粋関数群」（状態を持たない）
   - Simulation : Physics の関数を使って、時間発展する飛行状態
                  （位置・速度・姿勢・風）を管理するクラス

   単位系は SI 単位（メートル・秒・キログラム・ニュートン）で統一する。
============================================================ */

/* ============================================================
   Physics クラス
   ------------------------------------------------------------
   すべて static メソッド = 「入力を渡すと力/値を返すだけ」の
   副作用のない関数として実装する（テスト・デバッグしやすくするため）。
============================================================ */
class Physics {

  // 標準重力加速度 [m/s^2]（ステージごとの重力倍率を掛けて使う）
  static G0 = 9.80665;

  // 海面での空気密度 [kg/m^3]
  static AIR_DENSITY_SEA_LEVEL = 1.225;

  /**
   * 高度による空気密度の簡易近似。
   * 実大気は指数関数的に薄くなるため、スケールハイト（約8500m）を
   * 使った指数減衰モデルで近似する。
   *   rho(h) = rho0 * exp(-h / H)
   * ゲームで扱う高度（〜数千m）では十分な精度。
   */
  static airDensityAt(altitude) {
    const H = 8500; // スケールハイト [m]
    const rho = this.AIR_DENSITY_SEA_LEVEL * Math.exp(-Math.max(0, altitude) / H);
    return rho;
  }

  /**
   * 重力による力ベクトル [N]
   * @param mass 質量 [kg]
   * @param gravityMultiplier ステージ重力倍率（1G, 3G 等）
   * @returns {x, y} 常に鉛直下向き（yは下向き正の座標系で正、上向き正なら符号反転して使う）
   */
  static gravityForce(mass, gravityMultiplier = 1) {
    return { x: 0, y: -mass * this.G0 * gravityMultiplier };
    // ※ y軸は「上向きが正」の物理座標として扱う（Canvas描画時に反転する）
  }

  /**
   * 推力ベクトル [N]
   * ロケットの機軸方向（angle: 鉛直から測った傾き, ラジアン）へ推力を発生させる。
   * @param thrustMagnitude 推力の大きさ [N]
   * @param angle 機体の姿勢角 [rad]（0 = 真上向き, 正 = 右へ傾き）
   */
  static thrustForce(thrustMagnitude, angle) {
    return {
      x: thrustMagnitude * Math.sin(angle),
      y: thrustMagnitude * Math.cos(angle)
    };
  }

  /**
   * 空気抵抗係数 Cd の近似式。
   * ------------------------------------------------------------
   * 【近似の考え方】
   * 実際のCdはマッハ数・形状・表面粗さなど多くの要因に依存するが、
   * このゲームでは以下の簡易モデルで十分なリアリティを持たせる。
   *
   *   Cd(alpha) = Cd0 + k * sin^2(alpha)
   *
   *   Cd0  : 迎角0（機軸が進行方向と一致）のときの基本抗力係数。
   *          先端形状が尖っているほど小さい（円錐 > オジーブ > 楕円 の順に減少）
   *   k    : 迎角による抗力増加の係数。機体が進行方向に対して傾く（横を向く）ほど
   *          正面投影面積が増え、抗力が急増する現象を sin^2(alpha) で表現。
   *          alpha=90°（真横を向く）で最大となり、抵抗が大きく増す。
   *
   * これは実測CD-alpha曲線を「なめらかな三角関数」で置き換えた近似であり、
   * 厳密な空力計算（CFD等）の代わりに、ゲームとして自然な挙動
   * （傾くと急激に減速する）を再現するために採用している。
   */
  static dragCoefficient(cd0, alpha) {
    const k = 1.2; // 迎角による抗力増加の強さ（経験的に決定したゲームバランス係数）
    return cd0 + k * Math.sin(alpha) * Math.sin(alpha);
  }

  /**
   * 空気抵抗力 [N]（速度と逆向きに作用）
   * D = 0.5 * rho * v^2 * Cd * A
   */
  static dragForce(relativeVelocity, airDensity, cd, referenceArea) {
    const speed = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    if (speed < 1e-6) return { x: 0, y: 0 };
    const magnitude = 0.5 * airDensity * speed * speed * cd * referenceArea;
    // 速度と逆方向の単位ベクトル
    return {
      x: -magnitude * (relativeVelocity.x / speed),
      y: -magnitude * (relativeVelocity.y / speed)
    };
  }

  /**
   * 揚力（横方向の空力）[N]
   * ------------------------------------------------------------
   * 「速度の2乗」と「迎角(alpha)」に比例する簡易モデルを採用。
   *   L = 0.5 * rho * v^2 * CnAlpha * alpha * A
   * 本来Barrowman法のCnAlphaは無次元の勾配係数（alphaに対する法線力係数の傾き）
   * であり、小迎角near-linear領域ではこの線形近似で十分。
   * 方向は「機軸に対して垂直」で、alphaを解消する側（機体を風向きに戻す側）に作用する。
   */
  static liftForce(relativeVelocity, airDensity, cnAlpha, alpha, referenceArea, rocketAngle) {
    const speed = Math.hypot(relativeVelocity.x, relativeVelocity.y);
    if (speed < 1e-6) return { x: 0, y: 0 };
    const magnitude = 0.5 * airDensity * speed * speed * cnAlpha * alpha * referenceArea;
    // 機軸に垂直な方向（機体角度から90度回転させたベクトル）
    const perpX = Math.cos(rocketAngle);
    const perpY = -Math.sin(rocketAngle);
    return { x: magnitude * perpX, y: magnitude * perpY };
  }

  /**
   * 慣性モーメントの簡易近似 [kg・m^2]
   * 厳密には各部品の質量分布を積分すべきだが、ここでは
   * 「質量が機体全長に一様分布した細い棒」として近似する:
   *   I = m * L^2 / 12
   * ゲーム上の回転挙動としては十分自然に感じられる近似値になる。
   */
  static momentOfInertia(mass, length) {
    return (mass * length * length) / 12;
  }
}

/* ============================================================
   Simulation クラス
   ------------------------------------------------------------
   1回の打ち上げの「時間発展する状態」を保持し、step()で毎フレーム
   物理を進める。GameManager（script.js）はこのクラスを毎フレーム
   呼び出すだけでよい。
============================================================ */
class Simulation {
  /**
   * @param rocket  Rocket インスタンス（質量・CG・CP・空力データを提供）
   * @param stage   Stage インスタンス（風・重力倍率を提供）
   * @param launchAngleDeg 発射角度（度, -45〜45）
   */
  constructor(rocket, stage, launchAngleDeg) {
    this.rocket = rocket;
    this.stage = stage;

    // ---- 状態変数 ----
    this.time = 0;
    this.x = 0;                              // 水平位置 [m]
    this.y = 0;                              // 高度 [m]（地面=0）
    this.vx = 0;
    this.vy = 0;
    this.angle = (launchAngleDeg * Math.PI) / 180; // 姿勢角 [rad]（0=真上）
    this.angularVelocity = 0;                // [rad/s]

    // ---- エンジン燃焼管理 ----
    const engine = rocket.engine;
    this.burnDuration = engine.totalImpulse / engine.avgThrust; // [s]
    this.isBurning = true;
    this.burnedOut = false;
    this.burnoutTime = null;

    // ---- パラシュート ----
    this.parachuteDeployed = false;

    // ---- 記録用（リザルト集計） ----
    this.maxAltitude = 0;
    this.maxDistance = 0;
    this.landed = false;

    // ---- 風モデル ----
    // ステージ設定範囲内でランダムウォークさせる現在の風速・風向
    this.windSpeed = this._randomInRange(stage.windSpeedRange);
    this.windDirection = Math.random() * Math.PI * 2; // [rad]
    this._windTimer = 0;
  }

  _randomInRange([min, max]) {
    return min + Math.random() * (max - min);
  }

  /** 風況を時間経過でゆるやかにランダム変化させる（ランダムウォーク） */
  _updateWind(dt) {
    this._windTimer += dt;
    // 0.5秒ごとに小さな変化を加える → 滑らかな乱流感
    const [minSpd, maxSpd] = this.stage.windSpeedRange;
    this.windSpeed += (Math.random() - 0.5) * 0.6 * dt;
    this.windSpeed = Math.min(maxSpd, Math.max(minSpd, this.windSpeed));
    this.windDirection += (Math.random() - 0.5) * 0.5 * dt;
  }

  /** 現在の風ベクトル [m/s]（水平方向のみを簡略的に扱う） */
  get windVector() {
    return {
      x: this.windSpeed * Math.cos(this.windDirection),
      y: 0
    };
  }

  /**
   * シミュレーションを dt 秒だけ進める。
   * 積分法は Semi-implicit Euler（速度→位置の順に更新）を採用。
   * 軽量かつロケットのような放物運動シミュレーションでは十分安定。
   */
  step(dt) {
    if (this.landed) return;
    this.time += dt;
    this._updateWind(dt);

    const rocket = this.rocket;
    const mass = rocket.totalMass; // 燃料消費は簡略化のため一定質量として扱う
    const gravityMul = this.stage.gravityMultiplier;
    const altitude = this.y;
    const airDensity = Physics.airDensityAt(altitude);

    // ---- 1. 推力 ----
    let thrust = { x: 0, y: 0 };
    if (this.isBurning) {
      if (this.time <= this.burnDuration) {
        thrust = Physics.thrustForce(rocket.engine.avgThrust, this.angle);
      } else {
        this.isBurning = false;
        this.burnedOut = true;
        this.burnoutTime = this.time;
      }
    }

    // ---- 2. 重力 ----
    const gravity = Physics.gravityForce(mass, gravityMul);

    // ---- 3. 対気速度（風を考慮した相対速度） ----
    const wind = this.windVector;
    const relVel = { x: this.vx - wind.x, y: this.vy - wind.y };
    const speed = Math.hypot(relVel.x, relVel.y);

    // ---- 4. 迎角 alpha（機軸と対気速度ベクトルのなす角） ----
    // 速度ベクトルの向き（進行角）と機体角度の差
    let alpha = 0;
    if (speed > 0.5) {
      const velAngle = Math.atan2(relVel.x, relVel.y); // 0=真上方向を基準にした角
      alpha = this._normalizeAngle(this.angle - velAngle);
    }

    // ---- 5. 空気抵抗 ----
    const cd = Physics.dragCoefficient(rocket.cd0, alpha);
    const refArea = rocket.referenceArea;
    const drag = Physics.dragForce(relVel, airDensity, cd, refArea);

    // ---- 6. パラシュート抗力（展開後は大幅に抗力増加） ----
    let chuteDrag = { x: 0, y: 0 };
    if (this.parachuteDeployed) {
      const chuteArea = rocket.parachute.area;
      const chuteCd = 1.5; // 半球型パラシュートの標準的なCd
      chuteDrag = Physics.dragForce(relVel, airDensity, chuteCd, chuteArea);
    }

    // ---- 7. 揚力（姿勢を風向きに戻す/崩す力） ----
    const lift = Physics.liftForce(relVel, airDensity, rocket.cnAlpha, alpha, refArea, this.angle);

    // ---- 8. 合力・並進運動の積分 ----
    const totalForce = {
      x: thrust.x + gravity.x + drag.x + chuteDrag.x + lift.x,
      y: thrust.y + gravity.y + drag.y + chuteDrag.y + lift.y
    };
    const ax = totalForce.x / mass;
    const ay = totalForce.y / mass;
    this.vx += ax * dt;
    this.vy += ay * dt;
    this.x += this.vx * dt;
    this.y += this.vy * dt;

    // ---- 9. 回転運動の積分 ----
    // トルク = 揚力 × (CP-CGのモーメントアーム)。
    // CPが機体重心より後方（Xcp > Xcg）にあれば、迎角を減らす向き（復元方向）
    // に自然にトルクが働く（安定ロケットの物理そのもの）。
    if (!this.parachuteDeployed) {
      const armLength = rocket.staticMarginMeters; // (Xcp - Xcg) [m]
      const liftMag = Math.hypot(lift.x, lift.y) * Math.sign(alpha || 1);
      const torque = -liftMag * armLength;
      const inertia = Physics.momentOfInertia(mass, rocket.totalLength);
      const angularAccel = inertia > 0 ? torque / inertia : 0;
      this.angularVelocity += angularAccel * dt;
      this.angularVelocity *= 0.995; // 空力減衰（簡易ダンピング）
      this.angle += this.angularVelocity * dt;
    }

    // ---- 10. パラシュート展開判定 ----
    // 燃焼終了後、エンジン諸元の delay 秒後に展開
    if (this.burnedOut && !this.parachuteDeployed) {
      if (this.time - this.burnoutTime >= rocket.engine.delay) {
        this.parachuteDeployed = true;
      }
    }

    // ---- 11. 記録更新 ----
    if (this.y > this.maxAltitude) this.maxAltitude = this.y;
    this.maxDistance = Math.max(this.maxDistance, Math.abs(this.x));

    // ---- 12. 着地判定 ----
    if (this.y <= 0 && this.time > 0.3) {
      this.y = 0;
      this.landed = true;
    }
  }

  /** 角度を -PI 〜 PI に正規化 */
  _normalizeAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }
}
