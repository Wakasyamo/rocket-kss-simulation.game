/*
  ファイル名: ui.js
  依存関係: rocket.js（MaterialDB, NOSE_SHAPES, FIN_SHAPES, FIN_SECTIONS,
            FIN_CUSTOM_LABEL, DECAL_PATTERNS, EngineDB, Engine） /
            stage.js（Stageインスタンスのプロパティを参照） /
            physics.js（Physics.estimateApogeeを予測高度表示に使用）
  ------------------------------------------------------------------
  DOM/Canvas描画のみを担当し、状態は保持しない（値の保持はRocket/
  Stage/SimState側）。script.jsの契約に定義された全メソッドをここで実装する。
*/

class UI {

  /* ============================================================
     汎用ウィジェット
  ============================================================ */
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
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => {
      const v = parseFloat(input.value);
      valSpan.textContent = fmt(v);
      onInput(v);
    });
    wrap.appendChild(labelEl); wrap.appendChild(input);
    return wrap;
  }

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
      chip.setAttribute("aria-label", o.text);
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

  /** カラーピッカー（パーツ別カラーリング機能） */
  static createColorPicker(opt) {
    const { label, value, onChange } = opt;
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.innerHTML = `<span>${label}</span>`;
    wrap.appendChild(labelEl);
    const row = document.createElement("div");
    row.className = "color-picker-row";
    const input = document.createElement("input");
    input.type = "color";
    input.value = value;
    input.setAttribute("aria-label", label);
    input.addEventListener("input", () => onChange(input.value));
    row.appendChild(input);
    wrap.appendChild(row);
    return wrap;
  }

  /**
   * 重量の手動上書きUI（ステージ6限定機能）。
   * チェックボックスONで数値入力が有効になり、part.massOverride に反映する。
   * @param part massOverrideプロパティを持つパーツインスタンス（g単位ではなくkg単位で保持）
   * @param computedMassG 現在の（上書きしていない場合の）計算上の質量[g]。プレースホルダ表示用
   */
  static createMassOverrideRow(part, computedMassG, onUpdate) {
    const wrap = document.createElement("div");
    wrap.className = "field-group mass-override-group";
    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.innerHTML = `<span>重量を手動指定（ステージ6限定）</span>`;
    wrap.appendChild(labelEl);

    const row = document.createElement("div");
    row.className = "mass-override-row";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = part.massOverride != null;
    checkbox.setAttribute("aria-label", "重量を手動指定する");

    const numberInput = document.createElement("input");
    numberInput.type = "number";
    numberInput.min = "0";
    numberInput.step = "0.1";
    numberInput.value = (part.massOverride != null ? part.massOverride : computedMassG).toFixed(1);
    numberInput.disabled = part.massOverride == null;
    numberInput.setAttribute("aria-label", "重量(グラム)");

    const unit = document.createElement("span");
    unit.textContent = "g";
    unit.className = "mass-override-unit";

    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        part.massOverride = parseFloat(numberInput.value) || 0;
        numberInput.disabled = false;
      } else {
        part.massOverride = null;
        numberInput.disabled = true;
      }
      onUpdate();
    });
    numberInput.addEventListener("input", () => {
      if (!checkbox.checked) return;
      part.massOverride = Math.max(0, parseFloat(numberInput.value) || 0);
      onUpdate();
    });

    row.appendChild(checkbox);
    row.appendChild(numberInput);
    row.appendChild(unit);
    wrap.appendChild(row);
    return wrap;
  }

  /** デカール選択グリッド（🔥⚡❤️ 等のパターン適用） */
  static createDecalSelector(rocket, onUpdate) {
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.innerHTML = "<span>デカール（模様）</span>";
    wrap.appendChild(labelEl);

    const grid = document.createElement("div");
    grid.className = "decal-grid";
    Object.entries(DECAL_PATTERNS).forEach(([key, data]) => {
      const opt = document.createElement("button");
      opt.className = "decal-option" + (rocket.decal.pattern === key ? " active" : "");
      opt.innerHTML = `<span class="decal-icon">${data.icon}</span><span>${data.label}</span>`;
      opt.setAttribute("aria-label", `デカール: ${data.label}`);
      opt.addEventListener("click", () => {
        rocket.decal.pattern = key;
        grid.querySelectorAll(".decal-option").forEach(o => o.classList.remove("active"));
        opt.classList.add("active");
        onUpdate();
      });
      grid.appendChild(opt);
    });
    wrap.appendChild(grid);

    wrap.appendChild(UI.createChipRow({
      label: "適用範囲",
      active: rocket.decal.scope,
      options: [{ value: "body", text: "ボディのみ" }, { value: "whole", text: "全体" }],
      onSelect: (v) => { rocket.decal.scope = v; onUpdate(); }
    }));
    return wrap;
  }

  static starString(level, max = 5) {
    const lv = Math.max(0, Math.min(max, Math.round(level)));
    return "★".repeat(lv) + "☆".repeat(max - lv);
  }
  static _diffClass(diff, tolerance = 0.05) {
    if (Math.abs(diff) < tolerance) return "zero";
    return diff > 0 ? "positive" : "negative";
  }
  static _diffText(diff, unit, decimals = 1, tolerance = 0.05) {
    if (Math.abs(diff) < tolerance) return `±0${unit}`;
    const sign = diff > 0 ? "+" : "";
    return `${sign}${diff.toFixed(decimals)}${unit}`;
  }

  static createMaterialList(opt) {
    const { partType, part, onSelect } = opt;
    const materials = MaterialDB.getForPart(partType);
    const currentMassG = part.mass * 1000;
    const currentPrice = part.price;
    const wrap = document.createElement("div");
    wrap.className = "field-group";
    const labelEl = document.createElement("div");
    labelEl.className = "field-label";
    labelEl.innerHTML = "<span>素材（現在の寸法での実測値）</span>";
    wrap.appendChild(labelEl);
    const list = document.createElement("div");
    list.className = "material-list";
    materials.forEach(m => {
      const massG = part.massForMaterial(m.name);
      const price = part.priceForMaterial(m.name);
      const massDiff = massG - currentMassG;
      const priceDiff = price - currentPrice;
      const stars = MaterialDB.strengthStars(m.strength);
      const isActive = m.name === part.material;
      const item = document.createElement("div");
      item.className = "material-item" + (isActive ? " active" : "");
      item.innerHTML = `
        <div>
          <span class="mat-name">${m.name}</span>
          <span class="mat-stars">${UI.starString(stars)}</span>
        </div>
        <div class="mat-metric">重量: ${massG.toFixed(1)}g
          <span class="mat-diff ${UI._diffClass(massDiff)}">${UI._diffText(massDiff, "g")}</span>
        </div>
        <div class="mat-metric">価格: ¥${Math.round(price)}
          <span class="mat-diff ${UI._diffClass(priceDiff, 1)}">${UI._diffText(priceDiff, "円", 0, 1)}</span>
        </div>`;
      item.addEventListener("click", () => {
        list.querySelectorAll(".material-item").forEach(el => el.classList.remove("active"));
        item.classList.add("active");
        onSelect(m.name);
      });
      list.appendChild(item);
    });
    wrap.appendChild(list);
    return wrap;
  }

  /* ============================================================
     部品説明の吹き出し（？モード）
  ============================================================ */
  static PART_HELP = {
    nose: {
      title: "ノーズコーン",
      role: "機体の先端で空気を切り裂く部品です。",
      effect: "長くすると空気抵抗は減り最高高度が伸びますが、重量が増えます。太くすると全体の直径も変わります。",
      tip: "最初は「オジーブ」形状・長さ10〜15cm程度が扱いやすくおすすめです。",
      recommend: "オジーブ形状 / 長さ12cm / バルサ材"
    },
    body: {
      title: "ボディチューブ",
      role: "ロケットの胴体部分。エンジンやパラシュートを収納します。",
      effect: "長くすると安定性が増しますが重量と空気抵抗も増加。短すぎると安定性が不足しがちです。",
      tip: "全長の半分〜3分の2程度がバランスの良い長さの目安です。",
      recommend: "長さ25〜35cm / 紙またはバルサ材"
    },
    transition: {
      title: "トランジション（テーパー形状）",
      role: "太さの異なる2つのボディをなめらかにつなぐ部品です。",
      effect: "前後の直径差が大きいほど空力的な影響（Cnα）が増し、機体全体の安定性に影響します。",
      tip: "上級ステージ限定のパーツです。まずは前後の直径差を小さめにして試すのがおすすめです。",
      recommend: "前径24mm→後径18mm程度の緩やかなテーパー"
    },
    fin: {
      title: "フィン",
      role: "機体後部の翼。飛行姿勢を風向きに保ち安定させます。",
      effect: "大きくすると安定性は増しますが、抵抗が増えて最高高度は下がります。",
      tip: "初めは3枚・標準サイズが扱いやすくおすすめです。",
      recommend: "3枚 / 標準形状 / 矩形断面 / バルサ材"
    },
    parachute: {
      title: "パラシュート",
      role: "着地時に開いて機体をゆっくり降下させ、機体を保護します。",
      effect: "直径を大きくすると着地時の衝撃が減り安全になりますが、風に流されやすくなります。",
      tip: "機体の直径のおよそ10倍程度の直径が目安です。",
      recommend: "直径30cm前後"
    },
    weight: {
      title: "おもり",
      role: "重心(CG)を調整するための追加重量です。",
      effect: "重心を前方に動かすほど安定性が増しますが、重量増加により最高高度は下がります。",
      tip: "安定性が1〜2口径になるよう、少量ずつ調整しましょう。",
      recommend: "0〜10g程度から様子を見て調整"
    },
    engine: {
      title: "エンジン",
      role: "ロケットを打ち上げる推進装置です。",
      effect: "全力積が大きいほど高く飛びますが、機体重量に対して大きすぎるエンジンは強度不足で破損する危険があります。",
      tip: "初めてのフライトはC6-3のような中程度の推力のエンジンがおすすめです。",
      recommend: "C6-3（バランス型）"
    }
  };

  static showHelpBubble(partType, anchorEl) {
    const data = UI.PART_HELP[partType];
    if (!data) return;
    const bubble = document.getElementById("help-bubble");
    document.getElementById("help-bubble-title").textContent = data.title;
    document.getElementById("help-role").textContent = data.role;
    document.getElementById("help-effect").textContent = data.effect;
    document.getElementById("help-tip").textContent = data.tip;
    document.getElementById("help-recommend").textContent = data.recommend;
    bubble.classList.remove("hidden");
  }
  static hideHelpBubble() { document.getElementById("help-bubble").classList.add("hidden"); }

  /* ============================================================
     ホーム画面背景アニメーション
  ============================================================ */
  static startHomeAnimation(canvas) {
    if (!canvas) return () => {};
    const ctx = canvas.getContext("2d");
    let running = true, raf = null, t = 0;
    const stars = Array.from({ length: 60 }, () => ({ x: Math.random(), y: Math.random(), r: Math.random() * 1.4 + 0.3, s: Math.random() * 0.3 + 0.05 }));
    function resize() { canvas.width = canvas.clientWidth * devicePixelRatio; canvas.height = canvas.clientHeight * devicePixelRatio; }
    resize();
    window.addEventListener("resize", resize);
    function frame() {
      if (!running) return;
      const w = canvas.width, h = canvas.height;
      t += 0.016;
      ctx.fillStyle = "#060a14"; ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = "rgba(234,227,216,0.6)";
      stars.forEach(st => { const y = ((st.y * h) + t * 20 * st.s) % h; ctx.beginPath(); ctx.arc(st.x * w, y, st.r * devicePixelRatio, 0, Math.PI * 2); ctx.fill(); });
      const cycle = 8, progress = (t % cycle) / cycle;
      const riseY = h * (1.15 - progress * 1.5);
      const cx = w * 0.5 + Math.sin(progress * Math.PI * 2) * w * 0.05;
      ctx.save(); ctx.translate(cx, riseY);
      const flameLen = (40 + Math.sin(t * 20) * 8) * devicePixelRatio;
      const grad = ctx.createLinearGradient(0, 14 * devicePixelRatio, 0, 14 * devicePixelRatio + flameLen);
      grad.addColorStop(0, "rgba(255,230,140,0.95)"); grad.addColorStop(0.5, "rgba(255,150,60,0.85)"); grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.moveTo(-8 * devicePixelRatio, 14 * devicePixelRatio); ctx.lineTo(0, 14 * devicePixelRatio + flameLen); ctx.lineTo(8 * devicePixelRatio, 14 * devicePixelRatio); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#eae3d8";
      ctx.beginPath(); ctx.moveTo(0, -30 * devicePixelRatio); ctx.lineTo(-9 * devicePixelRatio, 0); ctx.lineTo(9 * devicePixelRatio, 0); ctx.closePath(); ctx.fill();
      ctx.fillRect(-9 * devicePixelRatio, 0, 18 * devicePixelRatio, 14 * devicePixelRatio);
      ctx.fillStyle = "#ffd166";
      ctx.beginPath(); ctx.moveTo(-9 * devicePixelRatio, 4 * devicePixelRatio); ctx.lineTo(-18 * devicePixelRatio, 14 * devicePixelRatio); ctx.lineTo(-9 * devicePixelRatio, 14 * devicePixelRatio); ctx.fill();
      ctx.beginPath(); ctx.moveTo(9 * devicePixelRatio, 4 * devicePixelRatio); ctx.lineTo(18 * devicePixelRatio, 14 * devicePixelRatio); ctx.lineTo(9 * devicePixelRatio, 14 * devicePixelRatio); ctx.fill();
      ctx.restore();
      raf = requestAnimationFrame(frame);
    }
    frame();
    return () => { running = false; if (raf) cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }

  /* ============================================================
     ステージ選択カード
  ============================================================ */
  static renderStageList(containerEl, stages, onSelect) {
    containerEl.innerHTML = "";
    stages.forEach((stage, i) => {
      const card = document.createElement("div");
      card.className = "hud-panel stage-card";
      card.setAttribute("tabindex", "0");
      card.setAttribute("role", "button");
      card.setAttribute("aria-label", `${stage.name}を選択`);
      card.innerHTML = `
        <span class="difficulty-badge ${stage.difficulty}">${UI._difficultyLabel(stage.difficulty)}</span>
        <div class="stage-num">STAGE ${String(i + 1).padStart(2, "0")}</div>
        <div class="stage-name">${stage.name}</div>
        <div class="stage-stat"><span>予算</span><span>${stage.budgetLabel}</span></div>
        <div class="stage-stat"><span>最小直径</span><span>${stage.minDiameterMM}mm</span></div>
        <div class="stage-stat"><span>エンジン</span><span>${stage.engineLabel}</span></div>
        <div class="stage-stat"><span>風況</span><span>${stage.windLabel}</span></div>
        <p style="font-size:0.76rem; color:var(--text-mute); margin-top:8px;">${stage.description}</p>
        ${stage.clearGoal
          ? `<div class="stage-goal"><b>クリア目標</b><br>${stage.clearGoalLabel}</div>`
          : `<div class="stage-freeplay-tag">FREE PLAY — クリア目標なし</div>`}
      `;
      const select = () => onSelect(stage);
      card.addEventListener("click", select);
      card.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); select(); } });
      containerEl.appendChild(card);
    });
  }
  static _difficultyLabel(d) {
    return { beginner: "初心者", intermediate: "中級者", advanced: "上級者", custom: "カスタム" }[d] || d;
  }

  /* ============================================================
     工程説明（explanation state） / チュートリアル（各工程入口）
  ============================================================ */
  static renderExplanationContent(stage) {
    return `
      <h3>ロケットは6つのパーツでできています</h3>
      <p>ノーズ（先端）・ボディ（胴体）・フィン（翼）・パラシュート（減速）・おもり（重心調整）・エンジン（推進）を組み合わせて設計します。</p>
      <h3>今回の目標</h3>
      <p>${stage.clearGoal ? stage.clearGoalLabel : "クリア目標なし。自由に試作してみましょう。"}</p>
      <h3>予算</h3>
      <p>今回使える予算は ${stage.budgetLabel} です。素材や部品のサイズによって価格が変わるので、右下の価格表示を見ながら設計しましょう。</p>
      <h3>安定性について</h3>
      <p>下部の「安定性」はロケットが真っすぐ飛ぶかどうかの指標です。緑色の範囲を目安に調整してみてください。</p>
    `;
  }

  static renderTutorialContent(stage, phase) {
    if (!stage.tutorial) return null;

    // 画像埋め込み対応: stage.tutorialImages[phase] が設定されていれば
    // 本文の先頭に<img>を挿入する。画像が用意されていない/読込失敗時は
    // 自動で非表示になり、レイアウトが崩れないようにする。
    const imageUrl = stage.tutorialImages && stage.tutorialImages[phase];
    const imgTag = imageUrl
      ? `<img src="${imageUrl}" alt="${phase === "design" ? "設計の進め方" : "発射の進め方"}"
             class="tutorial-image" onerror="this.style.display='none'" />`
      : "";

    if (phase === "design") {
      return `${imgTag}
              <p>まずは「ノーズ」を選んで、長さや素材を変えてみましょう。右側のパネルで形も選べます。</p>
              <p>下部に表示される「価格」が予算(${stage.budgetLabel})を超えると赤くなります。予算内に収まるよう調整しましょう。</p>
              <p>設計が終わったら、左下の「発射待機へ」ボタンで次に進めます。</p>`;
    }
    if (phase === "launch") {
      return `${imgTag}
              <p>発射角度をスライダーで調整できます（まずは0°=真上でOK）。</p>
              <p>右下（画面によっては下部）に現在の風速が表示されます。風は常に変化するので、タイミングを見て「LAUNCH」を押しましょう。</p>
              <p>ボタンを押すと3秒のカウントダウンの後、発射されます。</p>`;
    }
    return null;
  }

  /* ============================================================
     設計画面: パラメータパネル
     ------------------------------------------------------------
     @param stage 現在のStage（エンジン選択肢の絞り込み・初心者向け
                  簡略化・トランジション/自由形フィンの解放判定に使用）
  ============================================================ */
  static renderPartPanel(partType, rocket, stage, onUpdate) {
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
          label: "太さ（直径）", min: Math.max(1.5, (stage?.minDiameterMM || 18) / 10), max: 8, step: 0.1,
          value: rocket.nose.diameter * 100, unit: "cm",
          onInput: v => { rocket.nose.diameter = v / 100; rocket.body.diameter = v / 100; onUpdate(); }
        }));
        add(UI.createChipRow({
          label: "形状", active: rocket.nose.shape,
          options: Object.keys(NOSE_SHAPES).map(k => ({ value: k, text: k })),
          onSelect: v => { rocket.nose.shape = v; onUpdate(); }
        }));
        add(UI.createMaterialList({ partType: "nose", part: rocket.nose, onSelect: v => { rocket.nose.material = v; onUpdate(true); } }));
        add(UI.createColorPicker({ label: "カラー", value: rocket.nose.color, onChange: v => { rocket.nose.color = v; onUpdate(); } }));
        if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.nose, rocket.nose.massForMaterial(rocket.nose.material), onUpdate));
        break;
      }
      case "body": {
        add(UI.createSlider({
          label: "長さ", min: 10, max: 60, step: 0.5, value: rocket.body.length * 100, unit: "cm",
          onInput: v => { rocket.body.length = v / 100; onUpdate(); }
        }));
        add(UI.createMaterialList({ partType: "body", part: rocket.body, onSelect: v => { rocket.body.material = v; onUpdate(true); } }));
        add(UI.createColorPicker({ label: "カラー", value: rocket.body.color, onChange: v => { rocket.body.color = v; onUpdate(); } }));
        add(UI.createDecalSelector(rocket, onUpdate));
        if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.body, rocket.body.massForMaterial(rocket.body.material), onUpdate));
        break;
      }
      case "transition": {
        if (!stage?.customUnlocked) {
          const notice = document.createElement("div");
          notice.className = "field-group";
          notice.innerHTML = `<p style="color:var(--text-mute); font-size:0.85rem;">このステージではトランジションは使用できません。</p>`;
          add(notice);
          break;
        }
        add(UI.createChipRow({
          label: "トランジションを使用する",
          active: rocket.transitionEnabled ? "on" : "off",
          options: [{ value: "off", text: "使わない" }, { value: "on", text: "使う" }],
          onSelect: v => { rocket.setTransitionEnabled(v === "on"); onUpdate(true); }
        }));
        if (rocket.transitionEnabled) {
          add(UI.createSlider({
            label: "長さ", min: 2, max: 15, step: 0.5, value: rocket.transition.length * 100, unit: "cm",
            onInput: v => { rocket.transition.length = v / 100; onUpdate(); }
          }));
          add(UI.createSlider({
            label: "前径（上段ボディ側）", min: 1.5, max: 8, step: 0.1, value: rocket.transition.diameterFront * 100, unit: "cm",
            onInput: v => { rocket.transition.diameterFront = v / 100; onUpdate(); }
          }));
          add(UI.createSlider({
            label: "後径（下段ボディ側）", min: 1.5, max: 8, step: 0.1, value: rocket.transition.diameterBack * 100, unit: "cm",
            onInput: v => { rocket.transition.diameterBack = v / 100; rocket.bodyLower.diameter = v / 100; onUpdate(); }
          }));
          add(UI.createSlider({
            label: "下段ボディ長さ", min: 5, max: 40, step: 0.5, value: rocket.bodyLower.length * 100, unit: "cm",
            onInput: v => { rocket.bodyLower.length = v / 100; onUpdate(); }
          }));
          add(UI.createMaterialList({ partType: "transition", part: rocket.transition, onSelect: v => { rocket.transition.material = v; onUpdate(true); } }));
          add(UI.createColorPicker({ label: "カラー", value: rocket.transition.color, onChange: v => { rocket.transition.color = v; onUpdate(); } }));
          if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.transition, rocket.transition.massForMaterial(rocket.transition.material), onUpdate));
        }
        break;
      }
      case "fin": {
        add(UI.createSlider({
          label: "枚数", min: 3, max: 6, step: 1, value: rocket.fins.count, unit: "枚",
          onInput: v => { rocket.fins.count = Math.round(v); onUpdate(); }
        }));
        const shapeOptions = Object.keys(FIN_SHAPES).map(k => ({ value: k, text: k }));
        if (stage?.customUnlocked) shapeOptions.push({ value: FIN_CUSTOM_LABEL, text: FIN_CUSTOM_LABEL });
        add(UI.createChipRow({
          label: "形状", active: rocket.fins.shape,
          options: shapeOptions,
          onSelect: v => {
            if (v === FIN_CUSTOM_LABEL && !rocket.fins.customGeometry) {
              rocket.fins.setCustomGeometry({ rootWidth: 0.08, tipWidth: 0.04, sweepAngleDeg: 30, height: 0.05 });
            } else {
              rocket.fins.shape = v;
            }
            onUpdate(true); // 形状によって表示されるフィールドが変わるため構造的に再描画
          }
        }));
        if (rocket.fins.shape === FIN_CUSTOM_LABEL && stage?.customUnlocked) {
          const g = rocket.fins.customGeometry;
          const applyCustom = (patch) => {
            const merged = { rootWidth: g.a, tipWidth: g.b, height: g.s, sweepAngleDeg: (Math.atan2(g.m, g.s) * 180) / Math.PI, ...patch };
            rocket.fins.setCustomGeometry(merged);
            onUpdate();
          };
          add(UI.createSlider({ label: "根本幅", min: 3, max: 20, step: 0.5, value: g.a * 100, unit: "cm", onInput: v => applyCustom({ rootWidth: v / 100 }) }));
          add(UI.createSlider({ label: "端部幅", min: 0, max: 15, step: 0.5, value: g.b * 100, unit: "cm", onInput: v => applyCustom({ tipWidth: v / 100 }) }));
          add(UI.createSlider({ label: "高さ", min: 2, max: 15, step: 0.5, value: g.s * 100, unit: "cm", onInput: v => applyCustom({ height: v / 100 }) }));
          add(UI.createSlider({ label: "後退角", min: 0, max: 70, step: 1, value: (Math.atan2(g.m, g.s) * 180) / Math.PI, unit: "°", onInput: v => applyCustom({ sweepAngleDeg: v }) }));
        }
        add(UI.createChipRow({
          label: "断面形状", active: rocket.fins.section,
          options: Object.keys(FIN_SECTIONS).map(k => ({ value: k, text: k })),
          onSelect: v => { rocket.fins.section = v; onUpdate(); }
        }));
        add(UI.createMaterialList({ partType: "fin", part: rocket.fins, onSelect: v => { rocket.fins.material = v; onUpdate(true); } }));
        add(UI.createColorPicker({ label: "カラー", value: rocket.fins.color, onChange: v => { rocket.fins.color = v; onUpdate(); } }));
        if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.fins, rocket.fins.massForMaterial(rocket.fins.material), onUpdate));
        break;
      }
      case "parachute": {
        add(UI.createSlider({
          label: "直径", min: 10, max: 80, step: 1, value: rocket.parachute.diameter * 100, unit: "cm",
          onInput: v => { rocket.parachute.diameter = v / 100; onUpdate(); }
        }));
        if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.parachute, rocket.parachute.diameter * 100 * MASS_COEF.parachutePerCm, onUpdate));
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
        const codes = (typeof EngineDB !== "undefined") ? EngineDB.codesForStage(stage) : [rocket.engine.code];
        if (!codes.includes(rocket.engine.code) && codes.length) {
          rocket.engine = new Engine(codes[0]);
        }
        add(UI.createChipRow({
          label: "エンジン選択", active: rocket.engine.code,
          options: codes.map(c => ({ value: c, text: c })),
          onSelect: v => { rocket.engine = new Engine(v); onUpdate(true); }
        }));
        const info = document.createElement("div");
        info.className = "field-group";
        info.innerHTML = `
          <div class="field-label"><span>全力積</span><span class="field-val">${rocket.engine.totalImpulse} Ns</span></div>
          <div class="field-label"><span>平均推力</span><span class="field-val">${rocket.engine.avgThrust} N</span></div>
          <div class="field-label"><span>展開遅延</span><span class="field-val">${rocket.engine.delay} s</span></div>
          <div class="field-label"><span>質量</span><span class="field-val">${(rocket.engine.mass * 1000).toFixed(1)} g</span></div>
          <div class="field-label"><span>価格</span><span class="field-val">¥${rocket.engine.price.toLocaleString()}</span></div>
        `;
        add(info);
        if (stage?.allowMassOverride) add(UI.createMassOverrideRow(rocket.engine, (ENGINE_MASS_MAP[rocket.engine.classKey] || 30), onUpdate));
        break;
      }
    }
  }

  /* ============================================================
     設計画面: データグリッド（初心者ステージではCG/CPを非表示。
               CNαは仕様変更によりステージを問わず非表示）
  ============================================================ */
  static updateDataGrid(rocket, stage) {
    const grid = document.getElementById("data-grid");
    const overBudget = stage.isOverBudget(rocket);
    const predictedApogee = (typeof Physics !== "undefined") ? Physics.estimateApogee(rocket, stage) : 0;

    const cells = [
      { label: "総質量", value: `${(rocket.totalMass * 1000).toFixed(1)} g` },
      { label: "全長", value: `${(rocket.totalLength * 100).toFixed(1)} cm` },
      { label: "予測最高高度", value: `${predictedApogee.toFixed(1)} m` },
      { label: "価格", value: `¥${rocket.totalPrice.toLocaleString()}`, warnClass: overBudget ? "danger" : "" }
    ];

    if (stage.simplifiedUI) {
      // 初心者ステージ: 専門パラメータ(CG/CP)は隠し、直感的な安定性ラベルのみ表示
      const margin = rocket.staticMargin;
      const label = margin < 0.5 ? "不安定" : margin > 3 ? "やや過剰" : "良好";
      cells.push({ label: "安定性", value: label });
    } else {
      cells.push({ label: "重心 (CG)", value: `${(rocket.cg * 100).toFixed(1)} cm` });
      cells.push({ label: "圧力中心 (CP)", value: `${(rocket.cp * 100).toFixed(1)} cm` });
    }

    grid.innerHTML = cells.map(c => `
      <div class="data-cell ${c.warnClass || ""}">
        <span class="data-label">${c.label}</span>
        <span class="data-value">${c.value}</span>
      </div>`).join("");
  }

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
    document.getElementById("perf-bar-strength").textContent = UI.starString(rocket.strengthStars);
    const marginEl = document.getElementById("perf-stability");
    const margin = rocket.staticMargin;
    marginEl.textContent = `${margin.toFixed(2)} cal`;
    marginEl.style.color = (margin < 0.5 || margin > 3) ? "var(--danger)" : (margin < 1 ? "var(--warn)" : "var(--success)");
  }

  static updateBudgetIndicator(rocket, stage) {
    const el = document.getElementById("budget-value");
    el.textContent = stage.budget === Infinity
      ? `¥${rocket.totalPrice.toLocaleString()} / 無制限`
      : `¥${rocket.totalPrice.toLocaleString()} / ¥${stage.budget.toLocaleString()}`;
    el.classList.toggle("over", stage.isOverBudget(rocket));
  }

  /* ============================================================
     設計の保存・比較モーダル
  ============================================================ */
  static renderSavedDesignsList(containerEl, designs, currentStage, { onLoad, onDelete }) {
    if (!designs.length) {
      containerEl.innerHTML = `<div class="designs-empty">保存された設計はまだありません。上の欄から現在の設計を保存できます。</div>`;
      return;
    }
    containerEl.innerHTML = "";
    designs.slice().reverse().forEach(entry => {
      const row = document.createElement("div");
      row.className = "design-entry";
      row.innerHTML = `
        <div>
          <div class="design-entry-name">${entry.name}</div>
          <div style="color:var(--text-mute); font-size:0.68rem;">${entry.stageName} / ${new Date(entry.savedAt).toLocaleDateString()}</div>
        </div>
        <div class="design-entry-metric">質量<b>${entry.stats.massG.toFixed(1)}g</b></div>
        <div class="design-entry-metric">価格<b>¥${entry.stats.price.toLocaleString()}</b></div>
        <div class="design-entry-metric">予測高度<b>${entry.stats.apogee.toFixed(0)}m</b></div>
        <div class="design-entry-actions">
          <button class="hud-btn hud-btn-small" data-action="load" aria-label="この設計を読み込む">読込</button>
          <button class="icon-btn" data-action="delete" aria-label="この設計を削除">🗑</button>
        </div>`;
      row.querySelector('[data-action="load"]').addEventListener("click", () => onLoad(entry));
      row.querySelector('[data-action="delete"]').addEventListener("click", () => onDelete(entry));
      containerEl.appendChild(row);
    });
  }

  /* ============================================================
     ロケット形状描画（flight/result共通の2D描画関数）
  ============================================================ */
  static drawRocketShape(ctx, rocket, cx, cy, scale, angleRad = 0, opts = {}) {
    const { flame = false, parachuteOpen = false, showMarkers = false } = opts;
    const cgY = rocket.cg;
    const halfD = rocket.diameter / 2;
    const toLocal = (xLocal, yFromNose) => [xLocal * scale, (yFromNose - cgY) * scale];

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angleRad);

    if (flame) {
      const [fx, fy] = toLocal(0, rocket.totalLength);
      const flicker = 0.7 + Math.random() * 0.6;
      const grad = ctx.createLinearGradient(fx, fy, fx, fy + 40 * scale / 60 * flicker);
      grad.addColorStop(0, "rgba(255,220,120,0.95)"); grad.addColorStop(0.5, "rgba(255,140,40,0.8)"); grad.addColorStop(1, "rgba(255,60,20,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(fx - halfD * scale * 0.6, fy);
      ctx.lineTo(fx, fy + 34 * scale / 60 * flicker + halfD * scale);
      ctx.lineTo(fx + halfD * scale * 0.6, fy);
      ctx.closePath(); ctx.fill();
    }

    // フィン
    const { a, b, s } = rocket.fins.geometry;
    const finRootX = rocket.finRootLeadingEdgeX;
    [-1, 1].forEach(side => {
      ctx.beginPath();
      const [x1, y1] = toLocal(side * halfD, finRootX);
      const [x2, y2] = toLocal(side * halfD, finRootX + a);
      const [x3, y3] = toLocal(side * (halfD + s), finRootX + a - (a - b) / 2 + rocket.fins.geometry.m);
      const [x4, y4] = toLocal(side * (halfD + s), finRootX + a - (a - b) / 2 + rocket.fins.geometry.m - b);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x3, y3); ctx.lineTo(x4, y4); ctx.closePath();
      ctx.fillStyle = rocket.fins.color || "#3fb8d6";
      ctx.fill();
      if (rocket.decal && rocket.decal.pattern !== "none" && rocket.decal.scope === "whole") {
        ctx.save();
        ctx.clip(); // 直前のfin台形パスでクリップしてはみ出さないようにする
        const finMinX = Math.min(x1, x2, x3, x4), finMinY = Math.min(y1, y2, y3, y4);
        const finMaxX = Math.max(x1, x2, x3, x4), finMaxY = Math.max(y1, y2, y3, y4);
        UI._drawDecalPattern(ctx, rocket.decal.pattern, finMinX, finMinY, finMaxX - finMinX, finMaxY - finMinY, true);
        ctx.restore();
      }
      ctx.strokeStyle = "rgba(255,209,102,0.6)"; ctx.lineWidth = 1.5; ctx.stroke();
    });

    // トランジション + 下段ボディ（有効時）
    if (rocket.transitionEnabled) {
      const transTopY = rocket.nose.length + rocket.body.length;
      const transBotY = transTopY + rocket.transition.length;
      const halfFront = rocket.transition.diameterFront / 2, halfBack = rocket.transition.diameterBack / 2;
      const [tlX, tlY] = toLocal(-halfFront, transTopY);
      const [trX] = toLocal(halfFront, transTopY);
      const [blX, blY] = toLocal(-halfBack, transBotY);
      const [brX] = toLocal(halfBack, transBotY);
      ctx.beginPath(); ctx.moveTo(tlX, tlY); ctx.lineTo(trX, tlY); ctx.lineTo(brX, blY); ctx.lineTo(blX, blY); ctx.closePath();
      ctx.fillStyle = rocket.transition.color || "#cfe8ee"; ctx.fill(); ctx.strokeStyle = "#8a8f9a"; ctx.stroke();

      const lowerTopY = transBotY, lowerBotY = transBotY + rocket.bodyLower.length;
      const [lx1, ly1] = toLocal(-halfBack, lowerTopY);
      const [lx2] = toLocal(halfBack, lowerTopY);
      const [, ly2] = toLocal(halfBack, lowerBotY);
      ctx.fillStyle = rocket.bodyLower.color || "#cfe8ee";
      ctx.fillRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
      ctx.strokeStyle = "#8a8f9a"; ctx.strokeRect(lx1, ly1, lx2 - lx1, ly2 - ly1);
    }

    // ボディ
    const bodyTopY = rocket.nose.length, bodyBotY = rocket.nose.length + rocket.body.length;
    const [bx1, by1] = toLocal(-halfD, bodyTopY);
    const [bx2] = toLocal(halfD, bodyTopY);
    const [, by2] = toLocal(halfD, bodyBotY);
    ctx.fillStyle = rocket.body.color || "#cfe8ee";
    ctx.fillRect(bx1, by1, bx2 - bx1, by2 - by1);
    ctx.strokeStyle = "#8a8f9a"; ctx.lineWidth = 1.5; ctx.strokeRect(bx1, by1, bx2 - bx1, by2 - by1);
    // デカール（ボディには scope="body"/"whole" いずれでも適用）
    if (rocket.decal && rocket.decal.pattern !== "none") {
      UI._drawDecalPattern(ctx, rocket.decal.pattern, bx1, by1, bx2 - bx1, by2 - by1);
    }

    // ノーズ
    const [tipX, tipY] = toLocal(0, 0);
    const [nlX, nlY] = toLocal(-halfD, rocket.nose.length);
    const [nrX] = toLocal(halfD, rocket.nose.length);
    ctx.beginPath(); ctx.moveTo(tipX, tipY);
    if (rocket.nose.shape === "円錐") { ctx.lineTo(nlX, nlY); ctx.lineTo(nrX, nlY); }
    else {
      ctx.quadraticCurveTo(nlX, tipY + (nlY - tipY) * 0.3, nlX, nlY);
      ctx.lineTo(nrX, nlY);
      ctx.quadraticCurveTo(nrX, tipY + (nlY - tipY) * 0.3, tipX, tipY);
    }
    ctx.closePath();
    ctx.fillStyle = rocket.nose.color || "#e8f4f8"; ctx.fill();
    if (rocket.decal && rocket.decal.pattern !== "none" && rocket.decal.scope === "whole") {
      ctx.save();
      ctx.clip(); // 直前のノーズ形状パスでクリップ
      UI._drawDecalPattern(ctx, rocket.decal.pattern, nlX, tipY, nrX - nlX, nlY - tipY, true);
      ctx.restore();
    }
    ctx.strokeStyle = "#8a8f9a"; ctx.stroke();

    if (parachuteOpen) {
      const [px, py] = toLocal(0, -0.3);
      ctx.strokeStyle = "rgba(234,227,216,0.85)"; ctx.lineWidth = 2;
      const r = rocket.parachute.diameter * scale * 0.9;
      ctx.beginPath(); ctx.arc(px, py, r, Math.PI, 0); ctx.stroke();
      [-0.7, -0.3, 0.3, 0.7].forEach(tt => { ctx.beginPath(); ctx.moveTo(px + tt * r, py); ctx.lineTo(tipX, tipY + (bodyTopY - cgY) * scale * 0.2); ctx.stroke(); });
    }

    if (showMarkers) {
      const [cgx, cgy] = toLocal(0, rocket.cg);
      const [cpx, cpy] = toLocal(0, rocket.cp);
      UI._drawMarker(ctx, cgx, cgy, "#ffb020", "CG");
      UI._drawMarker(ctx, cpx, cpy, "#ff3b5c", "CP");
    }
    ctx.restore();
  }

  /**
   * デカール（模様）を2D Canvasに直接描画する。
   * ------------------------------------------------------------
   * 呼び出し元が既にクリップパス（ボディ矩形/ノーズ形状/フィン台形）を
   * 設定済みの場合は alreadyClipped=true を渡す。falseの場合はこの関数側で
   * 矩形クリップを設定してからパターンを描く（はみ出し防止）。
   */
  static _drawDecalPattern(ctx, pattern, x, y, w, h, alreadyClipped = false) {
    if (w <= 0 || h <= 0) return;
    ctx.save();
    if (!alreadyClipped) {
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
    }
    const fn = { fire: UI._decalFire, lightning: UI._decalLightning, heart: UI._decalHeart }[pattern];
    if (fn) fn(ctx, x, y, w, h);
    ctx.restore();
  }

  static _decalFire(ctx, x, y, w, h) {
    const colors = ["#ffb020", "#ff7a30", "#ffe08a"];
    const n = Math.max(1, Math.round(h / Math.max(8, w * 0.9)));
    for (let i = 0; i < n; i++) {
      const cy = y + (h / n) * (i + 0.5);
      const cx = x + w / 2;
      const flameH = (h / n) * 0.85, flameW = w * 0.7;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, cy + flameH / 2);
      ctx.quadraticCurveTo(cx - flameW / 2, cy, cx, cy - flameH / 2);
      ctx.quadraticCurveTo(cx + flameW / 2, cy, cx, cy + flameH / 2);
      ctx.closePath();
      ctx.fill();
    }
  }

  static _decalLightning(ctx, x, y, w, h) {
    const n = Math.max(1, Math.round(h / Math.max(8, w * 1.2)));
    ctx.fillStyle = "#ffe066";
    for (let i = 0; i < n; i++) {
      const cy = y + (h / n) * (i + 0.5);
      const cx = x + w / 2;
      const bh = (h / n) * 0.8, bw = w * 0.55;
      ctx.beginPath();
      ctx.moveTo(cx - bw * 0.1, cy - bh / 2);
      ctx.lineTo(cx + bw * 0.3, cy - bh * 0.1);
      ctx.lineTo(cx - bw * 0.05, cy - bh * 0.1);
      ctx.lineTo(cx + bw * 0.1, cy + bh / 2);
      ctx.lineTo(cx - bw * 0.3, cy + bh * 0.1);
      ctx.lineTo(cx + bw * 0.05, cy + bh * 0.1);
      ctx.closePath();
      ctx.fill();
    }
  }

  static _decalHeart(ctx, x, y, w, h) {
    const n = Math.max(1, Math.round(h / Math.max(8, w * 1.0)));
    ctx.fillStyle = "#ff3b5c";
    for (let i = 0; i < n; i++) {
      const cy = y + (h / n) * (i + 0.5);
      const cx = x + w / 2;
      const r = w * 0.22;
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.6);
      ctx.bezierCurveTo(cx - r * 1.4, cy - r * 0.8, cx - r * 0.4, cy - r * 1.6, cx, cy - r * 0.4);
      ctx.bezierCurveTo(cx + r * 0.4, cy - r * 1.6, cx + r * 1.4, cy - r * 0.8, cx, cy + r * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  static _drawMarker(ctx, x, y, color, text) {
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y); ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11); ctx.stroke();
    ctx.font = "11px 'Share Tech Mono', monospace"; ctx.fillText(text, x + 14, y + 4);
    ctx.restore();
  }

  /* ============================================================
     飛行画面: テレメトリ/風況UI更新
  ============================================================ */
  static updateTelemetryHUD(simState) {
    const alt = document.getElementById("tele-alt");
    const vel = document.getElementById("tele-vel");
    const time = document.getElementById("tele-time");
    if (alt) alt.textContent = Math.max(0, simState.y).toFixed(0);
    if (vel) vel.textContent = Math.hypot(simState.vx, simState.vy).toFixed(1);
    if (time) time.textContent = simState.t.toFixed(1);
  }

  static updateWindReadout(el, windState) {
    if (!el) return;
    const deg = (windState.dir * 180) / Math.PI;
    el.style.setProperty("--wind-angle", `${deg}deg`);
    el.textContent = `${windState.speed.toFixed(1)} m/s`;
  }

  static updateWindArrowSVG(svgEl, windState) {
    if (!svgEl) return;
    const deg = (windState.dir * 180) / Math.PI;
    svgEl.style.transform = `rotate(${deg}deg)`;
  }

  /* ============================================================
     ランキング表示
     ------------------------------------------------------------
     データは ranking-data.js の RANKING_DATA 配列（ユーザーが直接
     編集する想定）をスコア降順で並べ替えて表示するだけのシンプルな実装。
  ============================================================ */
  static renderRanking(containerEl) {
    const data = (typeof RANKING_DATA !== "undefined") ? RANKING_DATA : [];
    if (!data.length) {
      containerEl.innerHTML = `<div class="designs-empty">ランキングデータがありません。</div>`;
      return;
    }
    const sorted = [...data].sort((a, b) => b.score - a.score);
    containerEl.innerHTML = sorted.map((entry, i) => `
      <div class="ranking-row ${i < 3 ? "ranking-top" + (i + 1) : ""}">
        <span class="ranking-rank">${i + 1}</span>
        <span class="ranking-name">${entry.name}</span>
        <span class="ranking-stage">${entry.stage || ""}</span>
        <span class="ranking-score">${entry.score.toLocaleString()}</span>
      </div>
    `).join("");
  }
}
