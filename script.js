/*
  ファイル名: script.js
  依存関係: index.html（全DOM要素） / physics.js（Physics系API）/
            rocket.js（Rocket, Engine）/ stage.js（STAGES配列）/
            ui.js（UI.*、drawRocketShapeで設計画面の2Dプレビューも兼用）/
            result.js（Result.*）
  ------------------------------------------------------------------
  ※ 設計画面のロケット表示は当初Three.js(rocket3d.js, ESモジュール)による
    3D表示だったが、CDN経由のモジュール読み込みが環境によって失敗し
    「ロケットが表示されない」不具合が繰り返し発生したため、外部依存の
    ない2D Canvas描画（UI.drawRocketShape）へ変更した。rocket3d.jsは
    プロジェクトに残しているが読み込んでいない。
  ------------------------------------------------------------------
  このファイルは他ファイルより「先に」出力する回で書いているため、
  未実装の physics.js / rocket.js / stage.js / ui.js / result.js が
  提供すべき API 契約をここで確定させ、コメントで明記する。
  以降のファイルはこの契約に合わせて実装する。

  ---- 契約: physics.js ----
    Physics.G0                                   : number（重力加速度）
    Physics.airDensityAt(altitude)                : number
    Physics.estimateApogee(rocket, stage)         : number（設計画面用の簡易予測高度）
    Physics.createWindState(stage)                : WindState  { speed, dir(rad) }
    Physics.updateWind(windState, dt, stage)      : void（ windStateを直接ミューテート。
                                                     発射待機/カウントダウン/飛行の
                                                     すべてのフェーズで毎フレーム呼ぶ ）
    Physics.createSimState(rocket, stage, angleDeg): SimState
      SimState = { t, y, vy, ay, x, vx, ax, wind:{speed,dir},
                   view:{mode:'fixed'|'track'|'free', tx, ty, zoom},
                   burning, parachuteDeployed, landed, retired,
                   maxAltitude, maxDistance }
    Physics.step(simState, rocket, stage, dt)      : void（fixed-timestep 1step分だけ進める）
    ※ CSV出力機能の撤去に伴い Physics.FlightRecorder は削除した。

  ---- 契約: rocket.js ----
    class Rocket {
      parts: [RocketPart]  // {type,x_ref,length,diameter,mass,color?,pattern?,finParams?}
      cg, cp, totalMass, diameter_mm  // getter
      totalPrice, totalStrength, strengthStars, lightnessLevel
      cnAlpha, cd0, referenceArea, totalLength
      toJSON() / static fromJSON(data)
      各パーツ(nose/body/fins/transition/parachute/engine)は massOverride
      プロパティを持ち、null以外なら計算値より優先される（ステージ6限定機能）
    }
    class Engine { ... length=0.07固定、centerOffset=0.035 }

  ---- 契約: stage.js ----
    const STAGES = [ {
      id, name, difficulty: 'beginner'|'intermediate'|'advanced'|'custom',
      budget (Infinityでフリー), minDiameterMM,
      allowedEngineClasses: string[] ('1/2A'〜'H') または 'ALL',
      windSpeedRange: [min,max] または null(=自由設定, ステージ6),
      gravityMultiplier,
      customUnlocked: boolean (自由形フィン・トランジション解放),
      tutorial: boolean (工程説明・チュートリアルダイアログを出すか),
      clearGoal: { label: string, evaluate(resultStats): boolean }
    }, ... ]  // 6ステージ分

  ---- 契約: ui.js ----
    UI.renderStageList(container, STAGES, onSelect)
    UI.renderExplanationContent(stage) -> HTML string
    UI.renderTutorialContent(stage, phase:'design'|'launch') -> HTML string | null
    UI.renderPartPanel(partType, rocket, stage, onUpdate)
    UI.updateDataGrid(rocket, stage) / UI.updatePerfBars(rocket) / UI.updateBudgetIndicator(rocket, stage)
    UI.showHelpBubble(part, anchorEl) / UI.hideHelpBubble()
    UI.renderSavedDesignsList(container, list, stage, {onLoad,onDelete})
    UI.drawRocketShape(ctx, rocket, cx, cy, scale, angleRad, opts)  // 既存踏襲
    UI.updateTelemetryHUD(simState)
    UI.updateWindReadout(el, windState) / UI.updateWindArrowSVG(svgEl, windState)
    UI.starString(level, max)

  ---- 契約: result.js ----
    Result.render(simState, rocket, stage) : { cleared: boolean, score: number }
    Result.exportDesignText(rocket, stage) : string
    Result.shareResult(simState, rocket, stage, score) : Promise<void>
    ※ CSV出力機能は撤去したため Result.downloadCSV は存在しない。
*/

