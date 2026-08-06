/* ============================================================
   ROCKET FORGE - script.js
   ------------------------------------------------------------
   ゲーム全体の進行を管理する GameManager クラス。
   画面遷移（ステートマシン）、入力イベントの統括、
   飛行シミュレーションのメインループ（requestAnimationFrame）を担当する。

   読み込み順は index.html の通り、このファイルが最後に実行される
   （他の全クラスが定義済みであることが前提）。
============================================================ */

class GameManager {
  constructor() {
    this.currentScreenId = "screen-loading";
    this.rocket = null;
    this.stage = null;
    this.simulation = null;
    this.selectedPart = "nose";
    this.designZoom = 1;
    this.launchAngle = 0;

    this._homeAnimStop = null;
    this._simRafId = null;
    this._simLastT = null;
  }

  /* ============================================================
     初期化
  ============================================================ */
  init() {
    this._cacheDom();
    this._bindEvents();

    // ルール説明モーダルの中身を一度だけ生成
    this.dom.rulesBody.innerHTML = UI.renderRulesContent();

    // ローディング演出後にホームへ（体感的な起動感を出すための短い待機）
    setTimeout(() => this.showScreen("screen-home"), 700);

    window.addEventListener("resize", () => this._onResize());
  }

  _cacheDom() {
    this.dom = {
      screens: document.querySelectorAll(".screen"),
      // ホーム
      homeCanvas: document.getElementById("home-bg-canvas"),
      btnGotoStage: document.getElementById("btn-goto-stage"),
      btnGotoRules: document.getElementById("btn-goto-rules"),
      btnCloseRules: document.getElementById("btn-close-rules"),
      modalRules: document.getElementById("modal-rules"),
      rulesBody: document.getElementById("rules-body"),
      // ステージ選択
      btnStageBack: document.getElementById("btn-stage-back"),
      stageList: document.getElementById("stage-list"),
      // 設計
      btnDesignBack: document.getElementById("btn-design-back"),
      designStageName: document.getElementById("design-stage-name"),
      rocketPreviewCanvas: document.getElementById("rocket-preview-canvas"),
      partSelector: document.getElementById("part-selector"),
      btnZoomIn: document.getElementById("btn-zoom-in"),
      btnZoomOut: document.getElementById("btn-zoom-out"),
      btnGotoLaunch: document.getElementById("btn-goto-launch"),
      // 発射準備
      btnLaunchBack: document.getElementById("btn-launch-back"),
      launchPreviewCanvas: document.getElementById("launch-preview-canvas"),
      angleSlider: document.getElementById("angle-slider"),
      angleValue: document.getElementById("angle-value"),
      windReadout: document.getElementById("wind-readout"),
      btnLaunchGo: document.getElementById("btn-launch-go"),
      // シミュレーション
      simCanvas: document.getElementById("sim-canvas"),
      // リザルト
      btnResultRetry: document.getElementById("btn-result-retry"),
      btnResultStage: document.getElementById("btn-result-stage"),
    };
  }

