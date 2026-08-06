/* ============================================================
   ROCKET FORGE - ui.js
   ------------------------------------------------------------
   汎用UI部品（スライダー・チップ選択・素材テーブル）と、
   ロケット形状のCanvas描画、各画面（ホーム/ステージ/設計/発射準備）
   のDOM生成ロジックをまとめたクラス。
   状態は持たず、「DOM/Canvasへの描画」だけを担当する
   （データの持ち主はRocket/Stage/Simulation側）。
============================================================ */

class UI {

  /* ============================================================
     汎用ウィジェット
  ============================================================ */

  /**
   * スライダー（ラベル + 現在値表示 + range入力）を生成する。
   * @param {object} opt {label, min, max, step, value, unit, format, onInput}
   * @returns {HTMLElement}
   */
  static createSlider(opt) {
    const { label, min, max, step = 1, value, unit = "", format, onInput } = opt;
    const wrap = document.createElement("div");
    wrap.className = "field-group";

    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    const valSpan = document.createElement("span");
    valSpan.className = "field-val";
    const fmt = (v) => (format ? format(v) : `${v}${unit}`);
    valSpan.textContent = fmt(value);
    labelEl.innerHTML = `<span>${label}</span>`;
    labelEl.appendChild(valSpan);

    const input = document.createElement("input");
    input.type = "range";
    input.min = min; input.max = max; input.step = step; input.value = value;

    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      valSpan.textContent = fmt(v);
      onInput(v);
    });

    wrap.appendChild(labelEl);
    wrap.appendChild(input);
    return wrap;
  }

  /**
   * チップ（選択式ボタン群）を生成する。単一選択。
   * @param {object} opt {label, options: [{value,text}], active, onSelect}
   */
  static createChipRow(opt) {
    const { label, options, active, onSelect } = opt;
    const wrap = document.createElement("div");
    wrap.className = "field-group";

    if (label) {
      const labelEl = document.createElement("div");
      labelEl.className = "field-label";
      labelEl.innerHTML = `<span>${label}</span>`;
      wrap.appendChild(labelEl);
    }

    const row = document.createElement("div");
    row.className = "select-chip-row";
    options.forEach(o => {
      const chip = document.createElement("button");
      chip.className = "select-chip" + (o.value === active ? " active" : "");
      chip.textContent = o.text;
      chip.addEventListener("click", () => {
        row.querySelectorAll(".select-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        onSelect(o.value);
      });
      row.appendChild(chip);
    });
    wrap.appendChild(row);
    return wrap;
  }

  /**
   * 素材選択テーブルを生成する（重さ/強度/価格を比較しながら選べる）。
   * @param {object} opt {partType, active, onSelect}
   */
  static createMaterialTable(opt) {
    const { partType, active, onSelect } = opt;
    const materials = MaterialDB.getForPart(partType);

    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.innerHTML = "<span>素材</span>";
    wrap.appendChild(labelEl);

    const table = document.createElement("table");
    table.className = "material-table";
    table.innerHTML = `
      <thead><tr><th>素材</th><th>重さ</th><th>強度</th><th>価格</th></tr></thead>
      <tbody></tbody>
    `;
    const tbody = table.querySelector("tbody");
    materials.forEach(m => {
      const tr = document.createElement("tr");
      tr.className = m.name === active ? "active" : "";
      tr.innerHTML = `<td>${m.name}</td><td>${m.weight}</td><td>${m.strength}</td><td>${m.price}</td>`;
      tr.addEventListener("click", () => {
        tbody.querySelectorAll("tr").forEach(r => r.classList.remove("active"));
        tr.classList.add("active");
        onSelect(m.name);
      });
      tbody.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }

  /* ============================================================
     ルール説明モーダル
  ============================================================ */
  static renderRulesContent() {
    return `
      <h3>ゲームの流れ</h3>
      <p>ホーム → ステージ選択 → 設計 → 発射準備 → シミュレーション → リザルト の順に進みます。</p>
      <h3>設計画面</h3>
      <p>ノーズ・ボディ・フィン・パラシュート・おもり・エンジンの6パーツを編集できます。左側にロケット形状がリアルタイムで表示され、右側のパネルでパラメータを調整します。</p>
      <h3>安定性について</h3>
      <p>下部の「安定性」はStatic Margin（口径単位）です。おおよそ1〜2口径が安全な範囲。0以下だと不安定、極端に大きいと風に弱くなります。</p>
      <h3>予算</h3>
      <p>ステージごとに予算が決まっています。超過すると価格表示が赤くなりますが、打ち上げ自体は可能です。</p>
      <h3>スコア</h3>
      <p>スコア = 最高高度 + 到達距離 + 滞空時間×4 で計算されます。</p>
    `;
  }

  /* ============================================================
     ステージ選択画面
  ============================================================ */
  static renderStageList(containerEl, stages, onSelect) {
    containerEl.innerHTML = "";
    stages.forEach((stage, i) => {
      const card = document.createElement("div");
      card.className = "hud-panel stage-card";
      card.innerHTML = `
        <div class="stage-num">STAGE ${String(i + 1).padStart(2, "0")}</div>
        <div class="stage-name">${stage.name}</div>
        <div class="stage-stat"><span>風況</span><span>${stage.windLabel}</span></div>
        <div class="stage-stat"><span>予算</span><span>${stage.budgetLabel}</span></div>
        <div class="stage-stat"><span>重力</span><span>${stage.gravityLabel}</span></div>
        <div class="stage-stat"><span>説明</span></div>
        <p style="font-size:0.78rem; color:var(--text-mute); margin-top:6px;">${stage.description}</p>
      `;
      card.addEventListener("click", () => onSelect(stage));
      containerEl.appendChild(card);
    });
  }

  /* ============================================================
     設計画面: パラメータパネル
  ============================================================ */
  static renderPartPanel(partType, rocket, onUpdate) {
    const panel = document.getElementById("param-panel");
    panel.innerHTML = "";

    const add = (el) => panel.appendChild(el);

    switch (partType) {
      case "nose": {
        add(UI.createSlider({
          label: "長さ", min: 5, max: 30, step: 0.5, value: rocket.nose.length * 100, unit: "cm",
          onInput: v => { rocket.nose.length = v / 100; onUpdate(); }
        }));
        add(UI.createSlider({
          label: "太さ（直径）", min: 1.5, max: 6, step: 0.1, value: rocket.nose.diameter * 100, unit: "cm",
          onInput: v => { rocket.nose.diameter = v / 100; rocket.body.diameter = v / 100; onUpdate(); }
        }));
        add(UI.createChipRow({
          label: "形状", active: rocket.nose.shape,
          options: Object.keys(NOSE_SHAPES).map(k => ({ value: k, text: k })),
          onSelect: v => { rocket.nose.shape = v; onUpdate(); }
        }));
        add(UI.createMaterialTable({
          partType: "nose", active: rocket.nose.material,
          onSelect: v => { rocket.nose.material = v; onUpdate(); }
        }));
        break;
      }
      case "body": {
        add(UI.createSlider({
          label: "長さ", min: 10, max: 60, step: 0.5, value: rocket.body.length * 100, unit: "cm",
          onInput: v => { rocket.body.length = v / 100; onUpdate(); }
        }));
        add(UI.createMaterialTable({
          partType: "body", active: rocket.body.material,
          onSelect: v => { rocket.body.material = v; onUpdate(); }
        }));
        break;
      }
      case "fin": {
        add(UI.createSlider({
          label: "枚数", min: 3, max: 6, step: 1, value: rocket.fins.count, unit: "枚",
          onInput: v => { rocket.fins.count = Math.round(v); onUpdate(); }
        }));
        add(UI.createChipRow({
          label: "形状", active: rocket.fins.shape,
          options: Object.keys(FIN_SHAPES).map(k => ({ value: k, text: k })),
          onSelect: v => { rocket.fins.shape = v; onUpdate(); }
        }));
        add(UI.createChipRow({
          label: "断面形状", active: rocket.fins.section,
          options: Object.keys(FIN_SECTIONS).map(k => ({ value: k, text: k })),
          onSelect: v => { rocket.fins.section = v; onUpdate(); }
        }));
        add(UI.createMaterialTable({
          partType: "fin", active: rocket.fins.material,
          onSelect: v => { rocket.fins.material = v; onUpdate(); }
        }));
        break;
      }
      case "parachute": {
        add(UI.createSlider({
          label: "直径", min: 10, max: 80, step: 1, value: rocket.parachute.diameter * 100, unit: "cm",
          onInput: v => { rocket.parachute.diameter = v / 100; onUpdate(); }
        }));
        break;
      }
      case "weight": {
        add(UI.createSlider({
          label: "重さ", min: 0, max: 50, step: 1, value: rocket.weight.mass * 1000, unit: "g",
          onInput: v => { rocket.weight.mass = v / 1000; onUpdate(); }
        }));
        add(UI.createSlider({
          label: "位置（先端から）", min: 0, max: Math.round(rocket.totalLength * 100), step: 0.5,
          value: rocket.weight.position * 100, unit: "cm",
          onInput: v => { rocket.weight.position = v / 100; onUpdate(); }
        }));
        break;
      }
      case "engine": {
        add(UI.createChipRow({
          label: "エンジン選択", active: rocket.engine.code,
          options: EngineDB.codes.map(c => ({ value: c, text: c })),
          onSelect: v => { rocket.engine = new Engine(v); onUpdate(); }
        }));
        const info = document.createElement("div");
        info.className = "field-group";
        info.innerHTML = `
          <div class="field-label"><span>全力積</span><span class="field-val">${rocket.engine.totalImpulse} Ns</span></div>
          <div class="field-label"><span>平均推力</span><span class="field-val">${rocket.engine.avgThrust} N</span></div>
          <div class="field-label"><span>展開遅延</span><span class="field-val">${rocket.engine.delay} s</span></div>
        `;
        add(info);
        break;
      }
    }
  }

  /* ============================================================
     設計画面: 下部データグリッド
  ============================================================ */
  static updateDataGrid(rocket, stage) {
    const grid = document.getElementById("data-grid");
    const overBudget = stage.isOverBudget(rocket);
    const cells = [
      { label: "総質量", value: `${(rocket.totalMass * 1000).toFixed(1)} g` },
      { label: "全長", value: `${(rocket.totalLength * 100).toFixed(1)} cm` },
      { label: "重心 (CG)", value: `${(rocket.centerOfGravity * 100).toFixed(1)} cm` },
      { label: "圧力中心 (CP)", value: `${(rocket.centerOfPressure * 100).toFixed(1)} cm` },
      { label: "Cnα", value: rocket.cnAlpha.toFixed(2) },
      { label: "価格", value: `¥${rocket.totalPrice.toLocaleString()}`, warnClass: overBudget ? "danger" : "" }
    ];
    grid.innerHTML = cells.map(c => `
      <div class="data-cell ${c.warnClass || ""}">
        <span class="data-label">${c.label}</span>
        <span class="data-value">${c.value}</span>
      </div>
    `).join("");
  }

  /* ============================================================
     設計画面: 性能バー（軽さ・強度・安定性）
  ============================================================ */
  static updatePerfBars(rocket) {
    const fillBar = (id, level) => {
      const bar = document.getElementById(id);
      bar.innerHTML = "";
      for (let i = 1; i <= 8; i++) {
        const seg = document.createElement("div");
        seg.className = "seg" + (i <= level ? " filled" : "");
        bar.appendChild(seg);
      }
    };
    fillBar("perf-bar-light", rocket.lightnessLevel);
    fillBar("perf-bar-strength", rocket.strengthLevel);

    const marginEl = document.getElementById("perf-stability");
    const margin = rocket.staticMargin;
    marginEl.textContent = `${margin.toFixed(2)} cal`;
    // 安定性の色分け: 1〜2口径が理想、範囲外は警告色
    if (margin < 0.5 || margin > 3) {
      marginEl.style.color = "var(--danger)";
    } else if (margin < 1) {
      marginEl.style.color = "var(--warn)";
    } else {
      marginEl.style.color = "var(--success)";
    }
  }

  /* ============================================================
     設計画面: 予算インジケーター
  ============================================================ */
  static updateBudgetIndicator(rocket, stage) {
    const el = document.getElementById("budget-value");
    el.textContent = `¥${rocket.totalPrice.toLocaleString()} / ¥${stage.budget.toLocaleString()}`;
    el.classList.toggle("over", stage.isOverBudget(rocket));
  }

  /* ============================================================
     ロケット形状描画（design/launch/sim/result 共通で使う中核関数）
     ------------------------------------------------------------
     CGを回転の中心として描画するため、傾いたロケットも自然に見える。
     @param ctx Canvas2Dコンテキスト
     @param rocket Rocketインスタンス
     @param cx, cy 描画中心（Canvas座標）
     @param scale 1mあたりのピクセル数
     @param angleRad 機体姿勢角（0=真上向き）
     @param opts {flame:boolean, parachuteOpen:boolean, showMarkers:boolean}
  ============================================================ */
  static drawRocketShape(ctx, rocket, cx, cy, scale, angleRad = 0, opts = {}) {
    const { flame = false, parachuteOpen = false, showMarkers = false } = opts;
    const cgY = rocket.centerOfGravity; // 先端からの距離[m]（回転の基準点として使う）
    const halfD = rocket.diameter / 2;

    // ローカル座標(先端からの距離yFromNose, 中心線からのオフセットxLocal)を
    // 「CGを原点とした回転済み描画座標」に変換するヘルパー
    const toLocal = (xLocal, yFromNose) => [xLocal * scale, (yFromNose - cgY) * scale];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);

    // ---- 炎（エンジン燃焼中） ----
    if (flame) {
      const [fx, fy] = toLocal(0, rocket.totalLength);
      const flicker = 0.7 + Math.random() * 0.6;
      const grad = ctx.createLinearGradient(fx, fy, fx, fy + 40 * scale / 60 * flicker);
      grad.addColorStop(0, "rgba(255,220,120,0.95)");
      grad.addColorStop(0.5, "rgba(255,140,40,0.8)");
      grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(fx - halfD * scale * 0.6, fy);
      ctx.lineTo(fx, fy + 34 * scale / 60 * flicker + halfD * scale);
      ctx.lineTo(fx + halfD * scale * 0.6, fy);
      ctx.closePath();
      ctx.fill();
    }

    // ---- フィン（胴体後端に左右2枚のシルエットとして描画） ----
    const { a, b, s } = rocket.fins.geometry;
    const finRootX = rocket.finRootLeadingEdgeX;
    ctx.fillStyle = "#3fb8d6";
    ctx.strokeStyle = "var(--accent)";
    [-1, 1].forEach(side => {
      ctx.beginPath();
      const [x1, y1] = toLocal(side * halfD, finRootX);
      const [x2, y2] = toLocal(side * halfD, finRootX + a);
      const [x3, y3] = toLocal(side * (halfD + s), finRootX + a - (a - b) / 2 + rocket.fins.geometry.m);
      const [x4, y4] = toLocal(side * (halfD + s), finRootX + a - (a - b) / 2 + rocket.fins.geometry.m - b);
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.lineTo(x3, y3);
      ctx.lineTo(x4, y4);
      ctx.closePath();
      ctx.fillStyle = "rgba(0,229,255,0.35)";
      ctx.fill();
      ctx.lineWidth = 1.5;
      ctx.stroke();
    });

    // ---- ボディチューブ ----
    const bodyTopY = rocket.nose.length;
    const bodyBotY = rocket.nose.length + rocket.body.length;
    const [bx1, by1] = toLocal(-halfD, bodyTopY);
    const [bx2] = toLocal(halfD, bodyTopY);
    const [, by2] = toLocal(halfD, bodyBotY);
    ctx.fillStyle = "#cfe8ee";
    ctx.strokeStyle = "#5c7a8a";
    ctx.lineWidth = 1.5;
    ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);
    ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);

    // ---- ノーズコーン ----
    const [tipX, tipY] = toLocal(0, 0);
    const [nlX, nlY] = toLocal(-halfD, rocket.nose.length);
    const [nrX] = toLocal(halfD, rocket.nose.length);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    if (rocket.nose.shape === "円錐") {
      ctx.lineTo(nlX, nlY);
      ctx.lineTo(nrX, nlY);
    } else {
      // オジーブ/楕円は緩やかな曲線で近似
      ctx.quadraticCurveTo(nlX, tipY + (nlY - tipY) * 0.3, nlX, nlY);
      ctx.lineTo(nrX, nlY);
      ctx.quadraticCurveTo(nrX, tipY + (nlY - tipY) * 0.3, tipX, tipY);
    }
    ctx.closePath();
    ctx.fillStyle = "#e8f4f8";
    ctx.strokeStyle = "#5c7a8a";
    ctx.fill();
    ctx.stroke();

    // ---- パラシュート（展開時のみ簡易円弧を上空に表示） ----
    if (parachuteOpen) {
      const [px, py] = toLocal(0, -0.3);
      ctx.strokeStyle = "rgba(220,232,240,0.85)";
      ctx.lineWidth = 2;
      const r = rocket.parachute.diameter * scale * 0.9;
      ctx.beginPath();
      ctx.arc(px, py, r, Math.PI, 0);
      ctx.stroke();
      // 吊り紐
      [-0.7, -0.3, 0.3, 0.7].forEach(t => {
        ctx.beginPath();
        ctx.moveTo(px + t * r, py);
        ctx.lineTo(tipX, tipY + (bodyTopY - cgY) * scale * 0.2);
        ctx.stroke();
      });
    }

    // ---- CG / CP マーカー（設計画面のみ表示） ----
    if (showMarkers) {
      const [cgx, cgy] = toLocal(0, rocket.centerOfGravity);
      const [cpx, cpy] = toLocal(0, rocket.centerOfPressure);
      UI._drawMarker(ctx, cgx, cgy, "#ffb020", "CG");
      UI._drawMarker(ctx, cpx, cpy, "#ff3b5c", "CP");
    }

    ctx.restore();
  }

  static _drawMarker(ctx, x, y, color, text) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 7, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
    ctx.stroke();
    ctx.font = "11px 'Share Tech Mono', monospace";
    ctx.fillText(text, x + 14, y + 4);
    ctx.restore();
  }

  /* ============================================================
     設計画面プレビュー（静止・角度0）
  ============================================================ */
  static drawDesignPreview(canvas, rocket, zoom = 1) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);

    // グリッド背景
    UI._drawGrid(ctx, w, h);

    const scale = (h * 0.8 / Math.max(0.3, rocket.totalLength)) * zoom * (1 / devicePixelRatio) * devicePixelRatio;
    UI.drawRocketShape(ctx, rocket, w / 2, h * 0.5, scale, 0, { showMarkers: true });
  }

  static _drawGrid(ctx, w, h) {
    ctx.save();
    ctx.strokeStyle = "rgba(0,229,255,0.06)";
    ctx.lineWidth = 1;
    const step = 40 * devicePixelRatio;
    for (let x = 0; x < w; x += step) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke(); }
    for (let y = 0; y < h; y += step) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke(); }
    ctx.restore();
  }

  /* ============================================================
     発射準備画面プレビュー（角度スライダーに応じて傾く）
  ============================================================ */
  static drawLaunchPreview(canvas, rocket, angleDeg) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width = canvas.clientWidth * devicePixelRatio;
    const h = canvas.height = canvas.clientHeight * devicePixelRatio;
    ctx.clearRect(0, 0, w, h);
    UI._drawGrid(ctx, w, h);

    // 発射台の地面ラインを描画
    ctx.strokeStyle = "rgba(220,232,240,0.3)";
    ctx.beginPath();
    ctx.moveTo(0, h * 0.85); ctx.lineTo(w, h * 0.85);
    ctx.stroke();

    const scale = (h * 0.55 / Math.max(0.3, rocket.totalLength)) * devicePixelRatio;
    const angleRad = (angleDeg * Math.PI) / 180;
    UI.drawRocketShape(ctx, rocket, w / 2, h * 0.6, scale, angleRad, {});
  }

  /* ============================================================
     ホーム画面: 背景アニメーション（炎を噴きながら飛び立つロケット）
     requestAnimationFrame ループを開始し、停止用の関数を返す。
  ============================================================ */
  static startHomeAnimation(canvas) {
    const ctx = canvas.getContext("2d");
    let raf = null;
    let running = true;
    let t = 0;

    // 背景の星（パララックス演出）
    const stars = Array.from({ length: 80 }, () => ({
      x: Math.random(), y: Math.random(), r: Math.random() * 1.5 + 0.3, s: Math.random() * 0.3 + 0.05
    }));

    function resize() {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    }
    resize();
    window.addEventListener("resize", resize);

    function frame() {
      if (!running) return;
      const w = canvas.width, h = canvas.height;
      t += 0.016;

      ctx.fillStyle = "#060a14";
      ctx.fillRect(0, 0, w, h);

      // 星
      ctx.fillStyle = "rgba(220,232,240,0.6)";
      stars.forEach(st => {
        const y = ((st.y * h) + t * 20 * st.s) % h;
        ctx.beginPath();
        ctx.arc(st.x * w, y, st.r * devicePixelRatio, 0, Math.PI * 2);
        ctx.fill();
      });

      // ロケット上昇アニメーション（8秒周期でループ）
      const cycle = 8;
      const progress = (t % cycle) / cycle;
      const riseY = h * (1.15 - progress * 1.5);
      const cx = w * 0.5 + Math.sin(progress * Math.PI * 2) * w * 0.05;
      const wobble = Math.sin(t * 3) * 0.03;

      ctx.save();
      ctx.translate(cx, riseY);
      ctx.rotate(wobble);

      // 炎
      const flameLen = (40 + Math.sin(t * 20) * 8) * devicePixelRatio;
      const grad = ctx.createLinearGradient(0, 14 * devicePixelRatio, 0, 14 * devicePixelRatio + flameLen);
      grad.addColorStop(0, "rgba(255,230,140,0.95)");
      grad.addColorStop(0.5, "rgba(255,130,40,0.85)");
      grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-8 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.lineTo(0, 14 * devicePixelRatio + flameLen);
      ctx.lineTo(8 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.closePath();
      ctx.fill();

      // 機体（簡略シルエット）
      ctx.fillStyle = "#dce8f0";
      ctx.beginPath();
      ctx.moveTo(0, -30 * devicePixelRatio);
      ctx.lineTo(-9 * devicePixelRatio, 0);
      ctx.lineTo(9 * devicePixelRatio, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(-9 * devicePixelRatio, 0, 18 * devicePixelRatio, 14 * devicePixelRatio);
      // フィン
      ctx.fillStyle = "#00e5ff";
      ctx.beginPath();
      ctx.moveTo(-9 * devicePixelRatio, 4 * devicePixelRatio);
      ctx.lineTo(-18 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.lineTo(-9 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(9 * devicePixelRatio, 4 * devicePixelRatio);
      ctx.lineTo(18 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.lineTo(9 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.fill();

      ctx.restore();

      raf = requestAnimationFrame(frame);
    }
    frame();

    return function stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }

  /* ============================================================
     シミュレーション画面: テレメトリHUD更新
  ============================================================ */
  static updateTelemetryHUD(sim) {
    document.getElementById("tele-alt").textContent = Math.max(0, sim.y).toFixed(0);
    document.getElementById("tele-vel").textContent = Math.hypot(sim.vx, sim.vy).toFixed(1);
    document.getElementById("tele-time").textContent = sim.time.toFixed(1);
    document.getElementById("tele-wind").textContent = `${sim.windSpeed.toFixed(1)} m/s`;
  }
}