/* ============================================================
   DesignStorage（localStorage保存・複数設計比較）
============================================================ */
const DesignStorage = {
  KEY: "rocketforge_designs",
  loadAll() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || "[]"); }
    catch (e) { console.error("設計データの読込に失敗しました", e); return []; }
  },
  saveAll(list) {
    try { localStorage.setItem(this.KEY, JSON.stringify(list)); return true; }
    catch (e) { console.error("設計データの保存に失敗しました", e); return false; }
  },
  add(name, rocket, stage) {
    const list = this.loadAll();
    const entry = {
      id: `d_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
      name: name || `無題の設計 ${list.length + 1}`,
      savedAt: Date.now(),
      stageId: stage.id,
      stageName: stage.name,
      rocket: rocket.toJSON(),
      stats: {
        massG: rocket.totalMass * 1000,
        price: rocket.totalPrice,
        apogee: Physics.estimateApogee(rocket, stage)
      }
    };
    list.push(entry);
    this.saveAll(list);
    return entry;
  },
  remove(id) { this.saveAll(this.loadAll().filter(d => d.id !== id)); }
};

/* ============================================================
   Router
   ------------------------------------------------------------
   7ステートの遷移のみを責務とする軽量ルーター。
   各ステートの onEnter/onExit は GameManager 側で登録する
   （「script.js に onEnter/onExit フックを定義」要件への対応）。
============================================================ */
class Router {
  constructor(states) {
    this.states = states; // ['home','stage-select',...]
    this.hooks = {};      // { [state]: { onEnter, onExit } }
    this.current = null;
  }

  register(state, { onEnter, onExit } = {}) {
    this.hooks[state] = { onEnter, onExit };
  }

  goto(nextState, payload) {
    if (!this.states.includes(nextState)) {
      console.error(`未定義のstateです: ${nextState}`);
      return;
    }
    const prev = this.current;
    if (prev && this.hooks[prev]?.onExit) this.hooks[prev].onExit(nextState);

    this.states.forEach(s => {
      const el = document.getElementById(`screen-${s}`);
      if (el) el.classList.toggle("active", s === nextState);
    });

    // body に現在stateのクラスを付与（style.cssの body.state-flight 等と連動）
    document.body.classList.remove(...this.states.map(s => `state-${s}`));
    document.body.classList.add(`state-${nextState}`);

    this.current = nextState;
    if (this.hooks[nextState]?.onEnter) this.hooks[nextState].onEnter(payload);
  }
}

/* ============================================================
   BackgroundScene
   ------------------------------------------------------------
   飛行画面の背景（家・人・ビル・電柱・空）を担当。
   0.3の要件どおり、オブジェクト群は「オフスクリーンcanvasに事前
   キャッシュ」し、毎フレームは事前キャッシュ画像を配置座標に沿って
   blitするだけにする（毎フレームpath再描画しない）。
============================================================ */
class BackgroundScene {
  constructor() {
    this.objects = []; // { kind, worldX }
    this._cache = {};  // kind -> offscreen canvas
    this._built = false;
    this._theme = "city"; // 'city'|'suburb'|'wasteland'
  }

  /**
   * 背景テーマを切り替える（機能追加要件: 複数背景の変更ロジック）。
   * テーマごとにオブジェクトの構成比率を変え、再配置する。
   */
  setTheme(theme) {
    if (this._theme === theme && this._built) return;
    this._theme = theme;
    this.objects = [];
    this._built = false;
    this.build();
  }

  /** 実寸大スケール比較用オブジェクト群を1度だけ生成し、オフスクリーンにキャッシュする */
  build() {
    if (this._built) return;
    if (!this._cache.person) {
      this._cache.person   = this._bakePerson();
      this._cache.house    = this._bakeHouse();
      this._cache.building = this._bakeBuilding();
      this._cache.pole     = this._bakePole();
    }

    // テーマごとにオブジェクトの出現比率を変える（重み付き抽選用の配列）
    const weightsByTheme = {
      city:      ["building", "building", "house", "person", "pole"],
      suburb:    ["house", "house", "person", "pole", "building"],
      wasteland: ["pole", "person"]
    };
    const kinds = weightsByTheme[this._theme] || weightsByTheme.city;
    const count = this._theme === "wasteland" ? 12 : 40; // 荒野は物が少ない

    for (let i = 0; i < count; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      this.objects.push({
        kind,
        worldX: (i - count / 2) * (8 + Math.random() * 10),
      });
    }
    this._built = true;
  }

  _bakePerson() {
    // 実寸: 高さ約1.7m。1px=1cm相当のオフスクリーンで焼き込む。
    const c = document.createElement("canvas");
    c.width = 30; c.height = 170;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#3a4a58";
    ctx.beginPath(); ctx.arc(15, 20, 14, 0, Math.PI * 2); ctx.fill(); // 頭
    ctx.fillRect(6, 34, 18, 90);   // 胴
    ctx.fillRect(4, 124, 8, 46);   // 脚(左)
    ctx.fillRect(18, 124, 8, 46);  // 脚(右)
    return c;
  }

  _bakeHouse() {
    const c = document.createElement("canvas");
    c.width = 600; c.height = 500; // 実寸: 幅6m 高さ5m相当
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#4a5a68";
    ctx.fillRect(0, 220, 600, 280);
    ctx.beginPath();
    ctx.moveTo(-20, 220); ctx.lineTo(300, 40); ctx.lineTo(620, 220);
    ctx.closePath(); ctx.fillStyle = "#5a3a3a"; ctx.fill();
    ctx.fillStyle = "#1a2430";
    ctx.fillRect(260, 380, 90, 120); // ドア
    return c;
  }

  _bakeBuilding() {
    const c = document.createElement("canvas");
    c.width = 1800; c.height = 4000; // 実寸: 幅18m 高さ40m相当
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#33404c";
    ctx.fillRect(0, 0, 1800, 4000);
    ctx.fillStyle = "rgba(255,209,102,0.25)";
    for (let y = 100; y < 4000; y += 220) {
      for (let x = 100; x < 1800; x += 220) {
        ctx.fillRect(x, y, 120, 140);
      }
    }
    return c;
  }

  _bakePole() {
    const c = document.createElement("canvas");
    c.width = 20; c.height = 800; // 実寸: 高さ8m相当
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#2a2f38";
    ctx.fillRect(8, 0, 4, 800);
    ctx.fillRect(0, 40, 20, 6);
    return c;
  }

  /**
   * 背景を描画する。カメラのワールド座標(camX, groundScreenY, scale)に基づき、
   * キャッシュ済みcanvasを配置座標へ描き込むだけ（再構築しない）。
   */
  draw(ctx, w, h, camX, groundScreenY, scale) {
    if (!this._built) this.build();
    this.objects.forEach(o => {
      const img = this._cache[o.kind];
      const screenX = w / 2 + (o.worldX - camX) * scale;
      if (screenX < -200 || screenX > w + 200) return; // 画面外は描かない
      const drawScale = scale / 100; // 1px=1cmで焼いたキャッシュを実寸換算
      const dw = img.width * drawScale;
      const dh = img.height * drawScale;
      ctx.drawImage(img, screenX - dw / 2, groundScreenY - dh, dw, dh);
    });
  }
}

/* ============================================================
   GameManager
============================================================ */
class GameManager {
  constructor() {
    this.router = new Router([
      "home", "stage-select", "explanation", "design",
      "launch-prep", "flight", "result"
    ]);

    this.rocket = null;
    this.stage = null;
    this.selectedPart = "nose";
    this.launchAngle = 0;

    this.windState = null;
    this._windLoopId = null;

    this.simState = null;
    this._flightRafId = null;
    this._flightLastT = null;
    this._flightAccumulator = 0;
    this._speedMultiplier = 1;

    this._designZoom = 1;
    this._homeAnimStop = null;
    this._helpMode = false;
    this._activeHelpIcon = null;

    this.bgScene = new BackgroundScene();
    this._bgSettings = { timeOfDay: "day", customImage: null };

    // 自由視点モード用のカメラ状態（simState.viewと同期）
    this._dragState = null;
    this._pinchState = null;
  }

  /* ============================================================
     初期化
  ============================================================ */
  init() {
    this._cacheDom();
    this._bindStaticEvents();
    this._bindCharacterFallback();
    this._registerRoutes();
    this.dom.rulesBody.insertBefore(
      this._buildRulesContentFallback(), this.dom.rulesPdfLink
    );
    this.router.goto("home");
    window.addEventListener("resize", () => this._onResize());
  }

  /** ui.jsの内容生成前でも表示が崩れないための最低限のフォールバック本文 */
  _buildRulesContentFallback() {
    const div = document.createElement("div");
    div.id = "rules-body-fallback";
    return div;
  }

  _cacheDom() {
    this.dom = {
      // home
      btnGotoStage: document.getElementById("btn-goto-stage"),
      btnGotoRules: document.getElementById("btn-goto-rules"),
      modalRules: document.getElementById("modal-rules"),
      btnCloseRules: document.getElementById("btn-close-rules"),
      rulesBody: document.getElementById("rules-body"),
      rulesPdfLink: document.getElementById("rules-pdf-link"),
      // stage-select
      btnStageBack: document.getElementById("btn-stage-back"),
      stageList: document.getElementById("stage-list"),
      // explanation
      explanationBody: document.getElementById("explanation-body"),
      btnExplanationSkip: document.getElementById("btn-explanation-skip"),
      btnExplanationNext: document.getElementById("btn-explanation-next"),
      // tutorial(共通モーダル)
      modalTutorial: document.getElementById("modal-tutorial"),
      tutorialTitle: document.getElementById("tutorial-title"),
      tutorialBody: document.getElementById("tutorial-body"),
      btnCloseTutorial: document.getElementById("btn-close-tutorial"),
      // design
      btnDesignBack: document.getElementById("btn-design-back"),
      designStageName: document.getElementById("design-stage-name"),
      rocket2DCanvas: document.getElementById("rocket-preview-2d"),
      btnZoomIn: document.getElementById("btn-zoom-in"),
      btnZoomOut: document.getElementById("btn-zoom-out"),
      partSelector: document.getElementById("part-selector"),
      btnGotoLaunch: document.getElementById("btn-goto-launch"),
      btnHelpToggle: document.getElementById("btn-help-toggle"),
      helpBubble: document.getElementById("help-bubble"),
      btnCloseHelpBubble: document.getElementById("btn-close-help-bubble"),
      btnDesignsManager: document.getElementById("btn-designs-manager"),
      modalDesigns: document.getElementById("modal-designs"),
      btnCloseDesigns: document.getElementById("btn-close-designs"),
      designNameInput: document.getElementById("design-name-input"),
      btnSaveDesign: document.getElementById("btn-save-design"),
      designsList: document.getElementById("designs-list"),
      // launch-prep
      btnLaunchBack: document.getElementById("btn-launch-back"),
      angleSlider: document.getElementById("angle-slider"),
      angleValue: document.getElementById("angle-value"),
      windReadout: document.getElementById("wind-readout"),
      bgTimeOfDayGroup: document.getElementById("bg-timeofday"),
      bgThemeGroup: document.getElementById("bg-theme"),
      bgImageInput: document.getElementById("bg-image-input"),
      bgImageClear: document.getElementById("bg-image-clear"),
      physicsSettings: document.getElementById("physics-settings"),
      customWindMin: document.getElementById("custom-wind-min"),
      customWindMinValue: document.getElementById("custom-wind-min-value"),
      customWindMax: document.getElementById("custom-wind-max"),
      customWindMaxValue: document.getElementById("custom-wind-max-value"),
      customGravity: document.getElementById("custom-gravity"),
      customGravityValue: document.getElementById("custom-gravity-value"),
      launchBtn: document.getElementById("launch-btn"),
      countdownOverlay: document.getElementById("countdown-overlay"),
      countdownNumber: document.getElementById("countdown-number"),
      countdownWind: document.getElementById("countdown-wind"),
      // flight
      bgCanvas: document.getElementById("bg"),
      rocketCanvas: document.getElementById("rocket"),
      overlayCanvas: document.getElementById("overlay"),
      teleAlt: document.getElementById("tele-alt"),
      teleVel: document.getElementById("tele-vel"),
      teleTime: document.getElementById("tele-time"),
      hudSpeed: document.getElementById("hud-speed"),
      hudZoom: document.getElementById("hud-zoom"),
      windArrowFlight: document.getElementById("wind-arrow-flight"),
      viewModeGroup: document.getElementById("view-mode"),
      speedXGroup: document.getElementById("speed-x"),
      zoomSlider: document.getElementById("zoom"),
      // result
      btnExportDesign: document.getElementById("export-design"),
      btnShareResult: document.getElementById("share-result"),
      btnViewRanking: document.getElementById("btn-view-ranking"),
      modalRanking: document.getElementById("modal-ranking"),
      btnCloseRanking: document.getElementById("btn-close-ranking"),
      rankingList: document.getElementById("ranking-list"),
      btnReplay: document.getElementById("replay-btn"),
      btnResultStageSelect: document.getElementById("btn-result-stage-select"),
      btnRetire: document.getElementById("btn-retire"),
      resultClearBadge: document.getElementById("result-clear-badge"),
      modalDesignExport: document.getElementById("modal-design-export"),
      btnCloseDesignExport: document.getElementById("btn-close-design-export"),
      designExportText: document.getElementById("design-export-text"),
      btnCopyDesignExport: document.getElementById("btn-copy-design-export"),
    };
  }

  /** assets/character.png が用意されていなくてもレイアウトが壊れないようにする */
  _bindCharacterFallback() {
    document.querySelectorAll(".character-img").forEach(img => {
      img.addEventListener("error", () => { img.style.display = "none"; }, { once: true });
    });
  }

  _bindStaticEvents() {
    const d = this.dom;

    // ---- home ----
    d.btnGotoStage.addEventListener("click", () => this.router.goto("stage-select"));
    d.btnGotoRules.addEventListener("click", () => d.modalRules.classList.remove("hidden"));
    d.btnCloseRules.addEventListener("click", () => d.modalRules.classList.add("hidden"));
    d.modalRules.addEventListener("click", e => { if (e.target === d.modalRules) d.modalRules.classList.add("hidden"); });

    // ---- stage-select ----
    d.btnStageBack.addEventListener("click", () => this.router.goto("home"));

    // ---- explanation ----
    d.btnExplanationSkip.addEventListener("click", () => this.router.goto("design"));
    d.btnExplanationNext.addEventListener("click", () => this.router.goto("design"));

    // ---- tutorial modal(共通) ----
    d.btnCloseTutorial.addEventListener("click", () => d.modalTutorial.classList.add("hidden"));
    d.modalTutorial.addEventListener("click", e => { if (e.target === d.modalTutorial) d.modalTutorial.classList.add("hidden"); });

    // ---- design: 部品タブ ----
    d.partSelector.querySelectorAll(".part-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        if (e.target.closest(".part-help-icon")) return;
        d.partSelector.querySelectorAll(".part-btn").forEach(b => { b.classList.remove("active"); b.setAttribute("aria-selected", "false"); });
        btn.classList.add("active");
        btn.setAttribute("aria-selected", "true");
        this.selectedPart = btn.dataset.part;
        if (typeof UI !== "undefined") UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, (structural) => this._onRocketChanged(structural));
        if (typeof UI !== "undefined") UI.hideHelpBubble();
      });
    });
    d.partSelector.querySelectorAll(".part-help-icon").forEach(icon => {
      icon.addEventListener("click", (e) => {
        e.stopPropagation();
        const part = icon.dataset.help;
        if (this._activeHelpIcon === icon && !d.helpBubble.classList.contains("hidden")) {
          UI.hideHelpBubble(); this._activeHelpIcon = null;
        } else {
          UI.showHelpBubble(part, icon); this._activeHelpIcon = icon;
        }
      });
    });
    d.btnHelpToggle.addEventListener("click", () => {
      this._helpMode = !this._helpMode;
      d.partSelector.classList.toggle("help-mode", this._helpMode);
      d.btnHelpToggle.classList.toggle("active", this._helpMode);
      if (!this._helpMode) UI.hideHelpBubble();
    });
    d.btnCloseHelpBubble.addEventListener("click", () => UI.hideHelpBubble());
    d.btnDesignBack.addEventListener("click", () => this.router.goto("stage-select"));
    d.btnGotoLaunch.addEventListener("click", () => this.router.goto("launch-prep"));
    d.rocket2DCanvas.addEventListener("click", (e) => this._handleDesignPreviewClick(e));
    d.btnZoomIn.addEventListener("click", () => { this._designZoom = Math.min(3, (this._designZoom || 1) + 0.2); this._redrawDesignPreview(); });
    d.btnZoomOut.addEventListener("click", () => { this._designZoom = Math.max(0.4, (this._designZoom || 1) - 0.2); this._redrawDesignPreview(); });

    // ---- design: 保存/比較 ----
    d.btnDesignsManager.addEventListener("click", () => this._openDesignsModal());
    d.btnCloseDesigns.addEventListener("click", () => d.modalDesigns.classList.add("hidden"));
    d.modalDesigns.addEventListener("click", e => { if (e.target === d.modalDesigns) d.modalDesigns.classList.add("hidden"); });
    d.btnSaveDesign.addEventListener("click", () => {
      DesignStorage.add(d.designNameInput.value.trim(), this.rocket, this.stage);
      d.designNameInput.value = "";
      this._refreshDesignsList();
    });

    // ---- launch-prep ----
    d.btnLaunchBack.addEventListener("click", () => this.router.goto("design"));
    d.angleSlider.addEventListener("input", () => {
      this.launchAngle = parseFloat(d.angleSlider.value);
      d.angleValue.textContent = `${this.launchAngle}°`;
    });
    d.launchBtn.addEventListener("click", () => this.router.goto("flight"));

    // ---- launch-prep: 背景設定 ----
    d.bgTimeOfDayGroup.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        d.bgTimeOfDayGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this._bgSettings.timeOfDay = btn.dataset.tod;
      });
    });
    d.bgThemeGroup.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => {
        d.bgThemeGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        this.bgScene.setTheme(btn.dataset.theme);
      });
    });
    // カスタム背景画像の読込み（機能追加要件: ローカル画像アップロード）
    d.bgImageInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        console.warn("画像ファイルではありません:", file.type);
        return;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => { this._bgSettings.customImage = img; };
        img.onerror = () => console.warn("カスタム背景画像の読み込みに失敗しました");
        img.src = ev.target.result;
      };
      reader.readAsDataURL(file);
    });
    d.bgImageClear.addEventListener("click", () => {
      this._bgSettings.customImage = null;
      d.bgImageInput.value = "";
    });

    // ---- launch-prep: 物理パラメータのカスタム調整（ステージ6限定） ----
    d.customWindMin.addEventListener("input", () => {
      const min = parseFloat(d.customWindMin.value);
      let max = parseFloat(d.customWindMax.value);
      if (min > max) { max = min; d.customWindMax.value = max; d.customWindMaxValue.textContent = max.toFixed(1); }
      d.customWindMinValue.textContent = min.toFixed(1);
      this.stage.customWindSpeedRange = [min, max];
    });
    d.customWindMax.addEventListener("input", () => {
      let min = parseFloat(d.customWindMin.value);
      const max = parseFloat(d.customWindMax.value);
      if (max < min) { min = max; d.customWindMin.value = min; d.customWindMinValue.textContent = min.toFixed(1); }
      d.customWindMaxValue.textContent = max.toFixed(1);
      this.stage.customWindSpeedRange = [min, max];
    });
    d.customGravity.addEventListener("input", () => {
      const g = parseFloat(d.customGravity.value);
      d.customGravityValue.textContent = g.toFixed(1);
      this.stage.gravityMultiplier = g;
    });

    // ---- flight: 視点/倍速/ズーム ----
    d.viewModeGroup.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => this._setViewMode(btn.dataset.view));
    });
    d.speedXGroup.querySelectorAll(".btn-toggle").forEach(btn => {
      btn.addEventListener("click", () => this._setSpeedMultiplier(parseFloat(btn.dataset.speed), btn));
    });
    d.zoomSlider.addEventListener("input", () => {
      if (!this.simState) return;
      this.simState.view.zoom = parseFloat(d.zoomSlider.value);
      d.hudZoom.textContent = `${this.simState.view.zoom.toFixed(1)}x`;
    });
    this._bindFlightPointerControls();

    // ---- result ----
    d.btnExportDesign.addEventListener("click", () => this._openDesignExport());
    d.btnCloseDesignExport.addEventListener("click", () => d.modalDesignExport.classList.add("hidden"));
    d.modalDesignExport.addEventListener("click", e => { if (e.target === d.modalDesignExport) d.modalDesignExport.classList.add("hidden"); });
    d.btnCopyDesignExport.addEventListener("click", () => {
      d.designExportText.select();
      navigator.clipboard?.writeText(d.designExportText.value).catch(() => document.execCommand("copy"));
    });
    d.btnShareResult.addEventListener("click", () => Result.shareResult(this.simState, this.rocket, this.stage, this._lastScore || 0));
    d.btnViewRanking.addEventListener("click", () => {
      if (typeof UI !== "undefined") UI.renderRanking(d.rankingList);
      d.modalRanking.classList.remove("hidden");
    });
    d.btnCloseRanking.addEventListener("click", () => d.modalRanking.classList.add("hidden"));
    d.modalRanking.addEventListener("click", e => { if (e.target === d.modalRanking) d.modalRanking.classList.add("hidden"); });
    d.btnReplay.addEventListener("click", () => this.router.goto("launch-prep")); // 同じステージ・同じ設計に再挑戦
    d.btnResultStageSelect.addEventListener("click", () => this.router.goto("stage-select"));
    d.btnRetire.addEventListener("click", () => this._retireFlight());
  }

  /* ============================================================
     ルート登録（onEnter/onExit フック）
  ============================================================ */
  _registerRoutes() {
    const r = this.router;

    r.register("home", {
      onEnter: () => {
        if (typeof UI !== "undefined" && UI.startHomeAnimation) {
          this._homeAnimStop = UI.startHomeAnimation(document.getElementById("home-bg-canvas"));
        }
      },
      onExit: () => {
        // 【修正した不具合】ホーム画面を離れる際に停止関数を呼んでいなかったため、
        // ホームへ戻るたびにアニメーションのrAFループが多重に積み重なり続ける
        // リソースリークになっていた。
        if (this._homeAnimStop) { this._homeAnimStop(); this._homeAnimStop = null; }
      }
    });

    r.register("stage-select", {
      onEnter: () => {
        if (typeof STAGES !== "undefined" && typeof UI !== "undefined") {
          UI.renderStageList(this.dom.stageList, STAGES, (stage) => this._selectStage(stage));
        }
      }
    });

    r.register("explanation", {
      onEnter: () => {
        if (typeof UI !== "undefined") {
          this.dom.explanationBody.innerHTML = UI.renderExplanationContent(this.stage) || "";
        }
      }
    });

    r.register("design", {
      onEnter: () => this._enterDesign(),
      onExit: () => {}
    });

    r.register("launch-prep", {
      onEnter: () => this._enterLaunchPrep(),
      onExit: () => this._stopWindLoop()
    });

    r.register("flight", {
      onEnter: () => this._enterFlight(),
      onExit: () => { this._stopCountdown(); this._stopFlightLoop(); }
    });

    r.register("result", {
      onEnter: () => this._enterResult()
    });
  }

  /* ============================================================
     stage-select → (explanation) → design
  ============================================================ */
  _selectStage(stage) {
    this.stage = stage;
    this.rocket = new Rocket();
    // 【修正した不具合】新規ロケットの直径が固定値(24mm)で初期化されており、
    // ステージの最小直径(例: ステージ4=65mm)を満たさない状態で設計が
    // 始まってしまっていた。ステージのminDiameterMMを新しいデフォルト値として
    // 明示的に設定する。
    const defaultDiameterM = stage.minDiameterMM / 1000;
    this.rocket.nose.diameter = defaultDiameterM;
    this.rocket.body.diameter = defaultDiameterM;
    this.selectedPart = "nose";
    document.getElementById("app").classList.toggle("difficulty-beginner", stage.difficulty === "beginner");

    if (stage.tutorial) {
      this.router.goto("explanation");
    } else {
      this.router.goto("design");
    }
  }

  /* ============================================================
     design
  ============================================================ */
  _enterDesign() {
    this.dom.designStageName.textContent = this.stage.name;
    this.dom.partSelector.querySelectorAll(".part-btn").forEach(b =>
      b.classList.toggle("active", b.dataset.part === "nose"));

    this._designZoom = this._designZoom || 1;
    if (typeof UI !== "undefined") UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, (structural) => this._onRocketChanged(structural));
    this._onRocketChanged();
    this._maybeShowTutorial("design");
  }

  /**
   * ロケットのパラメータが変更されるたびに呼ばれる。
   * ------------------------------------------------------------
   * 【修正した不具合】素材/エンジンの変更や、トランジション「使う」・
   * フィン「カスタム」選択のように入力欄の構成自体が変わる操作の直後に
   * パラメータが編集できない／表示が更新されない不具合があった。
   * 原因は、これらの操作後もパネル自体を再描画していなかったこと
   * （プレビューやデータグリッドだけ更新し、パネルのDOMは変更前のまま
   * だった）。
   * 一方で、スライダーのドラッグ中に毎回パネルを再描画すると要素が
   * 作り直されてフォーカスが失われ操作性が悪化するため、構造が変わる
   * 操作のときだけ structural=true を渡してパネルごと再描画する
   * （スライダー等の単純な値変更は false のままで軽量に保つ）。
   * @param structural true の場合、param-panel を丸ごと再描画する
   */
  _onRocketChanged(structural = false) {
    this._redrawDesignPreview();
    if (typeof UI === "undefined") return;
    if (structural) {
      UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, (s) => this._onRocketChanged(s));
    }
    UI.updateDataGrid(this.rocket, this.stage);
    UI.updatePerfBars(this.rocket);
    UI.updateBudgetIndicator(this.rocket, this.stage);
  }

  /**
   * 設計画面の2Dロケットプレビューを描画する。
   * クリック/タップ時の当たり判定で使う変換パラメータ(cx,cy,scale)を
   * this._designPreviewTransform に保存しておく。
   */
  _redrawDesignPreview() {
    const canvas = this.dom.rocket2DCanvas;
    if (!canvas || typeof UI === "undefined") return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    // 背景グリッド（視認性向上のための簡易演出）
    ctx.strokeStyle = "rgba(255,209,102,0.06)";
    ctx.lineWidth = 1;
    const step = 32 * devicePixelRatio;
    for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }

    const cx = w / 2, cy = h * 0.5;
    const scale = (h * 0.8 / Math.max(0.3, this.rocket.totalLength)) * this._designZoom;
    this._designPreviewTransform = { cx, cy, scale };
    UI.drawRocketShape(ctx, this.rocket, cx, cy, scale, 0, { showMarkers: true });
  }

  /**
   * プレビューcanvasのクリック/タップ位置から、どの部品をタップしたかを
   * 判定してタブを切り替える（機能追加要件: 部品タップでパネルを開く）。
   */
  _handleDesignPreviewClick(evt) {
    const t = this._designPreviewTransform;
    if (!t) return;
    const canvas = this.dom.rocket2DCanvas;
    const rect = canvas.getBoundingClientRect();
    const px = (evt.clientX - rect.left) * devicePixelRatio;
    const py = (evt.clientY - rect.top) * devicePixelRatio;

    // 描画時の変換 screenX = cx + xLocal*scale, screenY = cy + (yFromNose-cg)*scale の逆変換
    const xLocal = (px - t.cx) / t.scale;
    const yFromNose = (py - t.cy) / t.scale + this.rocket.cg;

    const part = this._partAtLocalPoint(xLocal, yFromNose);
    if (!part) return;
    const btn = this.dom.partSelector.querySelector(`.part-btn[data-part="${part}"]`);
    if (btn && getComputedStyle(btn).display !== "none") {
      btn.click();
    }
  }

  /** ローカル座標(xLocal, yFromNose)がどの部品の範囲に該当するかを判定する */
  _partAtLocalPoint(xLocal, yFromNose) {
    const r = this.rocket;
    const halfD = r.diameter / 2;
    if (yFromNose < 0 || yFromNose > r.totalLength) return null;
    if (yFromNose <= r.nose.length) return "nose";

    const bodyEnd = r.nose.length + r.body.length;
    if (!r.transitionEnabled) {
      // フィンは末尾に取り付くため、左右に張り出した範囲はフィン扱いにする
      return Math.abs(xLocal) > halfD + 0.005 ? "fin" : "body";
    }

    const transEnd = bodyEnd + r.transition.length;
    if (yFromNose <= bodyEnd) return Math.abs(xLocal) > halfD + 0.005 ? "fin" : "body";
    if (yFromNose <= transEnd) return "transition";
    if (Math.abs(xLocal) > r.bodyLower.diameter / 2 + 0.005) return "fin";
    return "transition"; // 下段ボディは専用タブが無いためトランジション編集へ誘導
  }

  /* ============================================================
     設計の保存・比較モーダル
  ============================================================ */
  _openDesignsModal() { this._refreshDesignsList(); this.dom.modalDesigns.classList.remove("hidden"); }

  _refreshDesignsList() {
    const list = DesignStorage.loadAll();
    UI.renderSavedDesignsList(this.dom.designsList, list, this.stage, {
      onLoad: (entry) => {
        const stage = (typeof STAGES !== "undefined" ? STAGES.find(s => s.id === entry.stageId) : null) || this.stage;
        this.stage = stage;
        this.rocket = Rocket.fromJSON(entry.rocket);
        // 別ステージ（より緩い最小直径）で保存した設計を読み込んだ場合に、
        // 現在のステージの最小直径を下回らないよう補正する
        if (!this.rocket.meetsMinDiameter(stage)) {
          const minM = stage.minDiameterMM / 1000;
          this.rocket.nose.diameter = minM;
          this.rocket.body.diameter = minM;
        }
        this.dom.modalDesigns.classList.add("hidden");
        this.dom.designStageName.textContent = stage.name;
        UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, (structural) => this._onRocketChanged(structural));
        this._onRocketChanged();
      },
      onDelete: (entry) => { DesignStorage.remove(entry.id); this._refreshDesignsList(); }
    });
  }

  /* ============================================================
     launch-prep（発射待機 + カウントダウン）
     ------------------------------------------------------------
     待機中も毎フレーム風速をランダム更新する（0.2状態契約どおり）。
  ============================================================ */
  _enterLaunchPrep() {
    this.launchAngle = 0; // 発射角度は毎回0°(真上)からスタート（スライダーで変更可能）
    this.dom.angleSlider.value = 0;
    this.dom.angleValue.textContent = "0°";

    // ステージ6限定: 風速・重力のカスタム調整UIを表示し、現在値をスライダーに同期
    const showPhysicsUI = !!this.stage.customPhysicsUnlocked;
    this.dom.physicsSettings.classList.toggle("hidden", !showPhysicsUI);
    if (showPhysicsUI) {
      const [wMin, wMax] = this.stage.customWindSpeedRange || [0, 4];
      this.dom.customWindMin.value = wMin;
      this.dom.customWindMinValue.textContent = wMin.toFixed(1);
      this.dom.customWindMax.value = wMax;
      this.dom.customWindMaxValue.textContent = wMax.toFixed(1);
      this.dom.customGravity.value = this.stage.gravityMultiplier;
      this.dom.customGravityValue.textContent = this.stage.gravityMultiplier.toFixed(1);
    }

    this.windState = Physics.createWindState(this.stage);
    this._startWindLoop();
    this._maybeShowTutorial("launch");
  }

  _startWindLoop() {
    this._stopWindLoop();
    let lastT = null;
    const tick = (t) => {
      if (lastT === null) lastT = t;
      const dt = Math.min(0.1, (t - lastT) / 1000);
      lastT = t;
      Physics.updateWind(this.windState, dt, this.stage);
      if (typeof UI !== "undefined") {
        UI.updateWindReadout(this.dom.windReadout, this.windState);
      } else {
        this.dom.windReadout.textContent = `${this.windState.speed.toFixed(1)} m/s`;
      }
      this._windLoopId = requestAnimationFrame(tick);
    };
    this._windLoopId = requestAnimationFrame(tick);
  }

  _stopWindLoop() {
    if (this._windLoopId) { cancelAnimationFrame(this._windLoopId); this._windLoopId = null; }
  }

  /**
   * flight画面に入った直後の3秒間カウントダウン。
   * ------------------------------------------------------------
   * 要件により、発射ボタンを押した時点で即座に「家やビルなどの背景がある
   * 打ち上げ画面」へ遷移し、その場でカウントダウンする（発射準備画面の
   * 上に出す従来方式から変更）。カウントダウン中も風速は更新し続け、
   * ロケットは静止した状態（t=0）のシーンを毎フレーム再描画する。
   */
  _startFlightCountdown() {
    const overlay = this.dom.countdownOverlay;
    overlay.classList.remove("hidden");
    let count = 3;
    this.dom.countdownNumber.textContent = String(count);

    const updateWindLabel = () => {
      this.dom.countdownWind.textContent =
        `${this.simState.wind.speed.toFixed(1)} m/s / ${Math.round(this.simState.wind.dir * 180 / Math.PI)}°`;
    };
    updateWindLabel();

    const idleTick = () => {
      Physics.updateWind(this.simState.wind, 1 / 30, this.stage);
      updateWindLabel();
      this._renderFlight(); // t=0のまま静止シーンを再描画（背景・発射台が見える）
      this._countdownIdleRafId = requestAnimationFrame(idleTick);
    };
    this._countdownIdleRafId = requestAnimationFrame(idleTick);

    this._countdownTimerId = setInterval(() => {
      count -= 1;
      if (count > 0) {
        this.dom.countdownNumber.textContent = String(count);
      } else {
        this._stopCountdown();
        overlay.classList.add("hidden");
        this._flightLastT = null;
        this._flightAccumulator = 0;
        this._flightRafId = requestAnimationFrame(t => this._flightLoop(t));
      }
    }, 1000);
  }

  /** カウントダウン中のタイマー/rAFを停止する（リタイアや画面離脱時の後始末） */
  _stopCountdown() {
    if (this._countdownTimerId) { clearInterval(this._countdownTimerId); this._countdownTimerId = null; }
    if (this._countdownIdleRafId) { cancelAnimationFrame(this._countdownIdleRafId); this._countdownIdleRafId = null; }
    this.dom.countdownOverlay.classList.add("hidden");
  }

  /* ============================================================
     flight
  ============================================================ */
  _enterFlight() {
    this.simState = Physics.createSimState(this.rocket, this.stage, this.launchAngle);
    this.simState.wind = this.windState; // 待機中から続く風況を引き継ぐ
    // デフォルトの視点モードを「自動追尾」に変更（要件）
    this.simState.view = { mode: "track", tx: 0, ty: 0, zoom: 1 };

    this._speedMultiplier = 1;
    this.dom.speedXGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.toggle("active", b.dataset.speed === "1"));
    this.dom.hudSpeed.textContent = "1x";
    this._setViewMode("track");
    this.dom.zoomSlider.value = 1;
    this.dom.hudZoom.textContent = "1.0x";

    this._renderFlight(); // 発射前の静止シーンを1枚描画してから
    this._startFlightCountdown(); // カウントダウンを開始する
  }

  _stopFlightLoop() {
    if (this._flightRafId) { cancelAnimationFrame(this._flightRafId); this._flightRafId = null; }
  }

  /** 「リタイア」ボタン: 飛行を強制終了し、その時点の記録でリザルトへ */
  _retireFlight() {
    if (!this.simState || this.simState.landed) return;
    this._stopCountdown(); // カウントダウン中のリタイアにも対応
    this._stopFlightLoop();
    this.simState.landed = true;
    this.simState.retired = true; // result.jsが「リタイア」表示に使う
    this.router.goto("result");
  }

  /**
   * fixed-timestep(1/60s)のメインループ。
   * ------------------------------------------------------------
   * 【修正した不具合】4x/8x倍速が実質的に効いていなかった原因は、
   * catch-up（1フレームで処理できる物理ステップ数）の上限が常に2で
   * 固定されていたこと。8倍速では毎フレーム約8ステップ分の蓄積時間が
   * 必要になるが、上限2を超えた分は「フレーム落ち対策」としてまるごと
   * 捨てられてしまい、結果的に2x程度の速度でしか進まなかった。
   * 倍率に応じて上限を可変にし、意図した速度分はきちんと処理したうえで、
   * それでも追いつかない場合（実際のフレーム落ち）だけ切り捨てるように
   * 修正した。
   */
  _flightLoop(t) {
    const FIXED_DT = 1 / 60;
    if (this._flightLastT === null) this._flightLastT = t;
    let frameDelta = (t - this._flightLastT) / 1000;
    this._flightLastT = t;
    frameDelta = Math.min(frameDelta, 0.25);
    this._flightAccumulator += frameDelta * this._speedMultiplier;

    // 倍率分のステップ+αの余裕を持たせた上限（最低2は確保）
    const maxSteps = Math.max(2, Math.ceil(this._speedMultiplier * 3));

    let steps = 0;
    while (this._flightAccumulator >= FIXED_DT && steps < maxSteps) {
      Physics.updateWind(this.simState.wind, FIXED_DT, this.stage);
      Physics.step(this.simState, this.rocket, this.stage, FIXED_DT);
      this._flightAccumulator -= FIXED_DT;
      steps++;
    }
    // 本当に上限に達した場合（実機の性能不足等）のみ残余を切り捨てる
    if (steps >= maxSteps && this._flightAccumulator > FIXED_DT) this._flightAccumulator = 0;

    this._renderFlight();
    if (typeof UI !== "undefined") UI.updateTelemetryHUD(this.simState);

    if (this.simState.landed) {
      this._flightRafId = null;
      setTimeout(() => this.router.goto("result"), 400);
      return;
    }
    this._flightRafId = requestAnimationFrame(tt => this._flightLoop(tt));
  }

  /** 視点モードに応じてカメラ(simState.view)を更新しつつ3層canvasへ描画する */
  _renderFlight() {
    const { bgCanvas, rocketCanvas, overlayCanvas } = this.dom;
    const w = bgCanvas.width = rocketCanvas.width = overlayCanvas.width = bgCanvas.clientWidth * devicePixelRatio;
    const h = bgCanvas.height = rocketCanvas.height = overlayCanvas.height = bgCanvas.clientHeight * devicePixelRatio;
    const sim = this.simState;
    const view = sim.view;

    // ---- カメラ位置決定 ----
    let camX, camY, zoom;
    if (view.mode === "free") {
      camX = view.tx; camY = view.ty; zoom = view.zoom;
    } else if (view.mode === "track") {
      camX = sim.x; camY = sim.y; zoom = view.zoom;
    } else { // fixed: 発射台を中心に固定
      camX = 0; camY = Math.max(0, sim.y - 40); zoom = view.zoom;
    }
    const scale = Math.max(0.5, Math.min(220, 6 * zoom)) * devicePixelRatio; // ズーム上限拡大(旧40→220)
    // ロケットが画面下寄りになりすぎないよう、track/free時は画面中央(0.5)、
    // fixed(発射台固定)時のみ離陸の様子が見やすい0.72を使う
    const anchorY = view.mode === "fixed" ? 0.72 : 0.5;
    const groundScreenY = h * anchorY - (0 - camY) * scale;

    // ---- bgレイヤー ----
    // カスタム背景画像が設定されていればそれを優先し（cover表示）、
    // なければ従来どおり手続き的な空グラデーション+BackgroundSceneを描画する。
    const bgCtx = bgCanvas.getContext("2d");
    const customImg = this._bgSettings.customImage;
    if (customImg) {
      const imgRatio = customImg.width / customImg.height;
      const canvasRatio = w / h;
      let dw, dh, dx, dy;
      if (imgRatio > canvasRatio) { dh = h; dw = h * imgRatio; dx = (w - dw) / 2; dy = 0; }
      else { dw = w; dh = w / imgRatio; dx = 0; dy = (h - dh) / 2; }
      bgCtx.drawImage(customImg, dx, dy, dw, dh);
      // 夜モードなら暗くオーバーレイして時間帯を反映
      if (this._bgSettings.timeOfDay === "night") {
        bgCtx.fillStyle = "rgba(3,4,15,0.55)";
        bgCtx.fillRect(0, 0, w, h);
      }
    } else {
      const isNight = this._bgSettings.timeOfDay === "night";
      const skyT = Math.min(1, Math.max(0, sim.y / 1000));
      // 昼: 明るい青空 → 宇宙色 / 夜: 暗紺 → 宇宙色（昼夜切替機能）
      const baseSky = isNight ? [8, 12, 28] : [90, 160, 224];
      const top = baseSky.map((c, i) => Math.round(c + ([3, 4, 12][i] - c) * skyT));
      const grad = bgCtx.createLinearGradient(0, 0, 0, h);
      grad.addColorStop(0, `rgb(${top.join(",")})`);
      grad.addColorStop(1, isNight ? "rgb(6,10,20)" : "rgb(10,18,32)");
      bgCtx.fillStyle = grad; bgCtx.fillRect(0, 0, w, h);

      // 夜は低高度でも星を薄く見せる
      if (isNight && skyT < 0.3) {
        bgCtx.fillStyle = "rgba(255,255,255,0.35)";
        for (let i = 0; i < 30; i++) {
          const sx = (i * 173.2) % w, sy = (i * 91.7) % (h * 0.6);
          bgCtx.fillRect(sx, sy, 1.4 * devicePixelRatio, 1.4 * devicePixelRatio);
        }
      }
      this.bgScene.draw(bgCtx, w, h, camX, groundScreenY, scale);
    }
    if (groundScreenY < h + 20) {
      bgCtx.fillStyle = this._bgSettings.timeOfDay === "night" ? "#050a12" : "#0a1220";
      bgCtx.fillRect(0, groundScreenY, w, h - groundScreenY);
    }
    // 着地ゾーンのガイド（発射台からの許容半径を地面に色付け表示）
    if (this.stage.landingZoneRadius) {
      const radius = this.stage.landingZoneRadius;
      const padX = w / 2 + (0 - camX) * scale;
      const zoneLeft = padX - radius * scale;
      const zoneWidth = radius * 2 * scale;
      bgCtx.fillStyle = "rgba(255,209,102,0.22)";
      bgCtx.fillRect(zoneLeft, groundScreenY - 4 * devicePixelRatio, zoneWidth, 8 * devicePixelRatio);
      bgCtx.strokeStyle = "rgba(255,209,102,0.9)";
      bgCtx.lineWidth = 2 * devicePixelRatio;
      bgCtx.strokeRect(zoneLeft, groundScreenY - 4 * devicePixelRatio, zoneWidth, 8 * devicePixelRatio);
    }

    // ---- rocketレイヤー ----
    const rCtx = rocketCanvas.getContext("2d");
    rCtx.clearRect(0, 0, w, h);
    const rx = w / 2 + (sim.x - camX) * scale;
    const ry = h * anchorY - (sim.y - camY) * scale;
    if (typeof UI !== "undefined") {
      UI.drawRocketShape(rCtx, this.rocket, rx, ry, scale, Math.atan2(sim.vx, Math.max(0.01, sim.vy)), {
        flame: sim.burning, parachuteOpen: sim.parachuteDeployed
      });
    }

    // ---- overlayレイヤー（風矢印は専用SVGなのでcanvas側はHUD用途のみ） ----
    const oCtx = overlayCanvas.getContext("2d");
    oCtx.clearRect(0, 0, w, h);

    // 高度目標のガイド線（黄色の破線 + ラベル）
    const altitudeTargets = this.stage.altitudeThresholds || [];
    (this.stage.altitudeBands || []).forEach(band => altitudeTargets.push(band[0], band[1]));
    altitudeTargets.forEach(targetY => {
      const lineScreenY = h * anchorY - (targetY - camY) * scale;
      if (lineScreenY < -20 || lineScreenY > h + 20) return; // 画面外は描かない
      oCtx.save();
      oCtx.strokeStyle = "rgba(255,209,102,0.85)";
      oCtx.lineWidth = 2 * devicePixelRatio;
      oCtx.setLineDash([10 * devicePixelRatio, 8 * devicePixelRatio]);
      oCtx.beginPath();
      oCtx.moveTo(0, lineScreenY);
      oCtx.lineTo(w, lineScreenY);
      oCtx.stroke();
      oCtx.setLineDash([]);
      oCtx.fillStyle = "rgba(255,209,102,0.95)";
      oCtx.font = `${12 * devicePixelRatio}px 'Share Tech Mono', monospace`;
      oCtx.fillText(`目標高度 ${targetY.toFixed(0)}m`, 10 * devicePixelRatio, lineScreenY - 6 * devicePixelRatio);
      oCtx.restore();
    });

    // 風向矢印(SVG)・風速表示・HUDバッジをDOM側で更新
    if (typeof UI !== "undefined") UI.updateWindArrowSVG(this.dom.windArrowFlight, sim.wind);
    this.dom.hudZoom.textContent = `${zoom.toFixed(1)}x`;
  }

  _setViewMode(mode) {
    this.dom.viewModeGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.toggle("active", b.dataset.view === mode));
    document.body.classList.toggle("view-free", mode === "free");
    if (this.simState) this.simState.view.mode = mode;
  }

  _setSpeedMultiplier(value, btn) {
    this._speedMultiplier = value;
    this.dom.speedXGroup.querySelectorAll(".btn-toggle").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    this.dom.hudSpeed.textContent = `${value}x`;
  }

  /** 自由視点モードでのドラッグ=パン、ホイール/ピンチ=ズーム操作 */
  _bindFlightPointerControls() {
    const el = this.dom.overlayCanvas;

    el.addEventListener("pointerdown", (e) => {
      if (!this.simState || this.simState.view.mode !== "free") return;
      this._dragState = { startX: e.clientX, startY: e.clientY, tx: this.simState.view.tx, ty: this.simState.view.ty };
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", (e) => {
      if (!this._dragState || !this.simState) return;
      const scale = Math.max(0.5, Math.min(220, 6 * this.simState.view.zoom));
      const dx = (e.clientX - this._dragState.startX) / scale;
      const dy = (e.clientY - this._dragState.startY) / scale;
      this.simState.view.tx = this._dragState.tx - dx;
      this.simState.view.ty = this._dragState.ty + dy;
    });
    ["pointerup", "pointercancel"].forEach(ev => el.addEventListener(ev, () => { this._dragState = null; }));

    // ホイールズーム（自由/自動追尾どちらでも操作可）
    el.addEventListener("wheel", (e) => {
      if (!this.simState) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const z = Math.max(0.1, Math.min(40, this.simState.view.zoom * factor));
      this.simState.view.zoom = z;
      this.dom.zoomSlider.value = z;
    }, { passive: false });

    // ピンチズーム（タッチ2本指）
    el.addEventListener("touchmove", (e) => {
      if (!this.simState || e.touches.length !== 2) return;
      e.preventDefault();
      const [t1, t2] = e.touches;
      const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
      if (this._pinchState) {
        const factor = dist / this._pinchState.dist;
        const z = Math.max(0.1, Math.min(40, this._pinchState.zoom * factor));
        this.simState.view.zoom = z;
        this.dom.zoomSlider.value = z;
      } else {
        this._pinchState = { dist, zoom: this.simState.view.zoom };
      }
    }, { passive: false });
    el.addEventListener("touchend", () => { this._pinchState = null; });
  }

  /* ============================================================
     result
  ============================================================ */
  _enterResult() {
    if (typeof Result === "undefined") return;
    const { cleared, score } = Result.render(this.simState, this.rocket, this.stage);
    this._lastScore = score;
    const badge = this.dom.resultClearBadge;
    // cleared: true=クリア / false=未達成 / null=クリア目標なし(フリープレイ)
    // simState.retired=true の場合はリタイアによる強制終了を明示する
    if (this.simState.retired) {
      badge.textContent = "RETIRED";
      badge.classList.remove("clear", "freeplay");
      badge.classList.add("failed");
    } else if (cleared === null) {
      badge.textContent = "FREE PLAY";
      badge.classList.remove("clear", "failed");
      badge.classList.add("freeplay");
    } else {
      badge.textContent = cleared ? "CLEAR" : "FAILED";
      badge.classList.toggle("clear", cleared);
      badge.classList.toggle("failed", !cleared);
      badge.classList.remove("freeplay");
    }
  }

  _openDesignExport() {
    this.dom.designExportText.value = Result.exportDesignText(this.rocket, this.stage);
    this.dom.modalDesignExport.classList.remove("hidden");
  }

  /* ============================================================
     チュートリアルダイアログ（初心者ステージ、各工程入口）
  ============================================================ */
  _maybeShowTutorial(phase) {
    if (!this.stage || !this.stage.tutorial || typeof UI === "undefined") return;
    const content = UI.renderTutorialContent(this.stage, phase);
    if (!content) return;
    this.dom.tutorialTitle.textContent = phase === "design" ? "設計のすすめかた" : "発射のすすめかた";
    this.dom.tutorialBody.innerHTML = content;
    this.dom.modalTutorial.classList.remove("hidden");
  }

  /* ============================================================
     リサイズ
  ============================================================ */
  _onResize() {
    // 3D/flightキャンバスはループ内・ResizeObserverで随時サイズを取り直すため、
    // ここでは特別な処理は不要（将来的な追加拠点として残す）。
  }
}

/* ============================================================
   エントリポイント
============================================================ */
const Game = new GameManager();
window.addEventListener("DOMContentLoaded", () => Game.init());