  _bindEvents() {
    const d = this.dom;

    // ---- ホーム ----
    d.btnGotoStage.addEventListener("click", () => this.showScreen("screen-stage"));
    d.btnGotoRules.addEventListener("click", () => d.modalRules.classList.remove("hidden"));
    d.btnCloseRules.addEventListener("click", () => d.modalRules.classList.add("hidden"));
    d.modalRules.addEventListener("click", (e) => { if (e.target === d.modalRules) d.modalRules.classList.add("hidden"); });

    // ---- ステージ選択 ----
    d.btnStageBack.addEventListener("click", () => this.showScreen("screen-home"));

    // ---- 設計画面 ----
    d.btnDesignBack.addEventListener("click", () => this.showScreen("screen-stage"));
    d.partSelector.addEventListener("click", (e) => {
      const btn = e.target.closest(".part-btn");
      if (!btn) return;
      d.partSelector.querySelectorAll(".part-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      this.selectedPart = btn.dataset.part;
      UI.renderPartPanel(this.selectedPart, this.rocket, () => this._onRocketChanged());
    });
    d.btnZoomIn.addEventListener("click", () => { this.designZoom = Math.min(3, this.designZoom + 0.2); this._redrawDesignPreview(); });
    d.btnZoomOut.addEventListener("click", () => { this.designZoom = Math.max(0.4, this.designZoom - 0.2); this._redrawDesignPreview(); });
    d.btnGotoLaunch.addEventListener("click", () => this.showScreen("screen-launch"));

    // ---- 発射準備 ----
    d.btnLaunchBack.addEventListener("click", () => this.showScreen("screen-design"));
    d.angleSlider.addEventListener("input", () => {
      this.launchAngle = parseFloat(d.angleSlider.value);
      d.angleValue.textContent = `${this.launchAngle}°`;
      this._redrawLaunchPreview();
    });
    d.btnLaunchGo.addEventListener("click", () => this._startLaunch());

    // ---- リザルト ----
    d.btnResultRetry.addEventListener("click", () => this.showScreen("screen-design"));
    d.btnResultStage.addEventListener("click", () => this.showScreen("screen-stage"));
  }

  /* ============================================================
     画面遷移（ステートマシン本体）
  ============================================================ */
  showScreen(id) {
    // ホームアニメーションは他画面に行くとき停止（パフォーマンス確保）
    if (this.currentScreenId === "screen-home" && id !== "screen-home" && this._homeAnimStop) {
      this._homeAnimStop();
      this._homeAnimStop = null;
    }
    // シミュレーションループも画面を離れたら止める
    if (this.currentScreenId === "screen-sim" && id !== "screen-sim" && this._simRafId) {
      cancelAnimationFrame(this._simRafId);
      this._simRafId = null;
    }

    this.dom.screens.forEach(s => s.classList.remove("active"));
    document.getElementById(id).classList.add("active");
    this.currentScreenId = id;

    switch (id) {
      case "screen-home":
        this._homeAnimStop = UI.startHomeAnimation(this.dom.homeCanvas);
        break;
      case "screen-stage":
        UI.renderStageList(this.dom.stageList, StageDB.stages, (stage) => this._enterDesign(stage));
        break;
      case "screen-design":
        // 発射準備から戻ってきた場合など、ロケットは維持したままプレビューだけ更新
        this._refreshDesignScreen();
        break;
      case "screen-launch":
        this._enterLaunchPrep();
        break;
    }
  }

  /* ============================================================
     設計画面
  ============================================================ */
  _enterDesign(stage) {
    this.stage = stage;
    this.rocket = new Rocket();
    this.selectedPart = "nose";
    this.designZoom = 1;
    this.dom.designStageName.textContent = stage.name;
    this.dom.partSelector.querySelectorAll(".part-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.part === "nose"));
    this.showScreen("screen-design");
  }

  _refreshDesignScreen() {
    this.dom.designStageName.textContent = this.stage.name;
    UI.renderPartPanel(this.selectedPart, this.rocket, () => this._onRocketChanged());
    this._onRocketChanged();
  }

  /** ロケットのパラメータが変更されるたびに呼ばれる（プレビュー/データ/性能バー/予算を再計算） */
  _onRocketChanged() {
    this._redrawDesignPreview();
    UI.updateDataGrid(this.rocket, this.stage);
    UI.updatePerfBars(this.rocket);
    UI.updateBudgetIndicator(this.rocket, this.stage);
  }

  _redrawDesignPreview() {
    UI.drawDesignPreview(this.dom.rocketPreviewCanvas, this.rocket, this.designZoom);
  }

  /* ============================================================
     発射準備画面
  ============================================================ */
  _enterLaunchPrep() {
    this.launchAngle = 0;
    this.dom.angleSlider.value = 0;
    this.dom.angleValue.textContent = "0°";

    // 予定風況のプレビュー（実際のシミュレーション中はランダムウォークで変化する）
    const [minW, maxW] = this.stage.windSpeedRange;
    const previewWind = this.stage.isWindless ? 0 : (minW + maxW) / 2;
    this.dom.windReadout.textContent = this.stage.isWindless
      ? "無風"
      : `${previewWind.toFixed(1)} m/s（変動あり）`;

    this._redrawLaunchPreview();
  }

  _redrawLaunchPreview() {
    UI.drawLaunchPreview(this.dom.launchPreviewCanvas, this.rocket, this.launchAngle);
  }

  /* ============================================================
     発射 → シミュレーション開始
  ============================================================ */
  _startLaunch() {
    this.simulation = new Simulation(this.rocket, this.stage, this.launchAngle);
    this.showScreen("screen-sim");
    this._simLastT = null;
    this._simRafId = requestAnimationFrame((t) => this._simLoop(t));
  }

  /**
   * シミュレーションのメインループ。
   * 安定性のため、1フレームの物理積分を4回のサブステップに分割して実行する
   * （大きな推力による急加速でもオイラー積分が破綻しにくくなる）。
   */
  _simLoop(t) {
    if (this._simLastT === null) this._simLastT = t;
    let dt = (t - this._simLastT) / 1000;
    dt = Math.min(dt, 0.05); // タブが非アクティブ等で飛んだ場合の暴走防止
    this._simLastT = t;

    const sim = this.simulation;
    const substeps = 4;
    for (let i = 0; i < substeps; i++) {
      sim.step(dt / substeps);
      if (sim.landed) break;
    }

    this._renderSim(sim);
    UI.updateTelemetryHUD(sim);

    if (sim.landed) {
      this._simRafId = null;
      // 少し余韻を持たせてからリザルトへ
      setTimeout(() => this._goToResult(), 400);
      return;
    }
    this._simRafId = requestAnimationFrame((t2) => this._simLoop(t2));
  }

  /**
   * シミュレーション画面の描画。
   * - 背景は高度に応じて大気色→宇宙色へグラデーション（1000mで宇宙背景に切替）
   * - 地面/星はロケットの動きに合わせてスクロール
   * - ロケットは画面中央付近に固定し、カメラ（世界座標→画面座標の変換）側を動かす
   */
  _renderSim(sim) {
    const canvas = this.dom.simCanvas;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;

    const SPACE_ALTITUDE = 1000; // この高度で宇宙背景に切り替える
    const skyT = Math.min(1, Math.max(0, sim.y / SPACE_ALTITUDE));

    // ---- 背景グラデーション（大気色 → 宇宙色） ----
    const skyColor = [11, 48, 80];   // 大気圏（薄暮の青）
    const spaceColor = [3, 4, 12];   // 宇宙（漆黒に近い紺）
    const bgColor = skyColor.map((c, i) => Math.round(c + (spaceColor[i] - c) * skyT));
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgb(${bgColor[0]},${bgColor[1]},${bgColor[2]})`);
    grad.addColorStop(1, `rgb(${Math.round(bgColor[0] * 0.4)},${Math.round(bgColor[1] * 0.4)},${Math.round(bgColor[2] * 0.6)})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // ---- カメラ変換パラメータ ----
    // ロケットは常に画面中央やや下（60%位置）に表示し続ける。
    const rocketScreenY = h * 0.6;
    const scale = Math.max(2, Math.min(9, 500 / (100 + sim.y))) * devicePixelRatio; // 高度が上がるほどズームアウト
    const worldToScreenY = (worldY) => rocketScreenY - (worldY - sim.y) * scale;
    const worldToScreenX = (worldX) => w / 2 + (worldX - sim.x) * scale;

    // ---- 星（高度に応じて濃さが増す） ----
    if (skyT > 0.05) {
      ctx.fillStyle = `rgba(255,255,255,${0.15 + skyT * 0.7})`;
      // 星は世界座標に固定し、カメラの動きに合わせて視差スクロールさせる
      for (let i = 0; i < 60; i++) {
        const sx = (i * 137.5) % w; // 疑似ランダム分布
        const sy = ((i * 97.3 + sim.y * 0.3) % h + h) % h;
        ctx.fillRect(sx, sy, 1.6 * devicePixelRatio, 1.6 * devicePixelRatio);
      }
    }

    // ---- 地面（高度が上がると画面外へスクロールしていく） ----
    const groundScreenY = worldToScreenY(0);
    if (groundScreenY < h + 20) {
      ctx.fillStyle = "#0a1220";
      ctx.fillRect(0, groundScreenY, w, h - groundScreenY);
      ctx.strokeStyle = "rgba(0,229,255,0.25)";
      ctx.lineWidth = 2 * devicePixelRatio;
      ctx.beginPath(); ctx.moveTo(0, groundScreenY); ctx.lineTo(w, groundScreenY); ctx.stroke();
      // 発射台マーカー（横スクロールにも追従）
      const padX = worldToScreenX(0);
      ctx.strokeStyle = "rgba(255,176,32,0.6)";
      ctx.beginPath();
      ctx.moveTo(padX - 14 * devicePixelRatio, groundScreenY);
      ctx.lineTo(padX + 14 * devicePixelRatio, groundScreenY);
      ctx.stroke();
    }

    // ---- ロケット本体 ----
    const rx = worldToScreenX(sim.x);
    const ry = worldToScreenY(sim.y);
    UI.drawRocketShape(ctx, this.rocket, rx, ry, scale, sim.angle, {
      flame: sim.isBurning,
      parachuteOpen: sim.parachuteDeployed
    });
  }

  _goToResult() {
    Result.render(this.simulation, this.stage);
    this.showScreen("screen-result");
  }

  /* ============================================================
     リサイズ対応（現在アクティブな画面のCanvasだけ再描画）
  ============================================================ */
  _onResize() {
    if (!this.rocket) return;
    if (this.currentScreenId === "screen-design") this._redrawDesignPreview();
    if (this.currentScreenId === "screen-launch") this._redrawLaunchPreview();
  }
}

/* ============================================================
   エントリポイント
============================================================ */
const Game = new GameManager();
window.addEventListener("DOMContentLoaded", () => Game.init());
