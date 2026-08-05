/* ==================================================================
   CREATE YOUR FISH — draw-in-browser tool
   Exposes window.FishDrawTool = {
     mount(container, lang, onSubmit, onBack), setLanguage(lang)
   }
   onSubmit is called (no arguments) after "Submit My Fish" has
   downloaded the flattened PNG — the host page decides what "submit"
   actually means (e.g. switching to its own upload screen).
   onBack is called (no arguments) by the tool's own internal Back
   button, shown only on desktop (bottom of the Template column) —
   the host page still owns its own external Back button for mobile,
   this is purely an additional trigger for the same action.

   Not loaded on page load — index.html only injects this file (and
   its stylesheet) the first time someone opens the "Draw it myself"
   option, so nobody pays for it who doesn't use it. The five
   template images it needs are real files under images/draw-templates/
   and are only fetched once the template picker actually renders
   them as thumbnails.
   ================================================================== */
(function () {
  const W = 900, H = 620;
  const ASSET_PATH = "images/";

  const TEMPLATES = [
    { key: "blank", blank: true },
    { key: "fish1", slug: "fish-1" },
    { key: "shark", slug: "shark" },
    { key: "whale", slug: "whale" },
    { key: "stingray", slug: "stingray" },
  ];
  TEMPLATES.forEach((t) => {
    if (t.blank) return; // no art files to build paths for — see build()
    t.lineArt = ASSET_PATH + t.slug + "-lineart.png";
    t.autofillMask = ASSET_PATH + t.slug + "-autofill.png";
    t.cleanMask = ASSET_PATH + t.slug + "-clean.png";
  });

  const layerDefs = [
    { id: "accent", key: "accentColors" },
    { id: "base", key: "baseColor" },
    { id: "template", key: "fishTemplate", locked: true },
  ];

  /* All visitor-facing text for this tool, in both languages. Kept
     in the same shape/spirit as the TEXT table in index.html. */
  const STRINGS = {
    en: {
      title: "Draw your fish",
      templateLabel: "Template",
      layersLabel: "Layers",
      templateNames: { fish1: "Fish", shark: "Shark", whale: "Whale", stingray: "Stingray", blank: "Open Canvas" },
      layerNames: { accentColors: "Accent Colors", baseColor: "Base Color", fishTemplate: "Fish Template" },
      locked: "locked",
      colorLabel: "Color",
      autofill: "Auto-fill",
      clean: "Clean lines",
      drawLabel: "Draw",
      brush: "Brush",
      eraser: "Eraser",
      sizeLabel: "Size",
      undo: "Undo",
      clearLayer: "Clear layer",
      submit: "Submit My Fish",
      backBtn: "Back",
      tourBtnTitle: "How it works",
      tourSkip: "Skip tour",
      tourBack: "Back",
      tourNext: "Next",
      tourDone: "Done",
      pickTemplateAlert: "Pick a template first.",
      blankNoMask: "Not available on the open canvas — there's no outline to fill or clip to.",
      submitStub: "Your fish has been downloaded \u2014 automatic submission isn\u2019t connected yet, so please submit it through the existing form.",
      tourSteps: [
        { sel: ".dyf-template-sidebar", title: "1. Pick a template",
          text: "Start here \u2014 choose a fish shape to draw on, or pick Open Canvas to start from scratch. This loads its outline (if any) onto the locked Fish Template layer." },
        { sel: ".dyf-stage", title: "2. Your canvas",
          text: "Draw directly on the template with a mouse, a finger, or a pressure-sensitive pen." },
        { sel: ".dyf-row-color", title: "3. Choose a color",
          text: "Pick a preset swatch, or use the color wheel for something custom." },
        { sel: ".dyf-row-fillclean", title: "4. Fill & clean",
          text: "Auto-fill quickly fills the whole body in your chosen color. Clean lines trims off any strokes that spilled outside the template." },
        { sel: ".dyf-row-draw", title: "5. Draw",
          text: "Switch between Brush and Eraser, and adjust Size for fine details or bold strokes." },
        { sel: ".dyf-layer-sidebar", title: "6. Layers",
          text: "Accent Colors sit on top, for fins, spots, and details. Base Color is the main body underneath. Fish Template stays locked at the bottom as your guide." },
        { sel: ".dyf-row-undoclear", title: "7. Undo & clear",
          text: "Undo steps back one stroke at a time. Clear layer wipes only the layer you're currently working on." },
        { sel: ".dyf-row-finish", title: "8. Finish up",
          text: "Submit My Fish downloads your finished piece and sends it straight in for review." },
      ],
    },
    fr: {
      title: "Dessine ton poisson",
      templateLabel: "Mod\u00e8le",
      layersLabel: "Calques",
      templateNames: { fish1: "Poisson", shark: "Requin", whale: "Baleine", stingray: "Raie", blank: "Toile libre" },
      layerNames: { accentColors: "Couleurs d'accent", baseColor: "Couleur de base", fishTemplate: "Mod\u00e8le de poisson" },
      locked: "verrouill\u00e9",
      colorLabel: "Couleur",
      autofill: "Remplissage auto",
      clean: "Nettoyer lignes",
      drawLabel: "Dessiner",
      brush: "Pinceau",
      eraser: "Gomme",
      sizeLabel: "Taille",
      undo: "Annuler",
      clearLayer: "Effacer le calque",
      submit: "Soumettre mon poisson",
      backBtn: "Retour",
      tourBtnTitle: "Comment \u00e7a marche",
      tourSkip: "Passer la visite",
      tourBack: "Retour",
      tourNext: "Suivant",
      tourDone: "Termin\u00e9",
      pickTemplateAlert: "Choisis d'abord un mod\u00e8le.",
      blankNoMask: "Non disponible sur la toile libre \u2014 il n'y a pas de contour \u00e0 remplir ou \u00e0 d\u00e9couper.",
      submitStub: "Ton poisson a \u00e9t\u00e9 t\u00e9l\u00e9charg\u00e9 \u2014 la soumission automatique n'est pas encore branch\u00e9e, alors soumets-le via le formulaire existant.",
      tourSteps: [
        { sel: ".dyf-template-sidebar", title: "1. Choisis un mod\u00e8le",
          text: "Commence ici \u2014 choisis une forme de poisson sur laquelle dessiner, ou choisis Toile libre pour repartir de z\u00e9ro. Son contour (le cas \u00e9ch\u00e9ant) se place sur le calque verrouill\u00e9 Mod\u00e8le de poisson." },
        { sel: ".dyf-stage", title: "2. Ta toile",
          text: "Dessine directement sur le mod\u00e8le avec une souris, un doigt, ou un stylet sensible \u00e0 la pression." },
        { sel: ".dyf-row-color", title: "3. Choisis une couleur",
          text: "Choisis une teinte pr\u00e9d\u00e9finie, ou utilise la roue des couleurs pour une teinte personnalis\u00e9e." },
        { sel: ".dyf-row-fillclean", title: "4. Remplir et nettoyer",
          text: "Remplissage auto remplit rapidement tout le corps avec la couleur choisie. Nettoyer lignes retire les traits qui d\u00e9bordent du mod\u00e8le." },
        { sel: ".dyf-row-draw", title: "5. Dessiner",
          text: "Passe du Pinceau \u00e0 la Gomme, et ajuste la Taille pour des d\u00e9tails fins ou des traits plus larges." },
        { sel: ".dyf-layer-sidebar", title: "6. Calques",
          text: "Couleurs d'accent se trouve au-dessus, pour les nageoires, taches et d\u00e9tails. Couleur de base est le corps principal en dessous. Mod\u00e8le de poisson reste verrouill\u00e9 tout en bas comme guide." },
        { sel: ".dyf-row-undoclear", title: "7. Annuler et effacer",
          text: "Annuler recule d'un trait \u00e0 la fois. Effacer le calque efface seulement le calque sur lequel tu travailles." },
        { sel: ".dyf-row-finish", title: "8. Termine ton poisson",
          text: "Soumettre mon poisson t\u00e9l\u00e9charge ta cr\u00e9ation et l'envoie directement pour r\u00e9vision." },
      ],
    },
  };

  let mounted = false;
  let currentLang = "en";
  let root = null;
  let onSubmit = null; // host page's callback for "Submit My Fish", set via mount()
  let onBack = null; // host page's callback for the desktop-only internal Back button
  const state = {}; // populated on mount: DOM refs, layers, tour, etc.

  function markup() {
    return `
      <button class="tour-btn dyf-tour-btn" type="button" aria-label="" title=""><span aria-hidden="true">i</span></button>
      <h1 class="dyf-h1"></h1>
      <div class="tour-dim dyf-tour-dim">
        <div class="spotlight dyf-spotlight"></div>
        <div class="tour-card dyf-tour-card">
          <button class="tour-skip dyf-tour-skip" type="button"></button>
          <h3 class="dyf-tour-title"></h3>
          <p class="dyf-tour-text"></p>
          <div class="tour-controls">
            <div class="tour-dots dyf-tour-dots"></div>
            <div class="tour-buttons">
              <button class="dyf-tour-back" type="button"></button>
              <button class="next dyf-tour-next" type="button"></button>
            </div>
          </div>
        </div>
      </div>
      <div class="toast dyf-toast" role="status" aria-live="polite"></div>
      <div class="workspace">
        <div class="side-panel dyf-template-sidebar">
          <span class="row-label dyf-template-label"></span>
          <div class="pick-strip dyf-template-strip"></div>
          <div class="row dyf-row-back">
            <button class="tool primary dyf-menu-btn dyf-back-btn" type="button">
              <span class="dyf-menu-btn-inlay dyf-back-inlay"><span class="dyf-back-text"></span></span>
            </button>
          </div>
        </div>
        <div class="center-column">
          <div class="stage dyf-stage">
            <canvas class="draw-surface dyf-canvas-base" width="900" height="620"></canvas>
            <canvas class="draw-surface dyf-canvas-accent" width="900" height="620"></canvas>
            <canvas class="draw-surface dyf-canvas-template" width="900" height="620"></canvas>
            <div class="brush-cursor dyf-brush-cursor"></div>
          </div>
          <div class="panel">
            <div class="row dyf-row-color">
              <span class="row-label dyf-color-label"></span>
              <div class="row swatches dyf-swatches">
                <input type="color" class="dyf-custom-color" title="Custom color" value="#ff5c5c">
              </div>
            </div>
            <div class="row dyf-row-fillclean">
              <button class="tool dyf-autofill-btn" type="button"></button>
              <button class="tool dyf-clean-btn" type="button"></button>
            </div>
            <div class="row dyf-row-draw">
              <span class="row-label dyf-draw-label"></span>
              <button class="tool active dyf-brush-btn" type="button"></button>
              <button class="tool dyf-eraser-btn" type="button"></button>
              <label class="small dyf-size-label"> <input type="range" class="dyf-size" min="2" max="40" value="10"></label>
            </div>
            <div class="row dyf-row-undoclear">
              <button class="tool dyf-undo-btn" type="button"></button>
              <button class="tool dyf-clear-btn" type="button"></button>
            </div>
          </div>
        </div>
        <div class="side-panel dyf-layer-sidebar">
          <div class="dyf-layer-panel">
            <span class="row-label dyf-layers-label"></span>
            <div class="pick-strip dyf-layer-grid"></div>
          </div>
          <div class="row dyf-row-finish">
            <button class="tool primary dyf-menu-btn dyf-submit-btn" type="button">
              <span class="dyf-menu-btn-inlay dyf-submit-inlay"><span class="dyf-submit-text"></span></span>
            </button>
          </div>
        </div>
      </div>
    `;
  }

  function q(sel) { return root.querySelector(sel); }

  // Non-blocking status message — see the .toast rules in the
  // stylesheet for why this replaces alert(). Longer messages (the
  // submit stub) get more time on screen via the duration argument.
  let toastTimer = null;
  function showToast(message, duration = 3400) {
    const toast = q(".dyf-toast");
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), duration);
  }

  function build() {
    const s = state;
    // Let people dismiss the toast early instead of waiting it out
    q(".dyf-toast").addEventListener("click", () => {
      q(".dyf-toast").classList.remove("show");
      clearTimeout(toastTimer);
    });
    s.stage = q(".dyf-stage");
    s.baseCanvas = q(".dyf-canvas-base");
    s.accentCanvas = q(".dyf-canvas-accent");
    s.templateCanvas = q(".dyf-canvas-template");

    s.layers = layerDefs.map((def) => {
      const canvas = def.id === "accent" ? s.accentCanvas : def.id === "base" ? s.baseCanvas : s.templateCanvas;
      return { ...def, canvas, ctx: canvas.getContext("2d"), undoStack: [] };
    });
    function layerByCanvasZOrder(id) { return s.layers.find((l) => l.id === id); }
    s.layerByCanvasZOrder = layerByCanvasZOrder;

    s.activeLayer = s.layers.findIndex((l) => l.id === "base");
    s.activeTemplate = null;

    s.templateSidebar = q(".dyf-template-sidebar");
    s.templateStrip = q(".dyf-template-strip");
    s.layerSidebar = q(".dyf-layer-sidebar");
    s.layerGrid = q(".dyf-layer-grid");

    function loadImg(src) {
      const img = new Image();
      img.onerror = () => console.warn("[Feeling Fishy draw tool] couldn't load template image:", src);
      img.src = src;
      return img;
    }
    TEMPLATES.forEach((t) => {
      if (t.blank) return; // nothing to preload — chooseTemplate() leaves the layer empty
      t.lineArtImg = loadImg(t.lineArt);
      t.autofillMaskImg = loadImg(t.autofillMask);
      t.cleanMaskImg = loadImg(t.cleanMask);
    });

    function imagePlacement(img) {
      const scale = Math.min((W - 60) / img.naturalWidth, (H - 60) / img.naturalHeight);
      const w = img.naturalWidth * scale, h = img.naturalHeight * scale;
      return { x: (W - w) / 2, y: (H - h) / 2, w, h };
    }
    s.imagePlacement = imagePlacement;

    function updateThumb(idx) {
      const l = s.layers[idx];
      l.thumbCtx.clearRect(0, 0, 180, 126);
      l.thumbCtx.fillStyle = "#fff";
      l.thumbCtx.fillRect(0, 0, 180, 126);
      const scale = Math.min(180 / W, 126 / H);
      const dw = W * scale, dh = H * scale;
      l.thumbCtx.drawImage(l.canvas, (180 - dw) / 2, (126 - dh) / 2, dw, dh);
    }
    s.updateThumb = updateThumb;
    function updateAllThumbs() { s.layers.forEach((_, i) => updateThumb(i)); }

    s.layers.forEach((l, idx) => {
      const btn = document.createElement("button");
      btn.className = "pick-btn" + (idx === s.activeLayer ? " active" : "") + (l.locked ? " locked" : "");
      const thumb = document.createElement("canvas");
      thumb.className = "pick-thumb";
      thumb.width = 180; thumb.height = 126;
      const label = document.createElement("span");
      label.className = "pick-name";
      const nameSpan = document.createElement("span");
      nameSpan.className = "dyf-layer-name";
      label.appendChild(nameSpan);
      if (l.locked) {
        const tag = document.createElement("span");
        tag.className = "lock-tag dyf-lock-tag";
        label.appendChild(tag);
      }
      btn.appendChild(thumb);
      btn.appendChild(label);
      btn.addEventListener("click", () => { if (l.locked) return; setActiveLayer(idx); });
      s.layerGrid.appendChild(btn);
      l.thumbCtx = thumb.getContext("2d");
      l.btn = btn;
      l.nameEl = nameSpan;
    });

    function setActiveLayer(i) {
      s.activeLayer = i;
      s.layers.forEach((l, idx) => { l.canvas.style.pointerEvents = (idx === s.activeLayer && !l.locked) ? "auto" : "none"; });
      s.layers.forEach((l, idx) => l.btn.classList.toggle("active", idx === s.activeLayer));
    }
    s.setActiveLayer = setActiveLayer;
    setActiveLayer(s.activeLayer);
    updateAllThumbs();

    function chooseTemplate(t) {
      s.activeTemplate = t;
      const templateLayer = layerByCanvasZOrder("template");
      templateLayer.undoStack.push(templateLayer.ctx.getImageData(0, 0, W, H));
      templateLayer.ctx.clearRect(0, 0, W, H);
      if (!t.blank) {
        const p = imagePlacement(t.lineArtImg);
        templateLayer.ctx.drawImage(t.lineArtImg, p.x, p.y, p.w, p.h);
      }
      updateThumb(s.layers.indexOf(templateLayer));
      [...s.templateSidebar.querySelectorAll(".pick-btn")].forEach((b) => b.classList.remove("active"));
      t.pickerBtn.classList.add("active");
      updateFillCleanAvailability();
    }
    s.chooseTemplate = chooseTemplate;

    // Auto-fill and Clean both depend on a body/outline mask that the
    // open canvas doesn't have, so they're disabled (not just toast-
    // blocked) whenever it's the active "template".
    function updateFillCleanAvailability() {
      const blank = !!(s.activeTemplate && s.activeTemplate.blank);
      autofillBtn.disabled = blank;
      cleanBtn.disabled = blank;
      autofillBtn.title = blank ? STRINGS[currentLang].blankNoMask : "";
      cleanBtn.title = blank ? STRINGS[currentLang].blankNoMask : "";
    }
    s.updateFillCleanAvailability = updateFillCleanAvailability;

    TEMPLATES.forEach((t) => {
      const btn = document.createElement("button");
      btn.className = "pick-btn";
      const thumb = document.createElement("canvas");
      thumb.className = "pick-thumb";
      thumb.width = 180; thumb.height = 126;
      const label = document.createElement("span");
      label.className = "pick-name dyf-template-name";
      btn.appendChild(thumb);
      btn.appendChild(label);
      btn.addEventListener("click", () => chooseTemplate(t));
      s.templateStrip.appendChild(btn);
      t.pickerBtn = btn;
      t.nameEl = label;
      if (t.blank) {
        // No art to load — draw a plain dashed card so the option
        // reads as "empty" rather than looking like a broken thumbnail.
        const tctx = thumb.getContext("2d");
        tctx.fillStyle = "#fff";
        tctx.fillRect(0, 0, 180, 126);
        tctx.strokeStyle = "#c9c9c9";
        tctx.setLineDash([6, 5]);
        tctx.lineWidth = 3;
        tctx.strokeRect(10, 10, 160, 106);
        return;
      }
      t.lineArtImg.onload = () => {
        const tctx = thumb.getContext("2d");
        tctx.fillStyle = "#fff";
        tctx.fillRect(0, 0, 180, 126);
        const scale = Math.min(168 / t.lineArtImg.naturalWidth, 114 / t.lineArtImg.naturalHeight);
        const dw = t.lineArtImg.naturalWidth * scale, dh = t.lineArtImg.naturalHeight * scale;
        tctx.drawImage(t.lineArtImg, (180 - dw) / 2, (126 - dh) / 2, dw, dh);
      };
    });

    const autofillBtn = q(".dyf-autofill-btn");
    const cleanBtn = q(".dyf-clean-btn");
    autofillBtn.addEventListener("click", () => {
      if (!s.activeTemplate || s.activeTemplate.blank) { showToast(STRINGS[currentLang].pickTemplateAlert); return; }
      const baseIdx = s.layers.findIndex((l) => l.id === "base");
      setActiveLayer(baseIdx);
      pushUndo();
      const l = s.layers[baseIdx];
      l.ctx.clearRect(0, 0, W, H);
      const p = imagePlacement(s.activeTemplate.autofillMaskImg);
      l.ctx.save();
      l.ctx.globalAlpha = 1;
      l.ctx.drawImage(s.activeTemplate.autofillMaskImg, p.x, p.y, p.w, p.h);
      l.ctx.globalCompositeOperation = "source-atop";
      l.ctx.fillStyle = s.currentColor;
      l.ctx.fillRect(p.x, p.y, p.w, p.h);
      l.ctx.restore();
      updateThumb(baseIdx);
    });

    cleanBtn.addEventListener("click", () => {
      if (!s.activeTemplate || s.activeTemplate.blank) { showToast(STRINGS[currentLang].pickTemplateAlert); return; }
      const p = imagePlacement(s.activeTemplate.cleanMaskImg);
      ["base", "accent"].forEach((id) => {
        const idx = s.layers.findIndex((l) => l.id === id);
        const l = s.layers[idx];
        l.undoStack.push(l.ctx.getImageData(0, 0, W, H));
        l.ctx.save();
        l.ctx.globalCompositeOperation = "destination-in";
        l.ctx.drawImage(s.activeTemplate.cleanMaskImg, p.x, p.y, p.w, p.h);
        l.ctx.restore();
        updateThumb(idx);
      });
    });

    const colors = ["#0a0a0a", "#ffffff", "#ff5c5c", "#ffe14d", "#3fd8c4", "#4da6ff", "#a06bff", "#ef6fa8"];
    s.currentColor = colors[0];
    const swatchWrap = q(".dyf-swatches");
    const customColorInput = q(".dyf-custom-color");
    colors.forEach((c, i) => {
      const b = document.createElement("button");
      b.className = "swatch" + (i === 0 ? " active" : "");
      b.style.background = c;
      b.addEventListener("click", () => {
        s.currentColor = c;
        [...swatchWrap.querySelectorAll(".swatch")].forEach((sw) => sw.classList.remove("active"));
        b.classList.add("active");
      });
      swatchWrap.insertBefore(b, customColorInput);
    });
    customColorInput.addEventListener("input", (e) => {
      s.currentColor = e.target.value;
      [...swatchWrap.querySelectorAll(".swatch")].forEach((sw) => sw.classList.remove("active"));
    });

    const sizeSlider = q(".dyf-size");
    const brushBtn = q(".dyf-brush-btn");
    const eraserBtn = q(".dyf-eraser-btn");
    const undoBtn = q(".dyf-undo-btn");
    const clearBtn = q(".dyf-clear-btn");
    const submitBtn = q(".dyf-submit-btn");
    s.tool = "brush";

    brushBtn.addEventListener("click", () => { s.tool = "brush"; brushBtn.classList.add("active"); eraserBtn.classList.remove("active"); s.brushCursor.classList.remove("eraser"); });
    eraserBtn.addEventListener("click", () => { s.tool = "eraser"; eraserBtn.classList.add("active"); brushBtn.classList.remove("active"); s.brushCursor.classList.add("eraser"); });

    /* ---- Custom brush-size cursor ----
       Replaces the page's default grab-hand cursor (set globally on
       body for dragging the fish tank) with a circle that matches the
       selected brush/eraser size, the way desktop paint tools do it.
       Sized in screen pixels: the slider's value is in canvas units
       (900x620), so it's scaled by how much smaller/larger the stage
       is actually rendered on screen. */
    s.brushCursor = q(".dyf-brush-cursor");
    function updateBrushCursorSize() {
      const scale = s.stage.getBoundingClientRect().width / W;
      const size = parseFloat(sizeSlider.value) * scale;
      s.brushCursor.style.width = size + "px";
      s.brushCursor.style.height = size + "px";
    }
    function moveBrushCursor(e) {
      const rect = s.stage.getBoundingClientRect();
      s.brushCursor.style.left = (e.clientX - rect.left) + "px";
      s.brushCursor.style.top = (e.clientY - rect.top) + "px";
    }
    // Touch has no hover state, so skip it there — the circle would
    // just be stuck wherever the last touch happened.
    s.stage.addEventListener("pointerenter", (e) => {
      if (e.pointerType === "touch") return;
      moveBrushCursor(e);
      updateBrushCursorSize();
      s.brushCursor.style.display = "block";
    });
    s.stage.addEventListener("pointermove", (e) => {
      if (e.pointerType === "touch") return;
      moveBrushCursor(e);
    });
    s.stage.addEventListener("pointerleave", (e) => {
      if (e.pointerType === "touch") return;
      s.brushCursor.style.display = "none";
    });
    sizeSlider.addEventListener("input", updateBrushCursorSize);

    // Scroll-to-resize: lets a mouse/trackpad user change brush size
    // without leaving the canvas to touch the slider. Wheel events
    // only fire for mouse/trackpad input, so this never competes with
    // touch drawing. preventDefault keeps the gesture from doing
    // anything else (e.g. page scroll) while hovering the stage.
    s.stage.addEventListener("wheel", (e) => {
      e.preventDefault();
      const step = 2;
      const dir = e.deltaY < 0 ? 1 : -1;
      const next = Math.min(40, Math.max(2, parseFloat(sizeSlider.value) + dir * step));
      sizeSlider.value = next;
      updateBrushCursorSize();
    }, { passive: false });

    clearBtn.addEventListener("click", () => {
      const l = s.layers[s.activeLayer];
      if (l.locked) return;
      pushUndo();
      l.ctx.clearRect(0, 0, W, H);
      updateThumb(s.activeLayer);
    });

    function flattenCanvas() {
      const flat = document.createElement("canvas");
      flat.width = W; flat.height = H;
      const fctx = flat.getContext("2d");
      ["base", "accent", "template"].forEach((id) => fctx.drawImage(layerByCanvasZOrder(id).canvas, 0, 0));
      return flat;
    }

    // SUBMIT. There's no way to hand this canvas straight to the
    // monday.com form -- it's a cross-origin iframe, and browsers
    // don't let a script fill in someone else's file input for real
    // (a legitimate security boundary, not a gap to work around). So
    // this downloads the PNG itself, then asks the host page to
    // switch straight to the submit screen -- no separate download
    // step, no hunting for a second menu to attach it in.
    submitBtn.addEventListener("click", () => {
      const a = document.createElement("a");
      a.download = "my-fish.png";
      a.href = flattenCanvas().toDataURL("image/png");
      a.click();
      if (onSubmit) {
        onSubmit();
      } else {
        showToast(STRINGS[currentLang].submitStub, 6000);
      }
    });

    // Desktop-only internal Back button (bottom of the Template
    // column) — a second trigger for the same action the host page's
    // own external Back button already handles on mobile. No-op if
    // the host page never provided one.
    const backBtn = q(".dyf-back-btn");
    backBtn.addEventListener("click", () => { if (onBack) onBack(); });

    function pushUndo() {
      const l = s.layers[s.activeLayer];
      l.undoStack.push(l.ctx.getImageData(0, 0, W, H));
      if (l.undoStack.length > 30) l.undoStack.shift();
    }
    undoBtn.addEventListener("click", () => {
      const l = s.layers[s.activeLayer];
      if (!l.undoStack.length) return;
      l.ctx.putImageData(l.undoStack.pop(), 0, 0);
      updateThumb(s.activeLayer);
    });

    let drawing = false, activePointerId = null, lastX = 0, lastY = 0;

    function canvasPoint(e, canvas) {
      const rect = canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left) * (W / rect.width), y: (e.clientY - rect.top) * (H / rect.height) };
    }
    function widthForEvent(e) {
      const base = parseFloat(sizeSlider.value);
      if (e.pointerType === "pen" && e.pressure > 0) return base * (0.3 + e.pressure * 1.4);
      return base;
    }

    s.layers.forEach((l) => {
      const canvas = l.canvas;
      canvas.addEventListener("pointerdown", (e) => {
        if (l.locked) return;
        if (activePointerId !== null) return;
        activePointerId = e.pointerId;
        drawing = true;
        pushUndo();
        const ctx = s.layers[s.activeLayer].ctx;
        const p = canvasPoint(e, s.layers[s.activeLayer].canvas);
        lastX = p.x; lastY = p.y;
        ctx.globalCompositeOperation = s.tool === "eraser" ? "destination-out" : "source-over";
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.strokeStyle = s.currentColor;
        ctx.lineWidth = widthForEvent(e);
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        // A plain click never fires pointermove, so without this a
        // single tap (no drag) would leave nothing on the canvas —
        // stroking a zero-length line paints one round dot right away.
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
        canvas.setPointerCapture(e.pointerId);
      });
      canvas.addEventListener("pointermove", (e) => {
        if (!drawing || e.pointerId !== activePointerId) return;
        const ctx = s.layers[s.activeLayer].ctx;
        const p = canvasPoint(e, s.layers[s.activeLayer].canvas);
        ctx.lineWidth = widthForEvent(e);
        const midX = (lastX + p.x) / 2, midY = (lastY + p.y) / 2;
        ctx.quadraticCurveTo(lastX, lastY, midX, midY);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(midX, midY);
        lastX = p.x; lastY = p.y;
      });
      function endStroke(e) {
        if (e.pointerId !== activePointerId) return;
        drawing = false; activePointerId = null;
        updateThumb(s.activeLayer);
      }
      canvas.addEventListener("pointerup", endStroke);
      canvas.addEventListener("pointercancel", endStroke);
      canvas.addEventListener("pointerleave", (e) => { if (e.pointerId === activePointerId) endStroke(e); });
    });

    /* ---- Guided tour ---- */
    s.tourStep = 0;
    s.tourDim = q(".dyf-tour-dim");
    s.tourSpotlight = q(".dyf-spotlight");
    s.tourCard = q(".dyf-tour-card");
    s.tourTitle = q(".dyf-tour-title");
    s.tourText = q(".dyf-tour-text");
    s.tourDots = q(".dyf-tour-dots");
    s.tourBack = q(".dyf-tour-back");
    s.tourNext = q(".dyf-tour-next");

    const stepCount = STRINGS[currentLang].tourSteps.length;
    for (let i = 0; i < stepCount; i++) {
      const dot = document.createElement("span");
      s.tourDots.appendChild(dot);
    }

    function placeTourStep() {
      const step = STRINGS[currentLang].tourSteps[s.tourStep];
      const target = root.querySelector(step.sel);
      if (!target) return;
      const rootRect = root.getBoundingClientRect();
      const r = target.getBoundingClientRect();
      const pad = 8;

      // Coordinates are made relative to .dyf-root, since the tour
      // overlay is positioned absolute against it (not the viewport)
      // — this tool now lives inside a modal, not a whole page.
      const top = r.top - rootRect.top, left = r.left - rootRect.left;

      s.tourSpotlight.style.top = (top - pad) + "px";
      s.tourSpotlight.style.left = (left - pad) + "px";
      s.tourSpotlight.style.width = (r.width + pad * 2) + "px";
      s.tourSpotlight.style.height = (r.height + pad * 2) + "px";

      s.tourTitle.textContent = step.title;
      s.tourText.textContent = step.text;
      [...s.tourDots.children].forEach((d, i) => d.classList.toggle("on", i === s.tourStep));
      s.tourBack.disabled = s.tourStep === 0;
      s.tourNext.textContent = s.tourStep === stepCount - 1 ? STRINGS[currentLang].tourDone : STRINGS[currentLang].tourNext;

      const cardW = s.tourCard.offsetWidth || 300, cardH = s.tourCard.offsetHeight || 140;
      const margin = 14;
      const rootW = root.clientWidth, rootH = root.clientHeight;
      let cardTop = top + r.height + pad + margin;
      if (cardTop + cardH > rootH - margin) cardTop = top - pad - margin - cardH;
      if (cardTop < margin) cardTop = Math.min(rootH - cardH - margin, top);
      let cardLeft = left;
      if (cardLeft + cardW > rootW - margin) cardLeft = rootW - cardW - margin;
      if (cardLeft < margin) cardLeft = margin;
      s.tourCard.style.top = cardTop + "px";
      s.tourCard.style.left = cardLeft + "px";
    }
    s.placeTourStep = placeTourStep;

    function startTour() { s.tourStep = 0; s.tourDim.classList.add("open"); placeTourStep(); }
    function closeTour() { s.tourDim.classList.remove("open"); }

    q(".dyf-tour-btn").addEventListener("click", startTour);
    q(".dyf-tour-skip").addEventListener("click", closeTour);
    s.tourNext.addEventListener("click", () => {
      if (s.tourStep === stepCount - 1) { closeTour(); return; }
      s.tourStep++; placeTourStep();
    });
    s.tourBack.addEventListener("click", () => {
      if (s.tourStep === 0) return;
      s.tourStep--; placeTourStep();
    });
    window.addEventListener("resize", () => { if (s.tourDim.classList.contains("open")) placeTourStep(); });

  }

  function applyStrings(lang) {
    const s = STRINGS[lang];
    q(".dyf-h1").textContent = s.title;
    q(".dyf-template-label").textContent = s.templateLabel;
    q(".dyf-layers-label").textContent = s.layersLabel;
    q(".dyf-color-label").textContent = s.colorLabel;
    q(".dyf-autofill-btn").textContent = s.autofill;
    q(".dyf-clean-btn").textContent = s.clean;
    q(".dyf-draw-label").textContent = s.drawLabel;
    q(".dyf-brush-btn").textContent = s.brush;
    q(".dyf-eraser-btn").textContent = s.eraser;
    q(".dyf-size-label").childNodes[0].textContent = s.sizeLabel + " ";
    q(".dyf-undo-btn").textContent = s.undo;
    q(".dyf-clear-btn").textContent = s.clearLayer;
    q(".dyf-submit-text").textContent = s.submit;
    q(".dyf-back-text").textContent = s.backBtn;
    const tourBtn = q(".dyf-tour-btn");
    tourBtn.title = s.tourBtnTitle;
    tourBtn.setAttribute("aria-label", s.tourBtnTitle);
    q(".dyf-tour-skip").textContent = s.tourSkip;
    q(".dyf-tour-back").textContent = s.tourBack;
    q(".dyf-tour-next").textContent = s.tourNext;

    TEMPLATES.forEach((t) => { if (t.nameEl) t.nameEl.textContent = s.templateNames[t.key]; });
    if (state.layers) {
      state.layers.forEach((l) => {
        if (l.nameEl) l.nameEl.textContent = s.layerNames[l.key];
      });
      const lockTag = q(".dyf-lock-tag");
      if (lockTag) lockTag.textContent = s.locked;
      state.updateFillCleanAvailability && state.updateFillCleanAvailability();
    }
    // If the tour is open mid-step, refresh its text and reposition
    // for the new step titles/copy without resetting progress.
    if (state.tourDim && state.tourDim.classList.contains("open")) state.placeTourStep();
  }

  function mount(container, lang, onSubmitCallback, onBackCallback) {
    currentLang = lang || "en";
    onSubmit = onSubmitCallback || null;
    onBack = onBackCallback || null;
    if (mounted) { applyStrings(currentLang); return; }
    root = container;
    root.classList.add("dyf-root");
    root.innerHTML = markup();
    build();
    mounted = true;
    applyStrings(currentLang);
  }

  function setLanguage(lang) {
    currentLang = lang;
    if (mounted) applyStrings(currentLang);
  }

  window.FishDrawTool = { mount, setLanguage };
})();
