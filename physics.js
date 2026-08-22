/*
  ファイル名: physics.js
  依存関係: なし（rocket.js/stage.jsのインスタンスを引数として受け取るのみ。
            script.js が定めた契約 [Physics.step/createSimState/updateWind/
            createSimState/updateWind] をここで実装する）
            ※ FlightRecorder(CSV出力用リングバッファ)は仕様変更によりCSV出力機能
              自体を撤去したため削除した。
  ------------------------------------------------------------------
  0.2 状態契約で定義された SimState / WindState の形を厳守する:
    WindState = { speed, dir(rad) }
    SimState  = { t, y, vy, ay, x, vx, ax, wind, view,
                  burning, parachuteDeployed, landed,
                  maxAltitude, maxDistance }
  ※ 本仕様のSimStateには姿勢角(angle)が含まれないため、本ファイルの
    飛行モデルは「発射角度のまま推力方向が固定される簡略モデル」を
    採用する（Barrowman法によるCP/CGを用いた能動的な姿勢制御・
    風見効果はrocket.js側の設計画面の安定性表示にのみ使用し、
    実飛行シミュレーションには持ち込まない）。
*/

class Physics {
  static G0 = 9.80665;
  static AIR_DENSITY_SEA_LEVEL = 1.225;

  /** 高度による空気密度の指数減衰近似（スケールハイト約8500m） */
  static airDensityAt(altitude) {
    const H = 8500;
    return this.AIR_DENSITY_SEA_LEVEL * Math.exp(-Math.max(0, altitude) / H);
  }

  /* ============================================================
     風（WindState）
     ------------------------------------------------------------
     発射待機中・カウントダウン中・飛行中のすべてのフェーズで
     毎フレーム updateWind() を呼び、ランダムウォークさせる。
     stage.windSpeedRange が null の場合（ステージ6=フリー）は
     stage.customWindSpeedRange（launch-prep画面でユーザーが自由設定した
     値。未設定なら[0,4]にフォールバック）を使用する。
  ============================================================ */
  static createWindState(stage) {
    const [min, max] = this._windRange(stage);
    return {
      speed: min + Math.random() * (max - min),
      dir: Math.random() * Math.PI * 2
    };
  }

  static _windRange(stage) {
    return stage.windSpeedRange || stage.customWindSpeedRange || [0, 4];
  }

