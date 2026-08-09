/*
  ファイル名: result.js
  依存関係: physics.js（FlightRecorder.toArrays）/ rocket.js（Rocket.parts,
            Engine情報）/ stage.js（Stage.clearGoal）
  ------------------------------------------------------------------
  script.jsの契約:
    Result.render(simState, rocket, stage, flightRecorder)
      -> { cleared: true|false|null, score: number }
         cleared=null は「クリア目標なし（フリープレイ）」を表す。
    Result.exportDesignText(rocket, stage) -> string
    Result.downloadCSV(flightRecorder) -> void（ブラウザにダウンロードさせる）
    Result.shareResult(simState, stage, score) -> Promise<void>
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
  static render(simState, rocket, stage, flightRecorder) {
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
     CSV出力（時間/加速度/速度/位置）
  ============================================================ */
  static downloadCSV(flightRecorder) {
    if (!flightRecorder) { console.warn("flightRecorderがありません"); return; }
    const arr = flightRecorder.toArrays();
    const header = "t[s],x[m],y[m],vx[m/s],vy[m/s],ax[m/s2],ay[m/s2]";
    const rows = arr.t.map((_, i) =>
      [arr.t[i], arr.x[i], arr.y[i], arr.vx[i], arr.vy[i], arr.ax[i], arr.ay[i]]
        .map(v => v.toFixed(4)).join(",")
    );
    const csv = [header, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `rocket-forge-flight-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /* ============================================================
     結果共有（Web Share API → だめならクリップボードにフォールバック）
  ============================================================ */
  static async shareResult(simState, stage, score) {
    const stats = this._buildStats(simState);
    const text =
      `🚀 ROCKET FORGE - ${stage.name}\n` +
      `最高高度: ${stats.altitude.toFixed(1)}m / 滞空時間: ${stats.airtime.toFixed(1)}s / スコア: ${score.toLocaleString()}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: "ROCKET FORGE", text });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return; // ユーザーがキャンセルした場合は何もしない
        // 共有に失敗した場合はクリップボードにフォールバック
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      Result._toast("結果をクリップボードにコピーしました");
    } catch (e) {
      Result._toast("共有に失敗しました。手動でコピーしてください。");
      console.error("shareResult failed:", e);
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
