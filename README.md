<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<title>ROCKET FORGE | ロケット設計・打ち上げシミュレーター</title>
<link rel="stylesheet" href="style.css" />
</head>
<body>

  <!-- =========================================================
       アプリ全体のルートコンテナ。GameManagerがここに各画面の
       表示/非表示を切り替えて描画する。
  ========================================================== -->
  <div id="app">

    <!-- ============================= -->
    <!-- 0. ローディング画面           -->
    <!-- ============================= -->
    <div id="screen-loading" class="screen active">
      <div class="loading-hud">
        <div class="loading-ring"></div>
        <p class="loading-text">SYSTEM BOOTING<span class="dots"></span></p>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 1. ホーム画面                 -->
    <!-- ============================= -->
    <div id="screen-home" class="screen">
      <canvas id="home-bg-canvas"></canvas>
      <div class="scanlines"></div>
      <div class="home-content">
        <div class="title-wrap">
          <h1 class="game-title">
            <span class="title-main">ROCKET&nbsp;FORGE</span>
            <span class="title-sub">ORBITAL DESIGN &amp; LAUNCH SIMULATOR</span>
          </h1>
        </div>
        <div class="home-menu">
          <button id="btn-goto-stage" class="hud-btn hud-btn-primary">
            <span class="btn-icon">▶</span> ステージ選択
          </button>
          <button id="btn-goto-rules" class="hud-btn">
            <span class="btn-icon">?</span> ルール説明
          </button>
        </div>
        <div class="home-footer">v1.0 // GITHUB PAGES BUILD</div>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 1b. ルール説明モーダル        -->
    <!-- ============================= -->
    <div id="modal-rules" class="modal hidden">
      <div class="modal-panel">
        <div class="modal-header">
          <span>MISSION BRIEFING</span>
          <button id="btn-close-rules" class="btn-close">×</button>
        </div>
        <div class="modal-body" id="rules-body">
          <!-- ui.js が内容を挿入 -->
        </div>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 2. ステージ選択画面           -->
    <!-- ============================= -->
    <div id="screen-stage" class="screen">
      <div class="topbar">
        <button class="hud-btn hud-btn-small" id="btn-stage-back">← ホーム</button>
        <h2 class="screen-title">STAGE SELECT</h2>
        <div class="topbar-spacer"></div>
      </div>
      <div id="stage-list" class="stage-list">
        <!-- stage.js / ui.js がステージカードを生成 -->
      </div>
    </div>

    <!-- ============================= -->
    <!-- 3. 設計画面                   -->
    <!-- ============================= -->
    <div id="screen-design" class="screen">
      <div class="topbar">
        <button class="hud-btn hud-btn-small" id="btn-design-back">← ステージ選択</button>
        <h2 class="screen-title" id="design-stage-name">DESIGN BAY</h2>
        <div class="budget-indicator" id="budget-indicator">
          <span class="budget-label">BUDGET</span>
          <span class="budget-value" id="budget-value">0 / 0</span>
        </div>
      </div>

      <div class="design-layout">

        <!-- 左: ロケットリアルタイム表示 -->
        <div class="design-left">
          <canvas id="rocket-preview-canvas"></canvas>
          <div class="preview-controls">
            <button id="btn-zoom-in" class="icon-btn">＋</button>
            <button id="btn-zoom-out" class="icon-btn">－</button>
          </div>
          <!-- 部品選択タブ -->
          <div class="part-selector" id="part-selector">
            <button class="part-btn active" data-part="nose">ノーズ</button>
            <button class="part-btn" data-part="body">ボディ</button>
            <button class="part-btn" data-part="fin">フィン</button>
            <button class="part-btn" data-part="parachute">パラシュート</button>
            <button class="part-btn" data-part="weight">おもり</button>
            <button class="part-btn" data-part="engine">エンジン</button>
          </div>
        </div>

        <!-- 右: パラメータ編集パネル -->
        <div class="design-right">
          <div class="panel-header">PARAMETER EDIT</div>
          <div id="param-panel" class="param-panel">
            <!-- ui.js が選択部品に応じて動的生成 -->
          </div>
        </div>

        <!-- 下: 詳細データ -->
        <div class="design-bottom">
          <div class="data-grid" id="data-grid">
            <!-- ui.js が生成: 質量/CG/CP/StaticMargin/価格 等 -->
          </div>
        </div>

        <!-- 左下: 性能バー -->
        <div class="design-perf">
          <div class="perf-row">
            <span class="perf-label">軽さ</span>
            <div class="perf-bar" id="perf-bar-light"></div>
          </div>
          <div class="perf-row">
            <span class="perf-label">強度</span>
            <div class="perf-bar" id="perf-bar-strength"></div>
          </div>
          <div class="perf-row">
            <span class="perf-label">安定性</span>
            <span class="perf-number" id="perf-stability">0.0 cal</span>
          </div>
        </div>
      </div>

      <div class="design-footer">
        <button id="btn-goto-launch" class="hud-btn hud-btn-primary">発射準備へ ▶</button>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 4. 発射準備画面               -->
    <!-- ============================= -->
    <div id="screen-launch" class="screen">
      <div class="topbar">
        <button class="hud-btn hud-btn-small" id="btn-launch-back">← 設計画面</button>
        <h2 class="screen-title">LAUNCH PREPARATION</h2>
        <div class="topbar-spacer"></div>
      </div>
      <div class="launch-layout">
        <canvas id="launch-preview-canvas"></canvas>
        <div class="launch-controls">
          <div class="control-block">
            <label for="angle-slider">発射角度 <span id="angle-value">0°</span></label>
            <input type="range" id="angle-slider" min="-45" max="45" value="0" step="1" />
          </div>
          <div class="control-block wind-info">
            <label>初期風況</label>
            <div id="wind-readout" class="wind-readout">-- m/s / --°</div>
          </div>
          <button id="btn-launch-go" class="hud-btn hud-btn-launch">
            <span class="btn-icon">🔥</span> LAUNCH
          </button>
        </div>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 5. シミュレーション画面       -->
    <!-- ============================= -->
    <div id="screen-sim" class="screen">
      <canvas id="sim-canvas"></canvas>
      <div class="sim-hud">
        <div class="sim-telemetry">
          <div class="tele-item"><span class="tele-label">ALT</span><span id="tele-alt" class="tele-value">0</span><span class="tele-unit">m</span></div>
          <div class="tele-item"><span class="tele-label">VEL</span><span id="tele-vel" class="tele-value">0</span><span class="tele-unit">m/s</span></div>
          <div class="tele-item"><span class="tele-label">T+</span><span id="tele-time" class="tele-value">0.0</span><span class="tele-unit">s</span></div>
        </div>
        <div class="sim-wind">
          <span class="tele-label">WIND</span>
          <span id="tele-wind" class="tele-value">0 m/s</span>
        </div>
      </div>
    </div>

    <!-- ============================= -->
    <!-- 6. リザルト画面               -->
    <!-- ============================= -->
    <div id="screen-result" class="screen">
      <canvas id="result-canvas"></canvas>
      <div class="result-panel">
        <h2 class="result-title">MISSION COMPLETE</h2>
        <div class="result-stats" id="result-stats">
          <!-- result.js が生成 -->
        </div>
        <div class="result-score">
          <span class="score-label">SCORE</span>
          <span class="score-value" id="result-score">0</span>
        </div>
        <div class="result-buttons">
          <button id="btn-result-retry" class="hud-btn">同じステージでリトライ</button>
          <button id="btn-result-stage" class="hud-btn hud-btn-primary">ステージ選択へ</button>
        </div>
      </div>
    </div>

  </div><!-- /#app -->

  <!-- =========================================================
       スクリプト読み込み順は依存関係の順（重要）:
       physics → rocket → stage → ui → result → script
  ========================================================== -->
  <script src="physics.js"></script>
  <script src="rocket.js"></script>
  <script src="stage.js"></script>
  <script src="ui.js"></script>
  <script src="result.js"></script>
  <script src="script.js"></script>
</body>
</html>
