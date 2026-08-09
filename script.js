/*
  ファイル名: script.js
  依存関係: index.html（全DOM要素） / physics.js（Physics, Simulation系API）/
            rocket.js（Rocket, Engine, Rocket3DView経由の3D表示）/
            stage.js（STAGES配列）/ ui.js（UI.*）/ result.js（Result.*）
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
                   burning, parachuteDeployed, landed,
                   maxAltitude, maxDistance }
    Physics.step(simState, rocket, stage, dt)      : void（fixed-timestep 1step分だけ進める）
    Physics.FlightRecorder                         : class
      new Physics.FlightRecorder(capacitySeconds, hz) … Float32Arrayリングバッファ
      .record(simState)                            : void
      .toArrays()                                  : { t, x, y, vx, vy, ax, ay }（CSV出力用）

  ---- 契約: rocket.js ----
    class Rocket {
      parts: [RocketPart]  // {type,x_ref,length,diameter,mass,color?,pattern?,finParams?}
      cg, cp, totalMass, diameter_mm  // getter
      totalPrice, totalStrength, strengthStars, lightnessLevel
      cnAlpha, cd0, referenceArea, totalLength
      toJSON() / static fromJSON(data)
    }
    class Engine { ... }  // 既存仕様を踏襲
    window.Rocket3DView  // rocket3d.js が提供する3Dビュー（変更なし）

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
    Result.render(simState, rocket, stage, flightRecorder) : { cleared: boolean, score: number }
    Result.exportDesignText(rocket, stage) : string
    Result.downloadCSV(flightRecorder)     : void（ブラウザにダウンロードさせる）
    Result.shareResult(simState, stage, score) : Promise<void>
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
    this.objects = []; // { kind, worldX, groundY, scale, cacheCanvas }
    this._cache = {};  // kind -> offscreen canvas
    this._built = false;
  }

  /** 実寸大スケール比較用オブジェクト群を1度だけ生成し、オフスクリーンにキャッシュする */
  build() {
    if (this._built) return;
    this._cache.person   = this._bakePerson();
    this._cache.house    = this._bakeHouse();
    this._cache.building = this._bakeBuilding();
    this._cache.pole     = this._bakePole();

    // ワールド座標(x=横位置[m], kind)をランダム配置。以後は座標だけ参照する。
    const kinds = ["person", "house", "building", "pole"];
    for (let i = 0; i < 40; i++) {
      const kind = kinds[Math.floor(Math.random() * kinds.length)];
      this.objects.push({
        kind,
        worldX: (i - 20) * (8 + Math.random() * 10), // 発射台周辺に間引き気味に分布
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
    this.flightRecorder = null;

    this._rocket3D = null;
    this._helpMode = false;
    this._activeHelpIcon = null;

    this.bgScene = new BackgroundScene();

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
      rocket3DContainer: document.getElementById("rocket-preview-3d"),
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
      btnExportCsv: document.getElementById("export-csv"),
      btnShareResult: document.getElementById("share-result"),
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
        if (typeof UI !== "undefined") UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, () => this._onRocketChanged());
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
    d.btnExportCsv.addEventListener("click", () => Result.downloadCSV(this.flightRecorder));
    d.btnShareResult.addEventListener("click", () => Result.shareResult(this.simState, this.stage, this._lastScore || 0));
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
      onEnter: () => { if (typeof UI !== "undefined") UI.startHomeAnimation?.(document.getElementById("home-bg-canvas")); }
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
      onExit: () => { if (this._rocket3D) { this._rocket3D.dispose(); this._rocket3D = null; } }
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

    if (!this._rocket3D) {
      if (window.Rocket3DView) {
        this._rocket3D = new window.Rocket3DView(this.dom.rocket3DContainer);
      } else {
        // Three.js(ESモジュール)の読み込みに失敗している。
        // 最も多い原因は index.html を file:// で直接開いていること
        // （CDNからのモジュールimportがブラウザのCORS制限でブロックされる）。
        // 空白のまま気付けないと分かりにくいため、原因を案内する。
        this.dom.rocket3DContainer.innerHTML =
          '<div class="three-fallback">3Dプレビューを読み込めませんでした。<br>' +
          'index.html を <b>file://</b> で直接開いていませんか？<br>' +
          'ローカルサーバー（例: <code>python -m http.server</code>）や ' +
          'GitHub Pages など、<b>http(s)://</b> 経由で開いてください。</div>';
        console.warn("window.Rocket3DView が未定義です。rocket3d.js(ESモジュール)の読み込みに失敗している可能性があります。http(s)://経由でindex.htmlを開いているか確認してください。");
      }
    }
    if (typeof UI !== "undefined") UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, () => this._onRocketChanged());
    this._onRocketChanged();
    this._maybeShowTutorial("design");
  }

  _onRocketChanged() {
    if (this._rocket3D) this._rocket3D.update(this.rocket);
    if (typeof UI === "undefined") return;
    UI.updateDataGrid(this.rocket, this.stage);
    UI.updatePerfBars(this.rocket);
    UI.updateBudgetIndicator(this.rocket, this.stage);
  }

  _openDesignsModal() { this._refreshDesignsList(); this.dom.modalDesigns.classList.remove("hidden"); }

  _refreshDesignsList() {
    const list = DesignStorage.loadAll();
    UI.renderSavedDesignsList(this.dom.designsList, list, this.stage, {
      onLoad: (entry) => {
        const stage = (typeof STAGES !== "undefined" ? STAGES.find(s => s.id === entry.stageId) : null) || this.stage;
        this.stage = stage;
        this.rocket = Rocket.fromJSON(entry.rocket);
        this.dom.modalDesigns.classList.add("hidden");
        this.dom.designStageName.textContent = stage.name;
        UI.renderPartPanel(this.selectedPart, this.rocket, this.stage, () => this._onRocketChanged());
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
    this.launchAngle = 0; // 角度UIは非表示のため常に0（真上）固定
    this.dom.angleSlider.value = 0;
    this.dom.angleValue.textContent = "0°";

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
    this.flightRecorder = new Physics.FlightRecorder(180, 30); // 最大180秒, 30Hz記録

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
   * fixed-timestep(1/60s) + catch-up上限2回のメインループ（0.3準拠）。
   * speed-x倍率は「シミュレーション時間の進み方」を加速させる形で反映する
   * （物理刻み幅そのものは変えず、1フレームに進めるstep数を増やす）。
   */
  _flightLoop(t) {
    const FIXED_DT = 1 / 60;
    if (this._flightLastT === null) this._flightLastT = t;
    let frameDelta = (t - this._flightLastT) / 1000;
    this._flightLastT = t;
    frameDelta = Math.min(frameDelta, 0.25);
    this._flightAccumulator += frameDelta * this._speedMultiplier;

    let steps = 0;
    while (this._flightAccumulator >= FIXED_DT && steps < 2) {
      Physics.updateWind(this.simState.wind, FIXED_DT, this.stage);
      Physics.step(this.simState, this.rocket, this.stage, FIXED_DT);
      this.flightRecorder.record(this.simState);
      this._flightAccumulator -= FIXED_DT;
      steps++;
    }
    // catch-up上限に達した場合は残余を切り捨て、デススパイラルを防ぐ
    if (steps >= 2 && this._flightAccumulator > FIXED_DT) this._flightAccumulator = 0;

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
    const scale = Math.max(0.5, Math.min(40, 6 * zoom)) * devicePixelRatio;
    // ロケットが画面下寄りになりすぎないよう、track/free時は画面中央(0.5)、
    // fixed(発射台固定)時のみ離陸の様子が見やすい0.72を使う
    const anchorY = view.mode === "fixed" ? 0.72 : 0.5;
    const groundScreenY = h * anchorY - (0 - camY) * scale;

    // ---- bgレイヤー ----
    const bgCtx = bgCanvas.getContext("2d");
    const skyT = Math.min(1, Math.max(0, sim.y / 1000));
    const top = [11, 48, 80].map((c, i) => Math.round(c + ([3, 4, 12][i] - c) * skyT));
    const grad = bgCtx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgb(${top.join(",")})`);
    grad.addColorStop(1, "rgb(10,18,32)");
    bgCtx.fillStyle = grad; bgCtx.fillRect(0, 0, w, h);
    this.bgScene.draw(bgCtx, w, h, camX, groundScreenY, scale);
    if (groundScreenY < h + 20) {
      bgCtx.fillStyle = "#0a1220";
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
      const scale = Math.max(0.5, Math.min(40, 6 * this.simState.view.zoom));
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
      const z = Math.max(0.1, Math.min(20, this.simState.view.zoom * factor));
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
        const z = Math.max(0.1, Math.min(20, this._pinchState.zoom * factor));
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
    const { cleared, score } = Result.render(this.simState, this.rocket, this.stage, this.flightRecorder);
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
