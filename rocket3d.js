/* ============================================================
   ROCKET FORGE - rocket3d.js
   ------------------------------------------------------------
   設計画面のロケットを Three.js で3D表示するモジュール。
   ES Modules（<script type="module">）として読み込み、
   window.Rocket3DView に公開することで、他の classic script
   （script.js など）からも `new window.Rocket3DView(...)` の形で
   利用できるようにブリッジする。

   操作:
     - 左ドラッグ / 1本指ドラッグ : 回転（OrbitControls標準）
     - ホイール / ピンチ           : ズーム
     - 右ドラッグ / 2本指ドラッグ  : 平行移動（パン）
============================================================ */

import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";
import { OrbitControls } from "https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/controls/OrbitControls.js";

export class Rocket3DView {
  constructor(container) {
    this.container = container;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 100);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0x000000, 0); // 背景透過（CSSパネルを透かす）
    container.appendChild(this.renderer.domElement);

    // ---- 操作系（回転/ズーム/パン） ----
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.08;
    this.controls.maxDistance = 6;
    // 既定のボタン割当が要件と一致: LEFT=回転, RIGHT=パン, WHEEL/ピンチ=ズーム

    this._setupLights();

    this.rocketGroup = new THREE.Group();
    this.scene.add(this.rocketGroup);

    // 参考用の簡易グリッド（地面イメージ）
    const grid = new THREE.GridHelper(1.2, 16, 0x00e5ff, 0x0d2836);
    grid.material.transparent = true;
    grid.material.opacity = 0.25;
    this.scene.add(grid);
    this._grid = grid;

    this._cameraInitDone = false;
    this._running = true;

    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(container);
    this._onResize();

    this._animate();
  }

  _setupLights() {
    this.scene.add(new THREE.AmbientLight(0x8899aa, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 1.1);
    key.position.set(2, 3, 2);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x00e5ff, 0.7);
    rim.position.set(-2, 1, -2);
    this.scene.add(rim);
  }

  _onResize() {
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Rocketインスタンスの現在パラメータから3Dメッシュを再構築する。
   * パラメータが変わるたびに呼び出し、都度メッシュを作り直す
   * （部品数は少ないため、毎回破棄→再構築してもコストは軽微）。
   */
  update(rocket) {
    // 既存メッシュを破棄（デカールのCanvasTextureも合わせて解放し、
    // パラメータ変更のたびに呼ばれてもGPUメモリがリークしないようにする）
    while (this.rocketGroup.children.length) {
      const child = this.rocketGroup.children.pop();
      child.geometry?.dispose();
      child.material?.map?.dispose();
      child.material?.dispose();
    }

    const L = rocket.totalLength;
    const halfD = rocket.diameter / 2;
    // rocket.js側の「先端からの距離」座標系を、Three.jsの「Y=高さ(尾部0〜先端L)」に変換
    const toY = (distFromNose) => L - distFromNose;

    // ---- ノーズ（Latheで回転体を生成） ----
    const profile = [];
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const d = (rocket.nose.length * i) / steps;
      const r = Rocket3DView._noseRadiusAt(rocket.nose.shape, d, rocket.nose.length, halfD);
      profile.push(new THREE.Vector2(Math.max(0.0002, r), toY(d)));
    }
    const noseGeo = new THREE.LatheGeometry(profile, 28);
    const noseMat = new THREE.MeshStandardMaterial({ color: rocket.nose.color || "#e8f4f8", metalness: 0.1, roughness: 0.5 });
    if (rocket.decal?.scope === "whole") Rocket3DView._applyDecal(noseMat, rocket.nose.color || "#e8f4f8", rocket.decal.pattern);
    this.rocketGroup.add(new THREE.Mesh(noseGeo, noseMat));

    // ---- ボディ（上段） ----
    // 位置は toY() を使って汎用的に算出する（トランジション有効時は
    // ボディが最後尾ではなくなるため、0始まり固定では位置がズレるバグを修正）
    const bodyTopY = toY(rocket.nose.length);
    const bodyBotY = toY(rocket.nose.length + rocket.body.length);
    const bodyGeo = new THREE.CylinderGeometry(halfD, halfD, rocket.body.length, 28, 1, false);
    const bodyMat = new THREE.MeshStandardMaterial({ color: rocket.body.color || "#cfe8ee", metalness: 0.15, roughness: 0.55 });
    // デカール: scope="body"(既定)なら常にボディへ、"whole"ならノーズ/フィンにも適用される
    if (rocket.decal && rocket.decal.pattern !== "none") {
      Rocket3DView._applyDecal(bodyMat, rocket.body.color || "#cfe8ee", rocket.decal.pattern);
    }
    const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
    bodyMesh.position.y = (bodyTopY + bodyBotY) / 2;
    this.rocketGroup.add(bodyMesh);

    // ---- トランジション + 下段ボディ（有効時のみ） ----
    if (rocket.transitionEnabled) {
      const halfFront = rocket.transition.diameterFront / 2;
      const halfBack = rocket.transition.diameterBack / 2;
      const transTopY = bodyBotY;
      const transBotY = toY(rocket.nose.length + rocket.body.length + rocket.transition.length);
      // CylinderGeometryは上下で異なる半径を指定できるためテーパー形状をそのまま表現できる
      const transGeo = new THREE.CylinderGeometry(halfFront, halfBack, rocket.transition.length, 28, 1, false);
      const transMat = new THREE.MeshStandardMaterial({ color: rocket.transition.color || "#cfe8ee", metalness: 0.15, roughness: 0.55 });
      const transMesh = new THREE.Mesh(transGeo, transMat);
      transMesh.position.y = (transTopY + transBotY) / 2;
      this.rocketGroup.add(transMesh);

      const lowerTopY = transBotY;
      const lowerBotY = toY(rocket.nose.length + rocket.body.length + rocket.transition.length + rocket.bodyLower.length);
      const lowerGeo = new THREE.CylinderGeometry(halfBack, halfBack, rocket.bodyLower.length, 28, 1, false);
      const lowerMat = new THREE.MeshStandardMaterial({ color: rocket.bodyLower.color || "#cfe8ee", metalness: 0.15, roughness: 0.55 });
      if (rocket.decal && rocket.decal.pattern !== "none") {
        Rocket3DView._applyDecal(lowerMat, rocket.bodyLower.color || "#cfe8ee", rocket.decal.pattern);
      }
      const lowerMesh = new THREE.Mesh(lowerGeo, lowerMat);
      lowerMesh.position.y = (lowerTopY + lowerBotY) / 2;
      this.rocketGroup.add(lowerMesh);
    }

    // ---- フィン（台形を押し出して n枚を等間隔配置） ----
    const { a, b, s, m } = rocket.fins.geometry;
    const finRootY = toY(rocket.finRootLeadingEdgeX);
    const shape = new THREE.Shape();
    shape.moveTo(halfD, 0);
    shape.lineTo(halfD, -a);
    shape.lineTo(halfD + s, -(m + b));
    shape.lineTo(halfD + s, -m);
    shape.closePath();
    const thickness = 0.003;
    const finGeo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false });
    finGeo.translate(0, finRootY, -thickness / 2);
    const finMat = new THREE.MeshStandardMaterial({
      color: rocket.fins.color || "#3fb8d6", metalness: 0.2, roughness: 0.4,
      emissive: 0x004450, emissiveIntensity: 0.25
    });
    if (rocket.decal?.scope === "whole") Rocket3DView._applyDecal(finMat, rocket.fins.color || "#3fb8d6", rocket.decal.pattern);
    for (let i = 0; i < rocket.fins.count; i++) {
      const mesh = new THREE.Mesh(finGeo, finMat);
      mesh.rotation.y = (i * Math.PI * 2) / rocket.fins.count;
      this.rocketGroup.add(mesh);
    }

    // ---- パラシュート（折り畳み状態の簡易表現） ----
    const chuteY = toY(rocket.nose.length + rocket.body.length * 0.25);
    const chuteGeo = new THREE.SphereGeometry(halfD * 0.9, 12, 8);
    const chuteMat = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, roughness: 0.6 });
    const chuteMesh = new THREE.Mesh(chuteGeo, chuteMat);
    chuteMesh.position.y = chuteY;
    this.rocketGroup.add(chuteMesh);

    // ---- おもり ----
    const weightY = toY(rocket.weight.position);
    const weightGeo = new THREE.SphereGeometry(Math.max(0.004, halfD * 0.4), 10, 8);
    const weightMat = new THREE.MeshStandardMaterial({ color: 0x999999, metalness: 0.8, roughness: 0.3 });
    const weightMesh = new THREE.Mesh(weightGeo, weightMat);
    weightMesh.position.y = weightY;
    this.rocketGroup.add(weightMesh);

    // ---- エンジン（全長7cm固定。尾部(y=0)を基準に配置） ----
    const engineGeo = new THREE.CylinderGeometry(halfD * 0.7, halfD * 0.7, rocket.engine.length, 16);
    const engineMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.5, roughness: 0.5 });
    const engineMesh = new THREE.Mesh(engineGeo, engineMat);
    engineMesh.position.y = rocket.engine.length / 2;
    this.rocketGroup.add(engineMesh);

    // ---- CG / CP マーカー（リング） ----
    // ※ rocket.js の契約プロパティ名は cg/cp（centerOfGravity/centerOfPressureではない）
    const cgY = toY(rocket.cg);
    const cpY = toY(rocket.cp);
    this.rocketGroup.add(Rocket3DView._makeMarkerRing(halfD * 1.35, 0xffb020, cgY));
    this.rocketGroup.add(Rocket3DView._makeMarkerRing(halfD * 1.35, 0xff3b5c, cpY));

    // ---- 全体を原点中心に配置し、初回のみカメラを自動フレーミング ----
    this.rocketGroup.position.y = -L / 2;
    if (this._grid) this._grid.position.y = -L / 2 - 0.01;

    if (!this._cameraInitDone) {
      const dist = Math.max(0.3, L * 1.9);
      this.camera.position.set(dist * 0.55, dist * 0.3, dist * 0.65);
      this.controls.target.set(0, 0, 0);
      this._cameraInitDone = true;
    }
    this.controls.update();
  }

  static _makeMarkerRing(radius, color, y) {
    const geo = new THREE.TorusGeometry(radius, Math.max(0.0006, radius * 0.05), 8, 32);
    const mat = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.y = y;
    return mesh;
  }

  /**
   * デカール（模様）をCanvasTextureとして手続き的に生成し、マテリアルに適用する。
   * 外部画像アセットを使わず、ベースカラーの上に模様を描いた1枚のテクスチャを
   * material.map として差し替えることで実現する（material.color は白のまま
   * テクスチャの色をそのまま表示させる）。
   * @param material 対象のMeshStandardMaterial（このメソッド内でmapを差し替える）
   * @param baseColorHex パーツの現在のカラー（背景色として使用）
   * @param pattern DECAL_PATTERNS のキー（'fire'|'lightning'|'heart'|'none'）
   */
  static _applyDecal(material, baseColorHex, pattern) {
    if (!pattern || pattern === "none") return;
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size * 2; // 円筒に巻き付けたとき縦長に見えるよう2:1
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = baseColorHex;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    if (pattern === "fire") Rocket3DView._paintFire(ctx, canvas.width, canvas.height);
    else if (pattern === "lightning") Rocket3DView._paintLightning(ctx, canvas.width, canvas.height);
    else if (pattern === "heart") Rocket3DView._paintHeart(ctx, canvas.width, canvas.height);

    const tex = new THREE.CanvasTexture(canvas);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(3, 2); // 円筒の円周方向に3回、長さ方向に2回タイル
    material.map = tex;
    material.color.set(0xffffff); // テクスチャの色をそのまま出すため地色は白に
    material.needsUpdate = true;
  }

  /** 🔥 ファイヤーパターン: 下から上へ伸びる炎のシルエットを並べる */
  static _paintFire(ctx, w, h) {
    const colors = ["#ffb020", "#ff7a30", "#ffe08a"];
    for (let i = 0; i < 5; i++) {
      const cx = (w / 5) * i + w / 10;
      ctx.fillStyle = colors[i % colors.length];
      ctx.beginPath();
      ctx.moveTo(cx, h);
      ctx.quadraticCurveTo(cx - w * 0.09, h * 0.55, cx, h * 0.15);
      ctx.quadraticCurveTo(cx + w * 0.09, h * 0.55, cx, h);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** ⚡ 稲妻パターン: ジグザグの雷模様を並べる */
  static _paintLightning(ctx, w, h) {
    ctx.strokeStyle = "#ffe066";
    ctx.fillStyle = "#ffe066";
    ctx.lineWidth = w * 0.05;
    for (let i = 0; i < 3; i++) {
      const cx = (w / 3) * i + w / 6;
      ctx.beginPath();
      ctx.moveTo(cx - 10, 10);
      ctx.lineTo(cx + 20, h * 0.4);
      ctx.lineTo(cx - 5, h * 0.4);
      ctx.lineTo(cx + 15, h - 10);
      ctx.lineTo(cx - 25, h * 0.6);
      ctx.lineTo(cx + 5, h * 0.6);
      ctx.closePath();
      ctx.fill();
    }
  }

  /** ❤ ハートパターン: ベジェ曲線のハート形を並べる */
  static _paintHeart(ctx, w, h) {
    ctx.fillStyle = "#ff3b5c";
    const positions = [[w * 0.25, h * 0.3], [w * 0.75, h * 0.3], [w * 0.5, h * 0.7]];
    positions.forEach(([cx, cy]) => {
      const r = w * 0.12;
      ctx.beginPath();
      ctx.moveTo(cx, cy + r * 0.6);
      ctx.bezierCurveTo(cx - r * 1.4, cy - r * 0.8, cx - r * 0.4, cy - r * 1.6, cx, cy - r * 0.4);
      ctx.bezierCurveTo(cx + r * 0.4, cy - r * 1.6, cx + r * 1.4, cy - r * 0.8, cx, cy + r * 0.6);
      ctx.closePath();
      ctx.fill();
    });
  }

  /** ノーズ形状ごとの半径プロファイル r(d)。d=先端からの距離, L=ノーズ長, R=基部半径 */
  static _noseRadiusAt(shapeName, d, L, R) {
    if (L <= 0) return R;
    if (shapeName === "円錐") {
      return R * (d / L);
    }
    if (shapeName === "楕円") {
      const t = (L - d) / L;
      return R * Math.sqrt(Math.max(0, 1 - t * t));
    }
    // オジーブ: tangent ogive の標準式
    const rho = (R * R + L * L) / (2 * R);
    const x = L - d;
    return Math.sqrt(Math.max(0, rho * rho - x * x)) - (rho - R);
  }

  _animate() {
    if (!this._running) return;
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
    requestAnimationFrame(() => this._animate());
  }

  /** 画面を離れる際に呼び出し、レンダリングループとGPUリソースを解放する */
  dispose() {
    this._running = false;
    this._resizeObserver.disconnect();
    this.controls.dispose();
    this.rocketGroup.children.forEach(c => { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose(); });
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }
}

// classic script（script.js等）から利用できるようグローバルへ公開
window.Rocket3DView = Rocket3DView;
