(function () {
  const pageModel = window.__PAGE_MODEL__ || {};
  const flash = document.getElementById("flash");
  const saveBatchButton = document.getElementById("save-batch-button");
  const finalizeButton = document.getElementById("finalize-approval-button");
  const sidebar = document.getElementById("dashboard-sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const dashboardLayout = document.querySelector(".dashboard-layout");
  const wizardForm = document.getElementById("generation-wizard");
  const changeModelButton = document.getElementById("change-model-button");
  const changeModelModal = document.getElementById("change-model-modal");
  const closeChangeModelModalButton = document.getElementById("close-change-model-modal");
  const submitChangeModelButton = document.getElementById("submit-change-model-button");
  const garmentPreviewPortal = document.getElementById("garment-preview-portal");
  const garmentPreviewImage = document.getElementById("garment-preview-image");
  const createClientModal = document.getElementById("create-client-modal");
  let pollingHandle = null;
  const promptDraftPrefix = `auto2:prompt-draft:v3:${pageModel.productId}:`;
  const sidebarStateKey = "auto2:sidebar-collapsed";

  function applySidebarState(collapsed) {
    if (!sidebar || !dashboardLayout) {
      return;
    }
    sidebar.classList.toggle("collapsed", collapsed);
    dashboardLayout.classList.toggle("sidebar-collapsed", collapsed);
  }

  function bootSidebarToggle() {
    if (!sidebar || !dashboardLayout || !sidebarToggle) {
      return;
    }
    let collapsed = false;
    try {
      collapsed = window.localStorage.getItem(sidebarStateKey) === "true";
    } catch {
      collapsed = false;
    }
    applySidebarState(collapsed);
    sidebarToggle.addEventListener("click", () => {
      const next = !sidebar.classList.contains("collapsed");
      applySidebarState(next);
      try {
        window.localStorage.setItem(sidebarStateKey, String(next));
      } catch {
        return;
      }
    });
  }

  function setWizardFeedback(message, isError) {
    const wizardFeedback = document.getElementById("wizard-feedback");
    if (!wizardFeedback) {
      return;
    }
    wizardFeedback.textContent = message;
    wizardFeedback.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function setChangeModelFeedback(message, isError) {
    const feedback = document.getElementById("change-model-feedback");
    if (!feedback) {
      return;
    }
    feedback.textContent = message;
    feedback.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function setCreateClientFeedback(message, isError) {
    const feedback = document.getElementById("create-client-feedback");
    if (!feedback) {
      return;
    }
    feedback.textContent = message;
    feedback.style.color = isError ? "#fca5a5" : "#86efac";
  }

  function bootGarmentHoverPreview() {
    if (!garmentPreviewPortal || !garmentPreviewImage) {
      return;
    }

    function showPreview(src) {
      garmentPreviewImage.src = src;
      garmentPreviewPortal.hidden = false;
      garmentPreviewPortal.classList.add("visible");
    }

    function hidePreview() {
      garmentPreviewPortal.classList.remove("visible");
      garmentPreviewPortal.hidden = true;
      garmentPreviewImage.removeAttribute("src");
    }

    document.querySelectorAll(".garment-reference-item").forEach((item) => {
      const src = item.getAttribute("data-garment-preview-src");
      if (!src) {
        return;
      }
      item.addEventListener("mouseenter", () => showPreview(src));
      item.addEventListener("mouseleave", hidePreview);
      item.addEventListener("focusin", () => showPreview(src));
      item.addEventListener("focusout", hidePreview);
    });
  }

  function bootGenerationWizard() {
    if (!wizardForm) {
      return;
    }

    const state = {
      garments: [],
      models: [],
      poses: [],
      step: 1
    };

    const stepButtons = Array.from(document.querySelectorAll(".wizard-step"));
    const stepPanels = Array.from(document.querySelectorAll(".wizard-panel"));
    const prevButton = document.getElementById("wizard-prev-button");
    const nextButton = document.getElementById("wizard-next-button");
    const submitButton = document.getElementById("wizard-submit-button");
    const imageSizeSelect = document.getElementById("wizard-image-size");
    const customSizeGrid = document.getElementById("wizard-custom-size-grid");

    function renderProviderSettingsState() {
      if (!imageSizeSelect || !customSizeGrid) {
        return;
      }
      customSizeGrid.hidden = imageSizeSelect.value !== "custom";
      renderWizardLiveSummary(summarizeGarments(state.garments));
    }

    function renderWizardStep() {
      stepButtons.forEach((button) => {
        button.classList.toggle("active", Number(button.getAttribute("data-step")) === state.step);
      });
      stepPanels.forEach((panel) => {
        panel.classList.toggle("active", Number(panel.getAttribute("data-step-panel")) === state.step);
      });
      if (prevButton) {
        prevButton.disabled = state.step === 1;
      }
      if (nextButton) {
        nextButton.style.display = state.step === 5 ? "none" : "inline-flex";
      }
      if (submitButton) {
        submitButton.style.display = state.step === 5 ? "inline-flex" : "none";
      }
    }

    function renderSummary(targetId, items, formatter) {
      const target = document.getElementById(targetId);
      if (!target) {
        return;
      }
      if (items.length === 0) {
        target.innerHTML = `<div class="empty-state wizard-empty">Aun no hay archivos cargados.</div>`;
        return;
      }
      target.innerHTML = items.map((item, index) => formatter(item, index)).join("");
    }

    function renderWizardState() {
      const garmentGroups = summarizeGarments(state.garments);
      renderSummary("garments-summary", garmentGroups, (group) => `
        <article class="wizard-summary-card">
          <div class="wizard-summary-thumb-grid">
            ${group.items.slice(0, 4).map((item) => `<img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" />`).join("")}
          </div>
          <strong>${escapeHtml(group.label)}</strong>
          <p class="muted">${group.count} imagen(es)</p>
        </article>
      `);
      renderSummary("models-summary", state.models, (item) => `
        <article class="wizard-summary-card">
          <div class="wizard-summary-thumb-grid">
            <img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" />
          </div>
          <strong>${escapeHtml(item.name)}</strong>
        </article>
      `);
      renderSummary("poses-summary", state.poses, (item, index) => `
        <article class="wizard-summary-card">
          <div class="wizard-summary-thumb-grid">
            <img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" />
          </div>
          <strong>Pose ${index + 1}</strong>
          <p class="muted">${escapeHtml(item.name)}</p>
        </article>
      `);
      renderWizardLiveSummary(garmentGroups);
    }

    function renderWizardLiveSummary(garmentGroups) {
      const clientField = document.getElementById("wizard-client-id");
      const selectedClientLabel = clientField?.selectedOptions?.[0]?.textContent || "Sin cliente";
      const garmentsCountNode = document.getElementById("wizard-summary-garments");
      const modelsCountNode = document.getElementById("wizard-summary-models");
      const posesCountNode = document.getElementById("wizard-summary-poses");
      const clientNode = document.getElementById("wizard-summary-client");
      const providerNode = document.getElementById("wizard-summary-provider");
      const sizeNode = document.getElementById("wizard-summary-size");
      const readinessNode = document.getElementById("wizard-summary-readiness");
      const providerSettings = buildProviderSettingsPayload();
      const imageSizeLabel = typeof providerSettings.imageSize === "object"
        ? `${providerSettings.imageSize.width || 0}x${providerSettings.imageSize.height || 0}`
        : providerSettings.imageSize;

      if (garmentsCountNode) garmentsCountNode.textContent = String(garmentGroups.length);
      if (modelsCountNode) modelsCountNode.textContent = String(state.models.length);
      if (posesCountNode) posesCountNode.textContent = `${state.poses.length} / 4`;
      if (clientNode) clientNode.textContent = selectedClientLabel;
      if (providerNode) providerNode.textContent = providerSettings.modelId || "-";
      if (sizeNode) sizeNode.textContent = imageSizeLabel;
      if (readinessNode) {
        const readiness = [];
        if (state.garments.length < 1) readiness.push("falta al menos 1 producto");
        if (state.models.length < 1) readiness.push("falta al menos 1 modelo");
        if (state.poses.length < 4) readiness.push("faltan poses");
        readinessNode.textContent = readiness.length
          ? `Pendiente: ${readiness.join(", ")}.`
          : "Listo para lanzar el batch cuando confirmes el paso 5.";
      }
    }

    async function addFiles(kind, files) {
      if (kind === "garments") {
        state.garments = mergeByKey(state.garments, files);
      }
      if (kind === "models") {
        state.models = mergeByKey(state.models, files);
      }
      if (kind === "poses") {
        state.poses = mergeByKey(state.poses, files).slice(0, 4);
      }
      renderWizardState();
    }

    document.querySelectorAll(".wizard-pick-button").forEach((button) => {
      button.addEventListener("click", () => {
        const inputId = button.getAttribute("data-target-input");
        const input = inputId ? document.getElementById(inputId) : null;
        input?.click();
      });
    });

    document.querySelectorAll(".wizard-file-input").forEach((input) => {
      input.addEventListener("change", async (event) => {
        const target = event.currentTarget;
        const files = Array.from(target.files || []).map((file) => normalizePickedFile(file));
        if (target.id.startsWith("garments")) {
          await addFiles("garments", files);
        }
        if (target.id.startsWith("models")) {
          await addFiles("models", files);
        }
        if (target.id.startsWith("poses")) {
          await addFiles("poses", files);
        }
        target.value = "";
      });
    });

    imageSizeSelect?.addEventListener("change", renderProviderSettingsState);
    document.getElementById("wizard-client-id")?.addEventListener("change", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
    document.getElementById("wizard-fal-model")?.addEventListener("change", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
    document.getElementById("wizard-custom-width")?.addEventListener("input", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
    document.getElementById("wizard-custom-height")?.addEventListener("input", () => renderWizardLiveSummary(summarizeGarments(state.garments)));

    document.querySelectorAll(".dropzone").forEach((dropzone) => {
      const kind = dropzone.getAttribute("data-dropzone");
      dropzone.addEventListener("dragover", (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragover");
      });
      dropzone.addEventListener("dragleave", () => {
        dropzone.classList.remove("is-dragover");
      });
      dropzone.addEventListener("drop", async (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragover");
        const files = await collectDroppedFiles(event.dataTransfer);
        await addFiles(kind, files);
      });
    });

    stepButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const nextStep = Number(button.getAttribute("data-step"));
        if (nextStep > state.step) {
          for (let step = state.step; step < nextStep; step += 1) {
            const validationError = validateWizardStep(step, state);
            if (validationError) {
              setWizardFeedback(validationError, true);
              return;
            }
          }
        }
        setWizardFeedback("");
        state.step = nextStep;
        renderWizardStep();
      });
    });

    prevButton?.addEventListener("click", () => {
      state.step = Math.max(1, state.step - 1);
      renderWizardStep();
    });

    nextButton?.addEventListener("click", () => {
      const validationError = validateWizardStep(state.step, state);
      if (validationError) {
        setWizardFeedback(validationError, true);
        return;
      }
      state.step = Math.min(5, state.step + 1);
      setWizardFeedback("");
      renderWizardStep();
    });

    wizardForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const validationError = validateWizardStep(4, state);
      const providerValidationError = validateWizardStep(5, state);
      if (validationError || providerValidationError) {
        setWizardFeedback(validationError || providerValidationError, true);
        return;
      }
      try {
        submitButton.disabled = true;
        submitButton.textContent = "Preparando...";
        const formData = new FormData();
        appendFilesToFormData(formData, "garmentFiles", "garmentMeta", state.garments);
        appendFilesToFormData(formData, "modelFiles", "modelMeta", state.models);
        appendFilesToFormData(formData, "poseFiles", "poseMeta", state.poses);
        formData.append("promptConfig", JSON.stringify({
          systemPrompt: document.getElementById("wizard-system-prompt")?.value || "",
          generalPrompt: document.getElementById("wizard-general-prompt")?.value || "",
          posePrompts: Object.fromEntries(Array.from(document.querySelectorAll(".wizard-pose-prompt")).map((field) => [
            field.getAttribute("data-pose-id"),
            field.value || ""
          ])),
          providerSettings: buildProviderSettingsPayload()
        }));
        formData.append("clientId", document.getElementById("wizard-client-id")?.value || "");

        const response = await fetch("/api/wizard/setup", {
          method: "POST",
          body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo iniciar el lote.");
        }
        setWizardFeedback("Lote preparado. Redirigiendo a Home...", false);
        window.setTimeout(() => {
          window.location.href = payload.nextUrl || "/home";
        }, 800);
      } catch (error) {
        setWizardFeedback(error.message || "No se pudo iniciar el lote.", true);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Preparar y generar";
      }
    });

    renderWizardStep();
    renderWizardState();
    renderProviderSettingsState();
  }

  function buildProviderSettingsPayload() {
    const imageSizeMode = document.getElementById("wizard-image-size")?.value || "square_hd";
    const customWidth = Number(document.getElementById("wizard-custom-width")?.value || "0");
    const customHeight = Number(document.getElementById("wizard-custom-height")?.value || "0");
    const seedRaw = document.getElementById("wizard-seed")?.value || "";
    return {
      modelId: document.getElementById("wizard-fal-model")?.value || "",
      imageSize: imageSizeMode === "custom"
        ? { width: customWidth, height: customHeight }
        : imageSizeMode,
      seed: seedRaw.trim() ? Number(seedRaw) : null,
      syncMode: Boolean(document.getElementById("wizard-sync-mode")?.checked),
      enableSafetyChecker: Boolean(document.getElementById("wizard-enable-safety")?.checked)
    };
  }

  function appendFilesToFormData(formData, fileField, metaField, items) {
    const metadata = items.map((item, index) => {
      const clientId = `${fileField}-${index}-${Date.now()}`;
      formData.append(fileField, item.file, `${clientId}__${item.name}`);
      return {
        clientId,
        relativePath: item.relativePath || ""
      };
    });
    formData.append(metaField, JSON.stringify(metadata));
  }

  function normalizePickedFile(file) {
    return {
      key: `${file.name}:${file.size}:${file.lastModified}:${file.webkitRelativePath || ""}`,
      file,
      name: file.name,
      relativePath: file.webkitRelativePath || "",
      size: file.size,
      previewUrl: URL.createObjectURL(file)
    };
  }

  function mergeByKey(current, incoming) {
    const seen = new Map(current.map((item) => [item.key, item]));
    incoming.forEach((item) => {
      seen.set(item.key, item);
    });
    return Array.from(seen.values());
  }

  function summarizeGarments(items) {
    const grouped = new Map();
    items.forEach((item) => {
      const groupLabel = getGarmentGroupLabel(item.relativePath, item.name);
      const current = grouped.get(groupLabel) || { label: groupLabel, count: 0, items: [] };
      current.count += 1;
      current.items.push(item);
      grouped.set(groupLabel, current);
    });
    return Array.from(grouped.values());
  }

  function getGarmentGroupLabel(relativePath, fallbackName) {
    if (!relativePath) {
      return fallbackName;
    }
    const parts = relativePath.split(/[\\/]/).filter(Boolean);
    return parts.length > 1 ? parts[0] : fallbackName;
  }

  function validateWizardStep(step, state) {
    if (step >= 1 && state.garments.length < 1) {
      return "Debes cargar al menos 1 imagen o carpeta de producto antes de continuar.";
    }
    if (step >= 2 && state.models.length < 1) {
      return "Debes cargar al menos 1 imagen de modelo antes de continuar.";
    }
    if (step >= 3 && state.poses.length < 4) {
      return "Debes cargar exactamente 4 imagenes de pose antes de continuar.";
    }
    if (step >= 5) {
      const providerSettings = buildProviderSettingsPayload();
      if (!providerSettings.modelId) {
        return "Debes seleccionar un modelo de fal.ai.";
      }
      if (typeof providerSettings.seed === "number" && Number.isNaN(providerSettings.seed)) {
        return "La seed debe ser numerica si decides completarla.";
      }
      if (typeof providerSettings.imageSize === "object") {
        if (!Number.isInteger(providerSettings.imageSize.width) || providerSettings.imageSize.width <= 0) {
          return "El ancho del tamano custom debe ser un numero entero positivo.";
        }
        if (!Number.isInteger(providerSettings.imageSize.height) || providerSettings.imageSize.height <= 0) {
          return "El alto del tamano custom debe ser un numero entero positivo.";
        }
      }
    }
    return "";
  }

  async function collectDroppedFiles(dataTransfer) {
    const items = Array.from(dataTransfer?.items || []);
    if (items.length === 0) {
      return Array.from(dataTransfer?.files || []).map((file) => normalizePickedFile(file));
    }
    const collected = [];
    for (const item of items) {
      const entry = typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null;
      if (entry) {
        const entryFiles = await readEntryFiles(entry, "");
        collected.push(...entryFiles);
      } else {
        const file = item.getAsFile?.();
        if (file) {
          collected.push(normalizePickedFile(file));
        }
      }
    }
    return collected;
  }

  async function readEntryFiles(entry, parentPath) {
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) => {
        entry.file(resolve, reject);
      });
      const relativePath = parentPath ? `${parentPath}/${file.name}` : file.name;
      return [{
        key: `${file.name}:${file.size}:${file.lastModified}:${relativePath}`,
        file,
        name: file.name,
        relativePath,
        size: file.size
      }];
    }
    if (!entry.isDirectory) {
      return [];
    }
    const reader = entry.createReader();
    const entries = await readAllDirectoryEntries(reader);
    const nextParentPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
    const nested = await Promise.all(entries.map((child) => readEntryFiles(child, nextParentPath)));
    return nested.flat();
  }

  async function readAllDirectoryEntries(reader) {
    const entries = [];
    while (true) {
      const batch = await new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
      });
      if (!batch.length) {
        break;
      }
      entries.push(...batch);
    }
    return entries;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll("\"", "&quot;")
      .replaceAll("'", "&#39;");
  }

  async function bootChangeModelModal() {
    if (!changeModelButton || !changeModelModal) {
      return;
    }

    let availableModels = [];
    let selectedModel = pageModel.selectedModel || "";

    changeModelModal.hidden = true;

    function renderModelPicker() {
      const grid = document.getElementById("model-picker-grid");
      const selectedModelPreview = document.getElementById("selected-model-preview");
      const selectedModelPreviewImage = document.getElementById("selected-model-preview-image");
      const selectedModelPreviewName = document.getElementById("selected-model-preview-name");
      if (!grid) {
        return;
      }
      grid.innerHTML = availableModels.map((model) => `
        <button
          type="button"
          class="model-picker-card ${model.path === selectedModel ? "active" : ""}"
          data-model-path="${encodeURIComponent(model.path)}"
          aria-pressed="${model.path === selectedModel ? "true" : "false"}"
        >
          <img src="${model.fileUrl}" alt="${escapeHtml(model.name)}" />
          <span class="model-picker-name">${escapeHtml(model.name)}</span>
          <span class="model-picker-badge">${model.path === selectedModel ? "Seleccionado" : "Elegir"}</span>
        </button>
      `).join("");

      const activeModel = availableModels.find((model) => model.path === selectedModel);
      if (selectedModelPreview && selectedModelPreviewImage && selectedModelPreviewName) {
        if (activeModel) {
          selectedModelPreview.hidden = false;
          selectedModelPreviewImage.src = activeModel.fileUrl;
          selectedModelPreviewName.textContent = activeModel.name;
        } else {
          selectedModelPreview.hidden = true;
          selectedModelPreviewImage.removeAttribute("src");
          selectedModelPreviewName.textContent = "";
        }
      }

      grid.querySelectorAll(".model-picker-card").forEach((button) => {
        button.addEventListener("click", () => {
          selectedModel = decodeURIComponent(button.getAttribute("data-model-path") || "");
          renderModelPicker();
        });
      });
    }

    async function openModal() {
      changeModelModal.hidden = false;
      setChangeModelFeedback("", false);
      if (availableModels.length === 0) {
        const response = await fetch("/api/models");
        const payload = await response.json();
        availableModels = payload.models || [];
      }
      renderModelPicker();
    }

    function closeModal() {
      changeModelModal.hidden = true;
    }

    changeModelButton.addEventListener("click", () => {
      openModal().catch((error) => setFlash(error.message, true));
    });
    closeChangeModelModalButton?.addEventListener("click", closeModal);
    changeModelModal.addEventListener("click", (event) => {
      if (event.target === changeModelModal) {
        closeModal();
      }
    });

    submitChangeModelButton?.addEventListener("click", async () => {
      if (!selectedModel) {
        setChangeModelFeedback("Selecciona un modelo antes de continuar.", true);
        return;
      }
      try {
        submitChangeModelButton.disabled = true;
        submitChangeModelButton.textContent = "Guardando...";
        const posePrompts = Object.fromEntries(Array.from(document.querySelectorAll(".change-model-pose-prompt")).map((field) => [
          field.getAttribute("data-pose-id"),
          field.value || ""
        ]));
        await postJson(`/api/product/${pageModel.productId}/change-model`, {
          selectedModel,
          generalPrompt: document.getElementById("change-model-general-prompt")?.value || "",
          posePrompts
        });
        setChangeModelFeedback("Producto actualizado. Regenerando con el nuevo modelo...", false);
        ensurePolling();
        window.setTimeout(() => window.location.reload(), 800);
      } catch (error) {
        setChangeModelFeedback(error.message, true);
      } finally {
        submitChangeModelButton.disabled = false;
        submitChangeModelButton.textContent = "Guardar y regenerar producto";
      }
    });
  }

  function setFlash(message, isError) {
    if (!flash) {
      return;
    }
    flash.textContent = message;
    flash.style.color = isError ? "#b91c1c" : "#0f766e";
  }

  function setPoseLoading(poseId, loading, labelOverride) {
    const card = document.querySelector(`.pose-card[data-pose-id="${poseId}"]`);
    if (!card) {
      return;
    }
    card.classList.toggle("is-loading", loading);
    const loaderLabel = card.querySelector(".loader-label");
    if (!loaderLabel) {
      return;
    }
    const defaultLabel = loaderLabel.getAttribute("data-default-label") || "Generando";
    const label = loading ? (labelOverride || defaultLabel) : defaultLabel;
    loaderLabel.textContent = `${label} ${poseId}...`;
  }

  function getPromptOverride(poseId) {
    const field = document.querySelector(`.prompt-editor[data-pose-id="${poseId}"]`);
    return field ? field.value : "";
  }

  function getPromptDraftKey(poseId) {
    return `${promptDraftPrefix}${poseId}`;
  }

  function loadPromptDraft(poseId) {
    try {
      return window.localStorage.getItem(getPromptDraftKey(poseId));
    } catch {
      return null;
    }
  }

  function savePromptDraft(poseId, value) {
    try {
      window.localStorage.setItem(getPromptDraftKey(poseId), value);
    } catch {
      return;
    }
  }

  function clearPromptDraft(poseId) {
    try {
      window.localStorage.removeItem(getPromptDraftKey(poseId));
    } catch {
      return;
    }
  }

  async function postJson(url, body) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body || {})
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "Request failed");
    }
    return response.json();
  }

  function updateCarousel(poseId, nextIndex) {
    const shell = document.querySelector(`.carousel-shell[data-pose-id="${poseId}"]`);
    if (!shell) {
      return;
    }
    const slides = Array.from(shell.querySelectorAll(`.carousel-slide[data-pose-id="${poseId}"]`));
    if (slides.length === 0) {
      return;
    }
    const safeIndex = ((nextIndex % slides.length) + slides.length) % slides.length;
    shell.dataset.currentIndex = String(safeIndex);
    slides.forEach((slide, index) => {
      slide.classList.toggle("is-visible", index === safeIndex);
    });
    const visibleSlide = slides[safeIndex];
    const visibleOutputId = visibleSlide ? visibleSlide.getAttribute("data-output-id") : null;
    document.querySelectorAll(`.thumb-button[data-pose-id="${poseId}"]`).forEach((button) => {
      button.classList.toggle("active", button.getAttribute("data-output-id") === visibleOutputId);
    });
    const counter = document.querySelector(`.carousel-counter[data-pose-id="${poseId}"]`);
    if (counter) {
      counter.textContent = `${safeIndex + 1} / ${slides.length}`;
    }
  }

  function updateSelectedStateForPose(poseId, outputId) {
    document.querySelectorAll(`.carousel-slide[data-pose-id="${poseId}"]`).forEach((slide) => {
      slide.classList.toggle("approved", slide.getAttribute("data-output-id") === outputId);
    });
    document.querySelectorAll(`.approve-button[data-pose-id="${poseId}"]`).forEach((button) => {
      const isActive = button.getAttribute("data-output-id") === outputId;
      button.classList.toggle("active", isActive);
      button.textContent = isActive ? "Elegida" : "Elegir esta";
    });
  }

  async function persistVisibleSelection(poseId) {
    const shell = document.querySelector(`.carousel-shell[data-pose-id="${poseId}"]`);
    if (!shell) {
      return;
    }
    const currentIndex = Number(shell.getAttribute("data-current-index") || "0");
    const slides = Array.from(shell.querySelectorAll(`.carousel-slide[data-pose-id="${poseId}"]`));
    const currentSlide = slides[currentIndex];
    const outputId = currentSlide ? currentSlide.getAttribute("data-output-id") : null;
    if (!outputId) {
      return;
    }
    await postJson(`/api/product/${pageModel.productId}/approve`, { poseId, outputId });
    updateSelectedStateForPose(poseId, outputId);
  }

  function getCurrentCarouselSelections() {
    const selections = {};
    document.querySelectorAll(".carousel-shell").forEach((shell) => {
      const poseId = shell.getAttribute("data-pose-id");
      const currentIndex = Number(shell.getAttribute("data-current-index") || "0");
      const slides = Array.from(shell.querySelectorAll(`.carousel-slide[data-pose-id="${poseId}"]`));
      const currentSlide = slides[currentIndex];
      const outputId = currentSlide ? currentSlide.getAttribute("data-output-id") : null;
      if (poseId && outputId) {
        selections[poseId] = outputId;
      }
    });
    return selections;
  }

  function bootCarousels() {
    document.querySelectorAll(".carousel-shell").forEach((shell) => {
      const poseId = shell.getAttribute("data-pose-id");
      const currentIndex = Number(shell.getAttribute("data-current-index") || "0");
      updateCarousel(poseId, currentIndex);
    });

    document.querySelectorAll(".carousel-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const poseId = button.getAttribute("data-pose-id");
        const shell = document.querySelector(`.carousel-shell[data-pose-id="${poseId}"]`);
        const currentIndex = Number(shell?.getAttribute("data-current-index") || "0");
        const direction = button.getAttribute("data-direction");
        updateCarousel(poseId, currentIndex + (direction === "next" ? 1 : -1));
        try {
          await persistVisibleSelection(poseId);
        } catch (error) {
          setFlash(error.message, true);
        }
      });
    });

    document.querySelectorAll(".thumb-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const poseId = button.getAttribute("data-pose-id");
        const outputId = button.getAttribute("data-output-id");
        const slides = Array.from(document.querySelectorAll(`.carousel-slide[data-pose-id="${poseId}"]`));
        const nextIndex = slides.findIndex((slide) => slide.getAttribute("data-output-id") === outputId);
        if (nextIndex >= 0) {
          updateCarousel(poseId, nextIndex);
          try {
            await persistVisibleSelection(poseId);
          } catch (error) {
            setFlash(error.message, true);
          }
        }
      });
    });
  }

  function bootPromptDrafts() {
    document.querySelectorAll(".prompt-editor").forEach((field) => {
      const poseId = field.getAttribute("data-pose-id");
      const savedDraft = loadPromptDraft(poseId);
      if (savedDraft !== null) {
        field.value = savedDraft;
      }
      field.addEventListener("input", () => {
        savePromptDraft(poseId, field.value);
      });
    });
  }

  function bootBatchesPage() {
    if (!["batches", "batch-detail"].includes(pageModel.page)) {
      return;
    }
    document.querySelectorAll(".batch-action-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const batchId = button.getAttribute("data-batch-id");
        const action = button.getAttribute("data-action");
        if (!batchId || !action) {
          return;
        }
        if (action === "delete") {
          const confirmed = window.confirm("Esto eliminara el batch y sus archivos guardados. Deseas continuar?");
          if (!confirmed) {
            return;
          }
        }
        try {
          button.disabled = true;
          const payload = await postJson(`/api/batches/${batchId}/${action}`, {});
          if (payload.nextUrl) {
            window.location.href = payload.nextUrl;
            return;
          }
          window.location.reload();
        } catch (error) {
          window.alert(error.message || "No se pudo ejecutar la accion del batch.");
        } finally {
          button.disabled = false;
        }
      });
    });
  }

  function bootClientsPage() {
    if (pageModel.page !== "clients") {
      return;
    }
    const openButton = document.getElementById("open-create-client-modal");
    const closeButton = document.getElementById("close-create-client-modal");
    const submitButton = document.getElementById("submit-create-client-button");
    const nameField = document.getElementById("create-client-name");
    const notesField = document.getElementById("create-client-notes");
    if (!createClientModal || !openButton || !closeButton || !submitButton || !nameField || !notesField) {
      return;
    }

    function openModal() {
      createClientModal.hidden = false;
      setCreateClientFeedback("", false);
      window.setTimeout(() => nameField.focus(), 0);
    }

    function closeModal() {
      createClientModal.hidden = true;
    }

    openButton.addEventListener("click", openModal);
    closeButton.addEventListener("click", closeModal);
    createClientModal.addEventListener("click", (event) => {
      if (event.target === createClientModal) {
        closeModal();
      }
    });

    submitButton.addEventListener("click", async () => {
      try {
        submitButton.disabled = true;
        submitButton.textContent = "Guardando...";
        const payload = await postJson("/api/clients", {
          name: nameField.value || "",
          notes: notesField.value || ""
        });
        setCreateClientFeedback(`Cliente ${payload.client.name} guardado.`, false);
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        setCreateClientFeedback(error.message || "No se pudo guardar el cliente.", true);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = "Guardar cliente";
      }
    });
  }

  async function pollUntilStable() {
    const response = await fetch(`/api/product/${pageModel.productId}`);
    if (!response.ok) {
      throw new Error("No se pudo consultar el estado del producto.");
    }
    const product = await response.json();
    const nextSignature = JSON.stringify({
      status: product.status,
      outputs: (product.outputs || []).map((output) => ({
        outputId: output.outputId,
        poseId: output.poseId,
        filePath: output.filePath
      })),
      approved: product.approved,
      poses: (product.poses || []).map((pose) => ({
        poseId: pose.poseId,
        status: pose.status
      }))
    });
    if (nextSignature !== pageModel.signature) {
      window.location.reload();
      return;
    }
    const generatingPose = product.poses.find((pose) => pose.status === "generating");
    if (generatingPose) {
      setPoseLoading(generatingPose.poseId, true);
      return;
    }
    window.clearInterval(pollingHandle);
    pollingHandle = null;
    window.location.reload();
  }

  function ensurePolling() {
    if (pollingHandle) {
      return;
    }
    pollingHandle = window.setInterval(() => {
      pollUntilStable().catch((error) => setFlash(error.message, true));
    }, 2000);
  }

  document.querySelectorAll(".approve-button").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        const poseId = button.getAttribute("data-pose-id");
        const outputId = button.getAttribute("data-output-id");
        await postJson(`/api/product/${pageModel.productId}/approve`, { poseId, outputId });
        updateSelectedStateForPose(poseId, outputId);
        setFlash(`Seleccion actualizada para ${poseId}.`);
      } catch (error) {
        setFlash(error.message, true);
      }
    });
  });

  document.querySelectorAll(".regenerate-button").forEach((button) => {
    button.addEventListener("click", async () => {
      const poseId = button.getAttribute("data-pose-id");
      try {
        setPoseLoading(poseId, true, "Regenerando");
        button.disabled = true;
        const promptOverride = getPromptOverride(poseId);
        const providerModelId = document.querySelector(`.provider-model-select[data-pose-id="${poseId}"]`)?.value || "";
        await postJson(`/api/product/${pageModel.productId}/regenerate/${poseId}`, {
          promptOverride,
          providerModelId
        });
        savePromptDraft(poseId, promptOverride);
        setFlash(`Regeneracion enviada para ${poseId}.`);
        ensurePolling();
      } catch (error) {
        setPoseLoading(poseId, false);
        button.disabled = false;
        setFlash(error.message, true);
      }
    });
  });

  if (finalizeButton) {
    finalizeButton.addEventListener("click", async () => {
      if (!pageModel.canFinalize) {
        setFlash("El set se habilita cuando existan las 4 imagenes generadas.", true);
        return;
      }
      try {
        finalizeButton.disabled = true;
        finalizeButton.textContent = "Aprobando...";
        const result = await postJson(`/api/product/${pageModel.productId}/finalize-approval`, {
          currentSelections: getCurrentCarouselSelections()
        });
        document.querySelectorAll(".prompt-editor").forEach((field) => {
          const poseId = field.getAttribute("data-pose-id");
          clearPromptDraft(poseId);
        });
        setFlash("Set aprobado correctamente.");
        if (result.nextProductId && result.nextProductId !== pageModel.productId) {
          window.setTimeout(() => {
            window.location.href = `/review/${result.nextProductId}`;
          }, 700);
          return;
        }
        window.location.reload();
      } catch (error) {
        setFlash(error.message, true);
      } finally {
        finalizeButton.disabled = false;
        finalizeButton.textContent = "Aprobar set completo";
      }
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "ArrowLeft" && pageModel.previous) {
      window.location.href = `/review/${pageModel.previous}`;
      return;
    }
    if (event.key === "ArrowRight" && pageModel.next) {
      window.location.href = `/review/${pageModel.next}`;
    }
  });

  if (pageModel.shouldPoll) {
    ensurePolling();
  }

  if (saveBatchButton) {
    saveBatchButton.addEventListener("click", async () => {
      try {
        saveBatchButton.disabled = true;
        saveBatchButton.textContent = "Guardando...";
        const result = await postJson("/api/batch/save-state", {});
        setFlash(`Batch guardado. Snapshots: ${result.snapshotCount}.`);
      } catch (error) {
        setFlash(error.message, true);
      } finally {
        saveBatchButton.disabled = false;
        saveBatchButton.textContent = "Guardar batch";
      }
    });
  }

  bootSidebarToggle();
  bootGarmentHoverPreview();
  bootGenerationWizard();
  bootChangeModelModal();
  bootCarousels();
  bootPromptDrafts();
  bootBatchesPage();
  bootClientsPage();
})();
