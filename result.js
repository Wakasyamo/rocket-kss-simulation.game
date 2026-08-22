/*
  ファイル名: result.js
  依存関係: rocket.js（Rocket.parts, Engine情報）/ stage.js（Stage.clearGoal）
  ------------------------------------------------------------------
  script.jsの契約:
    Result.render(simState, rocket, stage)
      -> { cleared: true|false|null, score: number }
         cleared=null は「クリア目標なし（フリープレイ）」を表す。
    Result.exportDesignText(rocket, stage) -> string
    Result.buildShareText(simState, rocket, stage, score) -> string（共有テキストのみ生成）
    Result.shareResult(simState, rocket, stage, score) -> Promise<void>
      （Web Share API使用可否に関わらず、常にクリップボードへもコピーする）
  ------------------------------------------------------------------
  ※ 仕様変更によりCSV出力機能（Result.downloadCSV）は撤去した。
    飛行データのサンプリング(Physics.FlightRecorder)も不要になったため
    physics.js側もあわせて削除している。
*/

class Result {

  /* ============================================================
     resultStats構築（stage.js契約: {altitude, airtime, landingDistance}）
  ============================================================ */
  static _buildStats(simState) {
    return {
      altitude: simState.maxAltitude,
      airtime: simState.t,
      landingDistance: Math.abs(simState.x) // 発射地点からの着地水平距離
    };
  }

  /**
   * スコア = 最高高度 + 到達距離(最大水平移動量) + 滞空時間×4 + クリア達成ボーナス500
   */
  static _computeScore(simState, cleared) {
    const base = simState.maxAltitude + simState.maxDistance + simState.t * 4;
    const bonus = cleared === true ? 500 : 0;
    return Math.round(base + bonus);
  }

  /* ============================================================
     リザルト描画エントリポイント
  ============================================================ */
  static render(simState, rocket, stage) {
    const stats = this._buildStats(simState);
    // リタイア（途中切り上げ）した場合は目標を達成していても未達成扱いとする
    const cleared = simState.retired ? false : (stage.clearGoal ? stage.clearGoal.evaluate(stats) : null);
    const score = this._computeScore(simState, cleared);

    const statsEl = document.getElementById("result-stats");
    if (statsEl) {
      const rows = [
        { label: "最高高度", value: `${stats.altitude.toFixed(1)} m` },
        { label: "滞空時間", value: `${stats.airtime.toFixed(1)} s` },
        { label: "着地距離", value: `${stats.landingDistance.toFixed(1)} m` }
      ];
      statsEl.innerHTML = rows.map(r => `
        <div class="stat-cell">
          <span class="stat-label">${r.label}</span>
          <span class="stat-value">${r.value}</span>
        </div>`).join("");
    }

    const scoreEl = document.getElementById("result-score");
    if (scoreEl) scoreEl.textContent = score.toLocaleString();

    return { cleared, score };
  }

  /* ============================================================
     詳細設計パラメータ出力（テキスト）
  ============================================================ */
  static exportDesignText(rocket, stage) {
    const lines = [];
    lines.push("==================================================");
    lines.push(" ROCKET FORGE - 設計パラメーター出力");
    lines.push("==================================================");
    lines.push(`ステージ: ${stage.name}`);
    lines.push(`出力日時: ${new Date().toLocaleString()}`);
    lines.push("");
    lines.push("---- 部品別（先端(ノーズ先)基準の位置 x_ref） ----");
    rocket.parts.forEach(p => {
      lines.push(
        `[${p.type}] x_ref=${(p.x_ref * 100).toFixed(1)}cm  ` +
        `長さ=${(p.length * 100).toFixed(1)}cm  直径=${(p.diameter * 1000).toFixed(1)}mm  ` +
        `質量=${(p.mass * 1000).toFixed(2)}g` +
        (p.color ? `  色=${p.color}` : "") +
        (p.pattern && p.pattern !== "none" ? `  デカール=${p.pattern}` : "") +
        (p.finParams ? `  フィン枚数=${p.finParams.count}` : "")
      );
    });
    lines.push("");
    lines.push("---- 機体全体 ----");
    lines.push(`全長: ${(rocket.totalLength * 100).toFixed(1)} cm`);
    lines.push(`基準直径: ${rocket.diameter_mm.toFixed(1)} mm`);
    lines.push(`総質量: ${(rocket.totalMass * 1000).toFixed(1)} g`);
    lines.push(`重心(CG): 先端から ${(rocket.cg * 100).toFixed(1)} cm`);
    lines.push(`圧力中心(CP): 先端から ${(rocket.cp * 100).toFixed(1)} cm`);
    lines.push(`Static Margin: ${rocket.staticMargin.toFixed(2)} 口径`);
    lines.push(`総額: ¥${rocket.totalPrice.toLocaleString()}（予算 ${stage.budgetLabel}）`);
    lines.push("");
    lines.push("---- エンジン ----");
    lines.push(`コード: ${rocket.engine.code}`);
    lines.push(`全力積: ${rocket.engine.totalImpulse} Ns / 平均推力: ${rocket.engine.avgThrust} N / 展開遅延: ${rocket.engine.delay} s`);
    lines.push(`質量: ${(rocket.engine.mass * 1000).toFixed(1)} g / 価格: ¥${rocket.engine.price.toLocaleString()}`);
    lines.push("==================================================");
    return lines.join("\n");
  }