  static updateWind(windState, dt, stage) {
    const [min, max] = this._windRange(stage);
    windState.speed += (Math.random() - 0.5) * 0.6 * dt;
    windState.speed = Math.min(max, Math.max(min, windState.speed));
    windState.dir += (Math.random() - 0.5) * 0.5 * dt;
    // 角度を 0〜2π に正規化
    windState.dir = ((windState.dir % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  }

  /* ============================================================
     SimState 生成・進行
  ============================================================ */

  /**
   * @param rocket Rocketインスタンス
   * @param stage Stageインスタンス
   * @param angleDeg 発射角度[度]（-45〜45, 0=真上）
   */
  static createSimState(rocket, stage, angleDeg) {
    const angleRad = (angleDeg * Math.PI) / 180;
    const burnDuration = rocket.engine.totalImpulse / rocket.engine.avgThrust;
    return {
      t: 0, y: 0, vy: 0, ay: 0, x: 0, vx: 0, ax: 0,
      wind: { speed: 0, dir: 0 }, // GameManager側で launch-prep からの風況に差し替えられる
      view: { mode: "fixed", tx: 0, ty: 0, zoom: 1 },
      burning: true,
      parachuteDeployed: false,
      landed: false,
      maxAltitude: 0,
      maxDistance: 0,
      apogeeTime: 0, // 最高高度に到達した時刻[s]（リザルトの「到達時間」表示用）
      // 内部利用（契約外の補助フィールド）
      _launchAngleRad: angleRad,
      _burnDuration: burnDuration,
      _burnoutT: null
    };
  }

  /**
   * SimStateを dt 秒だけ進める（fixed-timestep 1step分）。
   * 発射角度のまま推力方向が固定される簡略モデル
   * （姿勢の能動制御はしない。風は水平方向のみの外力として抗力に効かせる）。
   */
  static step(simState, rocket, stage, dt) {
    if (simState.landed) return;

    const mass = rocket.totalMass;
    const gravityMul = stage.gravityMultiplier;
    const airDensity = this.airDensityAt(simState.y);

    // ---- 推力 ----
    let thrustX = 0, thrustY = 0;
    if (simState.burning) {
      if (simState.t <= simState._burnDuration) {
        const mag = rocket.engine.avgThrust;
        thrustX = mag * Math.sin(simState._launchAngleRad);
        thrustY = mag * Math.cos(simState._launchAngleRad);
      } else {
        simState.burning = false;
        simState._burnoutT = simState.t;
      }
    }

    // ---- 対気速度（風は水平のみ） ----
    const windVx = simState.wind.speed * Math.cos(simState.wind.dir);
    const relVx = simState.vx - windVx;
    const relVy = simState.vy;
    const speed = Math.hypot(relVx, relVy);

    // ---- 空気抵抗 ----
    let cd = rocket.cd0;
    let area = rocket.referenceArea;
    if (simState.parachuteDeployed) {
      cd = 1.5; // 半球型パラシュートの標準的なCd
      area = rocket.parachute.area;
    }
    let dragX = 0, dragY = 0;
    if (speed > 1e-6) {
      const dragMag = 0.5 * airDensity * speed * speed * cd * area;
      dragX = -dragMag * (relVx / speed);
      dragY = -dragMag * (relVy / speed);
    }

    // ---- 合力 → 加速度 ----
    simState.ax = (thrustX + dragX) / mass;
    simState.ay = (thrustY + dragY) / mass - this.G0 * gravityMul;

    // ---- 積分（Semi-implicit Euler） ----
    simState.vx += simState.ax * dt;
    simState.vy += simState.ay * dt;
    simState.x += simState.vx * dt;
    simState.y += simState.vy * dt;
    simState.t += dt;

    // ---- パラシュート展開判定（燃焼終了からエンジン諸元のdelay秒後） ----
    if (!simState.burning && !simState.parachuteDeployed && simState._burnoutT !== null) {
      if (simState.t - simState._burnoutT >= rocket.engine.delay) {
        simState.parachuteDeployed = true;
      }
    }

    // ---- 記録更新 ----
    if (simState.y > simState.maxAltitude) { simState.maxAltitude = simState.y; simState.apogeeTime = simState.t; }
    simState.maxDistance = Math.max(simState.maxDistance, Math.abs(simState.x));

    // ---- 着地判定 ----
    if (simState.y <= 0 && simState.t > 0.3) {
      simState.y = 0;
      simState.landed = true;
    }
  }

  /* ============================================================
     設計画面用: 簡易予測最高高度
     ------------------------------------------------------------
     発射角度0°・無風・回転運動なしの1次元近似で高速に計算する。
     パラメータ変更のたびに呼んでも重くならないことを優先した近似値。
  ============================================================ */
  static estimateApogee(rocket, stage) {
    const mass = rocket.totalMass;
    if (mass <= 0) return 0;
    const burnDuration = rocket.engine.totalImpulse / rocket.engine.avgThrust;
    const gravityMul = stage.gravityMultiplier;
    const cd0 = rocket.cd0;
    const area = rocket.referenceArea;

    let y = 0, vy = 0, t = 0;
    const dt = 0.02;
    let maxY = 0;
    for (let i = 0; i < 8000; i++) {
      const rho = this.airDensityAt(Math.max(0, y));
      const thrust = t <= burnDuration ? rocket.engine.avgThrust : 0;
      const gravity = -mass * this.G0 * gravityMul;
      const dragMag = 0.5 * rho * vy * vy * cd0 * area;
      const drag = vy === 0 ? 0 : -Math.sign(vy) * dragMag;
      const accel = (thrust + gravity + drag) / mass;
      vy += accel * dt;
      y += vy * dt;
      t += dt;
      if (y > maxY) maxY = y;
      if (t > burnDuration && y <= 0) break;
    }
    return maxY;
  }

  /**
   * 慣性モーメントの簡易近似 [kg・m^2]（design画面の安定性表示等、
   * 実飛行シミュレーションには使用しない補助値として残す）
   */
  static momentOfInertia(mass, length) {
    return (mass * length * length) / 12;
  }
}