  /* ============================================================
     結果共有
     ------------------------------------------------------------
     ・navigator.share（Web Share API）が使える環境ではOS標準の
       シェアダイアログ（LINE/X等へ直接送れるUI）を呼び出す。
     ・その場でクリップボードにも常にコピーする（要件どおり、
       共有ボタン押下時は必ずクリップボードへも自動コピーする）。
     ・Web Share API非対応環境ではクリップボードコピーのみで完結する。
  ============================================================ */

  /** site運営者が差し替え可能な共有用URL。未設定なら現在ページのURLを使う。 */
  static shareUrl = "";

  /**
   * 指定フォーマットで共有テキストを生成する:
   *   高度: {高度}m / 滞空時間: {滞空時間}秒 / 到達時間: {到達時間}秒 /
   *   スコア: {スコア} / ステージ: {ステージ} / 結果: {成功/失敗} / URL: {URL}
   */
  static buildShareText(simState, rocket, stage, score) {
    const stats = this._buildStats(simState);
    const cleared = simState.retired ? false : (stage.clearGoal ? stage.clearGoal.evaluate(stats) : null);
    const resultLabel = simState.retired
      ? "リタイア"
      : (cleared === null ? "フリープレイ" : (cleared ? "ミッション成功" : "ミッション失敗"));
    const apogeeTime = (simState.apogeeTime != null ? simState.apogeeTime : stats.airtime).toFixed(1);
    const url = Result.shareUrl || (typeof window !== "undefined" ? window.location.href : "");

    return [
      `高度: ${stats.altitude.toFixed(1)}m`,
      `滞空時間: ${stats.airtime.toFixed(1)}秒`,
      `到達時間: ${apogeeTime}秒`,
      `スコア: ${score.toLocaleString()}`,
      `ステージ: ${stage.name}`,
      `結果: ${resultLabel}`,
      `URL: ${url}`
    ].join("\n");
  }

  static async shareResult(simState, rocket, stage, score) {
    const text = Result.buildShareText(simState, rocket, stage, score);

    // 常にクリップボードへコピーしておく（Web Share API利用可否に関わらず）
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch (e) {
      console.warn("クリップボードへのコピーに失敗しました:", e);
    }

    if (navigator.share) {
      try {
        await navigator.share({ title: "ROCKET FORGE", text });
        Result._toast(copied ? "共有しました（クリップボードにもコピー済み）" : "共有しました");
        return;
      } catch (e) {
        if (e && e.name === "AbortError") {
          // ユーザーがシェアダイアログをキャンセル。クリップボードには既にコピー済みなのでそれを伝える
          if (copied) Result._toast("結果をクリップボードにコピーしました");
          return;
        }
        // Web Share自体が失敗した場合はクリップボード結果のみ通知
      }
    }

    if (copied) {
      Result._toast("結果をクリップボードにコピーしました");
    } else {
      Result._toast("共有に失敗しました。手動でコピーしてください。");
    }
  }

  /** 簡易トースト通知（他画面に影響を与えない最小限の実装） */
  static _toast(message) {
    const el = document.createElement("div");
    el.textContent = message;
    el.style.cssText = `
      position:fixed; left:50%; bottom:24px; transform:translateX(-50%);
      background:rgba(13,20,32,0.95); color:#eae3d8; border:1px solid #ffd166;
      padding:10px 18px; font-size:0.85rem; z-index:999; pointer-events:none;
    `;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 2200);
  }
}
