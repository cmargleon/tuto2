(function () {
  const pageModel = window.__PAGE_MODEL__ || {};
  const flash = document.getElementById("flash");
  const saveBatchButton = document.getElementById("save-batch-button");
  const finalizeButton = document.getElementById("finalize-approval-button");
  const sidebar = document.getElementById("dashboard-sidebar");
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const dashboardLayout = document.querySelector(".dashboard-layout");
  const wizardForm = document.getElementById("generation-wizard");
  const garmentPreviewPortal = document.getElementById("garment-preview-portal");
  const garmentPreviewImage = document.getElementById("garment-preview-image");
  const createClientModal = document.getElementById("create-client-modal");
  let pollingHandle = null;
  const promptDraftPrefix = `auto2:prompt-draft:v3:${pageModel.productId}:`;
  const sidebarStateKey = "auto2:sidebar-collapsed";
  const modelAgeGroupLabels = {
    nino: "Nino",
    adolescente: "Adolescente",
    adulto_joven: "Adulto joven",
    adulto: "Adulto",
    jubilado: "Jubilado",
    anciano: "Anciano"
  };

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
      selectedModelId: "",
      selectedModelPhotoIds: [],
      step: 1,
      availableModels: Array.isArray(pageModel.availableModels) ? pageModel.availableModels : []
    };

    const stepButtons = Array.from(document.querySelectorAll(".wizard-step"));
    const stepPanels = Array.from(document.querySelectorAll(".wizard-panel"));
    const prevButton = document.getElementById("wizard-prev-button");
    const nextButton = document.getElementById("wizard-next-button");
    const submitButton = document.getElementById("wizard-submit-button");
    const imageSizeSelect = document.getElementById("wizard-image-size");
    const customSizeGrid = document.getElementById("wizard-custom-size-grid");
    const backgroundModeSelect = document.getElementById("wizard-background-mode");
    const backgroundBokehInput = document.getElementById("wizard-background-bokeh");
    const backgroundBokehValue = document.getElementById("wizard-background-bokeh-value");
    const clientField = document.getElementById("wizard-client-id");
    const modelCatalogNode = document.getElementById("wizard-model-catalog");
    const selectedModelEmptyNode = document.getElementById("wizard-selected-model-empty");
    const selectedModelShell = document.getElementById("wizard-selected-model-shell");
    const selectedModelName = document.getElementById("wizard-selected-model-name");
    const selectedModelMeta = document.getElementById("wizard-selected-model-meta");
    const modelPhotoPicker = document.getElementById("wizard-model-photo-picker");

    function getFilteredModels() {
      const selectedClientId = clientField?.value || "";
      return state.availableModels.filter((model) => {
        if (!selectedClientId) {
          return true;
        }
        return !model.clientId || model.clientId === selectedClientId;
      });
    }

    function renderProviderSettingsState() {
      if (!imageSizeSelect || !customSizeGrid) {
        return;
      }
      customSizeGrid.hidden = imageSizeSelect.value !== "custom";
      renderWizardLiveSummary(summarizeGarments(state.garments));
    }

    function renderBackgroundState() {
      const mode = backgroundModeSelect?.value || "white";
      document.querySelectorAll(".wizard-background-advanced").forEach((node) => {
        const hideFor = node.getAttribute("data-background-hide-for");
        node.hidden = hideFor === mode;
      });
      if (backgroundBokehValue && backgroundBokehInput) {
        backgroundBokehValue.textContent = backgroundBokehInput.value || "0";
      }
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
        renderModelCatalog();
        renderSelectedModel();
        renderWizardLiveSummary(garmentGroups);
      }

      function renderWizardLiveSummary(garmentGroups) {
        const selectedClientLabel = clientField?.selectedOptions?.[0]?.textContent || "Sin cliente";
        const garmentsCountNode = document.getElementById("wizard-summary-garments");
        const modelNode = document.getElementById("wizard-summary-model");
        const clientNode = document.getElementById("wizard-summary-client");
        const providerNode = document.getElementById("wizard-summary-provider");
      const sizeNode = document.getElementById("wizard-summary-size");
      const readinessNode = document.getElementById("wizard-summary-readiness");
      const providerSettings = buildProviderSettingsPayload();
      const imageSizeLabel = typeof providerSettings.imageSize === "object"
        ? `${providerSettings.imageSize.width || 0}x${providerSettings.imageSize.height || 0}`
        : providerSettings.imageSize;

        if (garmentsCountNode) garmentsCountNode.textContent = String(garmentGroups.length);
        if (modelNode) {
          const selectedModel = state.availableModels.find((model) => model.modelId === state.selectedModelId);
          modelNode.textContent = selectedModel ? `${selectedModel.name} (${state.selectedModelPhotoIds.length} fotos)` : "Sin modelo";
        }
      if (clientNode) clientNode.textContent = selectedClientLabel;
      if (providerNode) providerNode.textContent = providerSettings.modelId || "-";
      if (sizeNode) sizeNode.textContent = imageSizeLabel;
        if (readinessNode) {
          const readiness = [];
          if (state.garments.length < 1) readiness.push("falta al menos 1 producto");
          if (!state.selectedModelId || state.selectedModelPhotoIds.length !== 4) readiness.push("faltan 4 fotos de modelo");
        readinessNode.textContent = readiness.length
          ? `Pendiente: ${readiness.join(", ")}.`
          : "Listo para lanzar el batch cuando confirmes el paso 5.";
      }
      }

      function renderModelCatalog() {
        if (!modelCatalogNode) {
          return;
        }
        const models = getFilteredModels();
        if (!models.length) {
          modelCatalogNode.innerHTML = `<div class="empty-state wizard-empty">No hay modelos disponibles para este cliente. Puedes crearlos en la seccion Modelos.</div>`;
          return;
        }
        modelCatalogNode.innerHTML = models.map((model) => {
          const cover = model.photos?.[0];
          const active = model.modelId === state.selectedModelId;
          return `
            <button type="button" class="wizard-model-card ${active ? "active" : ""}" data-model-id="${escapeHtml(model.modelId)}">
              <div class="wizard-model-card-thumb">
                ${cover ? `<img src="${escapeHtml(cover.previewUrl)}" alt="${escapeHtml(model.name)}" />` : `<div class="empty-state compact-empty">Sin foto</div>`}
              </div>
              <div class="wizard-model-card-body">
                <strong>${escapeHtml(model.name)}</strong>
                <p class="muted">${escapeHtml(model.clientName || "Libre")} · ${model.gender === "female" ? "Mujer" : "Hombre"}</p>
                <p class="muted">${model.photos.length} foto(s)</p>
              </div>
            </button>
          `;
        }).join("");
        modelCatalogNode.querySelectorAll(".wizard-model-card").forEach((button) => {
          button.addEventListener("click", () => {
            const modelId = button.getAttribute("data-model-id");
            const model = state.availableModels.find((item) => item.modelId === modelId);
            if (!model) {
              return;
            }
            state.selectedModelId = model.modelId;
            state.selectedModelPhotoIds = model.photos.slice(0, 4).map((photo) => photo.photoId);
            renderWizardState();
          });
        });
      }

      function renderSelectedModel() {
        if (!selectedModelEmptyNode || !selectedModelShell || !selectedModelName || !selectedModelMeta || !modelPhotoPicker) {
          return;
        }
        const selectedModel = state.availableModels.find((model) => model.modelId === state.selectedModelId);
        if (!selectedModel) {
          selectedModelEmptyNode.hidden = false;
          selectedModelShell.hidden = true;
          return;
        }
        selectedModelEmptyNode.hidden = true;
        selectedModelShell.hidden = false;
        selectedModelName.textContent = selectedModel.name;
        selectedModelMeta.textContent = [
          selectedModel.clientName || "Libre",
          selectedModel.gender === "female" ? "Mujer" : "Hombre",
          selectedModel.ageGroup ? modelAgeGroupLabels[selectedModel.ageGroup] || selectedModel.ageGroup : null
        ].filter(Boolean).join(" · ");
        modelPhotoPicker.innerHTML = selectedModel.photos.map((photo) => {
          const checked = state.selectedModelPhotoIds.includes(photo.photoId);
          return `
            <label class="wizard-model-photo-tile ${checked ? "active" : ""}" data-photo-id="${escapeHtml(photo.photoId)}">
              <input type="checkbox" class="wizard-model-photo-checkbox" value="${escapeHtml(photo.photoId)}" ${checked ? "checked" : ""} />
              <img src="${escapeHtml(photo.previewUrl)}" alt="Foto de ${escapeHtml(selectedModel.name)}" />
            </label>
          `;
        }).join("");
        modelPhotoPicker.querySelectorAll(".wizard-model-photo-checkbox").forEach((checkbox) => {
          checkbox.addEventListener("change", () => {
            state.selectedModelPhotoIds = Array.from(modelPhotoPicker.querySelectorAll(".wizard-model-photo-checkbox"))
              .filter((node) => node.checked)
              .map((node) => node.value);
            modelPhotoPicker.querySelectorAll(".wizard-model-photo-tile").forEach((tile) => {
              tile.classList.toggle("active", state.selectedModelPhotoIds.includes(tile.getAttribute("data-photo-id")));
            });
            renderWizardLiveSummary(summarizeGarments(state.garments));
          });
        });
      }

      async function addFiles(kind, files) {
        if (kind === "garments") {
          state.garments = mergeByKey(state.garments, files);
          renderWizardState();
          return;
      }
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
        target.value = "";
      });
      });

      imageSizeSelect?.addEventListener("change", renderProviderSettingsState);
      document.getElementById("wizard-client-id")?.addEventListener("change", () => {
        if (state.selectedModelId && !getFilteredModels().some((model) => model.modelId === state.selectedModelId)) {
          state.selectedModelId = "";
          state.selectedModelPhotoIds = [];
        }
        renderWizardState();
      });
      document.getElementById("wizard-fal-model")?.addEventListener("change", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
      document.getElementById("wizard-custom-width")?.addEventListener("input", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
      document.getElementById("wizard-custom-height")?.addEventListener("input", () => renderWizardLiveSummary(summarizeGarments(state.garments)));
      backgroundModeSelect?.addEventListener("change", () => {
        renderBackgroundState();
        renderWizardLiveSummary(summarizeGarments(state.garments));
      });
      backgroundBokehInput?.addEventListener("input", () => {
        renderBackgroundState();
        renderWizardLiveSummary(summarizeGarments(state.garments));
      });

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
        const promptValidationError = validateWizardStep(3, state);
        const backgroundValidationError = validateWizardStep(4, state);
        const providerValidationError = validateWizardStep(5, state);
        if (promptValidationError || backgroundValidationError || providerValidationError) {
          setWizardFeedback(promptValidationError || backgroundValidationError || providerValidationError, true);
          return;
      }
      try {
        submitButton.disabled = true;
        submitButton.textContent = "Preparando...";
        const formData = new FormData();
        appendFilesToFormData(formData, "garmentFiles", "garmentMeta", state.garments);
        formData.append("promptConfig", JSON.stringify({
          systemPrompt: document.getElementById("wizard-system-prompt")?.value || "",
          generalPrompt: document.getElementById("wizard-general-prompt")?.value || "",
          posePrompts: Object.fromEntries(Array.from(document.querySelectorAll(".wizard-pose-prompt")).map((field) => [
            field.getAttribute("data-pose-id"),
            field.value || ""
          ])),
          backgroundConfig: buildBackgroundConfigPayload(),
          providerSettings: buildProviderSettingsPayload()
          }));
          formData.append("clientId", document.getElementById("wizard-client-id")?.value || "");
          formData.append("modelSelection", JSON.stringify({
            modelId: state.selectedModelId,
            selectedPhotoIds: state.selectedModelPhotoIds
          }));

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
      renderBackgroundState();
    }

  function buildBackgroundConfigPayload() {
    return {
      mode: document.getElementById("wizard-background-mode")?.value || "white",
      bokehIntensity: Number(document.getElementById("wizard-background-bokeh")?.value || "45"),
      lightingStyle: document.getElementById("wizard-background-lighting")?.value || "clear_soft_daylight",
      scene: document.getElementById("wizard-background-scene")?.value || "none",
      dominantColor: document.getElementById("wizard-background-color")?.value || "white",
      backgroundProminence: document.getElementById("wizard-background-prominence")?.value || "minimal",
      contrast: document.getElementById("wizard-background-contrast")?.value || "soft",
      realismLevel: document.getElementById("wizard-background-realism")?.value || "catalogo_realista",
      subjectSeparation: document.getElementById("wizard-background-separation")?.value || "strong",
      noPeople: Boolean(document.getElementById("wizard-background-no-people")?.checked),
      noProps: Boolean(document.getElementById("wizard-background-no-props")?.checked),
      noText: Boolean(document.getElementById("wizard-background-no-text")?.checked),
      customInstructions: document.getElementById("wizard-background-custom")?.value || ""
    };
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
    if (step >= 2 && !state.selectedModelId) {
      return "Debes seleccionar un modelo antes de continuar.";
    }
    if (step >= 2 && state.selectedModelPhotoIds.length !== 4) {
      return "Debes seleccionar exactamente 4 fotos del modelo.";
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
        size: file.size,
        previewUrl: URL.createObjectURL(file)
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

  function bootModelsPage() {
    if (pageModel.page !== "models") {
      return;
    }
    const modal = document.getElementById("create-model-modal");
    const openButton = document.getElementById("open-create-model-modal");
    const closeButton = document.getElementById("close-create-model-modal");
    const submitButton = document.getElementById("submit-create-model-button");
    const nameField = document.getElementById("create-model-name");
    const clientField = document.getElementById("create-model-client-id");
    const ageGroupField = document.getElementById("create-model-age-group");
    const genderField = document.getElementById("create-model-gender");
    const fullBodyField = document.getElementById("create-model-full-body");
    const faceField = document.getElementById("create-model-face");
    const handsField = document.getElementById("create-model-hands");
    const feetField = document.getElementById("create-model-feet");
    const swimwearField = document.getElementById("create-model-swimwear");
    const photoInput = document.getElementById("create-model-photos-input");
    const existingPhotoSummary = document.getElementById("create-model-existing-photos-summary");
    const photoSummary = document.getElementById("create-model-photos-summary");
    const feedback = document.getElementById("create-model-feedback");
    const modalTitle = document.getElementById("model-modal-title");
    const availableModels = Array.isArray(pageModel.models) ? pageModel.models : [];
    const modalState = {
      mode: "create",
      modelId: "",
      existingPhotos: [],
      newPhotos: []
    };

    if (!modal || !openButton || !closeButton || !submitButton || !nameField || !clientField || !ageGroupField || !genderField || !fullBodyField || !faceField || !handsField || !feetField || !swimwearField || !photoInput || !existingPhotoSummary || !photoSummary || !feedback || !modalTitle) {
      return;
    }

    function setModelFeedback(message, isError) {
      feedback.textContent = message;
      feedback.style.color = isError ? "#fca5a5" : "#86efac";
    }

    function resetModalState() {
      modalState.mode = "create";
      modalState.modelId = "";
      modalState.existingPhotos = [];
      modalState.newPhotos = [];
      nameField.value = "";
      clientField.value = "";
      ageGroupField.value = "";
      genderField.value = "female";
      fullBodyField.checked = false;
      faceField.checked = true;
      handsField.checked = false;
      feetField.checked = false;
      swimwearField.checked = false;
      modalTitle.textContent = "Agregar modelo";
      submitButton.textContent = "Guardar modelo";
      setModelFeedback("", false);
    }

    function renderModelPhotos() {
      const keptExistingPhotos = modalState.existingPhotos.filter((photo) => photo.keep);
      if (!keptExistingPhotos.length) {
        existingPhotoSummary.innerHTML = `<div class="empty-state wizard-empty">No hay fotos actuales seleccionadas.</div>`;
      } else {
        existingPhotoSummary.innerHTML = keptExistingPhotos.map((item) => `
          <article class="wizard-summary-card model-photo-card">
            <div class="wizard-summary-thumb-grid"><img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" /></div>
            <strong>${escapeHtml(item.name)}</strong>
            <button type="button" class="secondary small model-photo-toggle-button" data-existing-photo-id="${escapeHtml(item.photoId)}">Quitar</button>
          </article>
        `).join("");
      }

      existingPhotoSummary.querySelectorAll(".model-photo-toggle-button").forEach((button) => {
        button.addEventListener("click", () => {
          const photoId = button.getAttribute("data-existing-photo-id");
          modalState.existingPhotos = modalState.existingPhotos.map((photo) => (
            photo.photoId === photoId ? { ...photo, keep: false } : photo
          ));
          renderModelPhotos();
        });
      });

      if (!modalState.newPhotos.length) {
        photoSummary.innerHTML = `<div class="empty-state wizard-empty">Aun no hay fotos nuevas cargadas.</div>`;
        return;
      }

      photoSummary.innerHTML = modalState.newPhotos.map((item) => `
        <article class="wizard-summary-card model-photo-card">
          <div class="wizard-summary-thumb-grid"><img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" /></div>
          <strong>${escapeHtml(item.name)}</strong>
          <button type="button" class="secondary small model-photo-remove-button" data-new-photo-key="${escapeHtml(item.key)}">Quitar</button>
        </article>
      `).join("");

      photoSummary.querySelectorAll(".model-photo-remove-button").forEach((button) => {
        button.addEventListener("click", () => {
          const photoKey = button.getAttribute("data-new-photo-key");
          modalState.newPhotos = modalState.newPhotos.filter((photo) => photo.key !== photoKey);
          renderModelPhotos();
        });
      });
    }

    function renderRemovedExistingPhotos() {
      const removedPhotos = modalState.existingPhotos.filter((photo) => !photo.keep);
      if (!removedPhotos.length) {
        return;
      }
      existingPhotoSummary.insertAdjacentHTML("beforeend", removedPhotos.map((item) => `
        <article class="wizard-summary-card model-photo-card removed">
          <div class="wizard-summary-thumb-grid"><img src="${escapeHtml(item.previewUrl)}" alt="${escapeHtml(item.name)}" /></div>
          <strong>${escapeHtml(item.name)}</strong>
          <button type="button" class="secondary small model-photo-restore-button" data-existing-photo-id="${escapeHtml(item.photoId)}">Restaurar</button>
        </article>
      `).join(""));
      existingPhotoSummary.querySelectorAll(".model-photo-restore-button").forEach((button) => {
        button.addEventListener("click", () => {
          const photoId = button.getAttribute("data-existing-photo-id");
          modalState.existingPhotos = modalState.existingPhotos.map((photo) => (
            photo.photoId === photoId ? { ...photo, keep: true } : photo
          ));
          renderModelPhotos();
        });
      });
    }

    function syncRenderedPhotos() {
      renderModelPhotos();
      renderRemovedExistingPhotos();
    }

    function totalSelectedPhotos() {
      return modalState.existingPhotos.filter((photo) => photo.keep).length + modalState.newPhotos.length;
    }

    function openCreateModal() {
      resetModalState();
      modal.hidden = false;
    }

    function openEditModal(modelId) {
      const model = availableModels.find((item) => item.modelId === modelId);
      if (!model) {
        return;
      }
      resetModalState();
      modalState.mode = "edit";
      modalState.modelId = model.modelId;
      modalState.existingPhotos = (model.photos || []).map((photo) => ({
        ...photo,
        keep: true
      }));
      nameField.value = model.name || "";
      clientField.value = model.clientId || "";
      ageGroupField.value = model.ageGroup || "";
      genderField.value = model.gender || "female";
      fullBodyField.checked = Boolean(model.includesFullBody);
      faceField.checked = Boolean(model.includesFace);
      handsField.checked = Boolean(model.includesHands);
      feetField.checked = Boolean(model.includesFeet);
      swimwearField.checked = Boolean(model.includesSwimwear);
      modalTitle.textContent = "Editar modelo";
      submitButton.textContent = "Guardar cambios";
      modal.hidden = false;
      syncRenderedPhotos();
    }

    function closeModal() {
      modal.hidden = true;
    }

    openButton.addEventListener("click", openCreateModal);
    document.querySelectorAll(".model-edit-button").forEach((button) => {
      button.addEventListener("click", () => openEditModal(button.getAttribute("data-model-id")));
    });
    document.querySelectorAll(".model-delete-button").forEach((button) => {
      button.addEventListener("click", async () => {
        const modelId = button.getAttribute("data-model-id");
        const modelName = button.getAttribute("data-model-name") || "este modelo";
        if (!modelId || !window.confirm(`Vas a eliminar ${modelName}. Esta accion no se puede deshacer.`)) {
          return;
        }
        try {
          button.disabled = true;
          const response = await fetch(`/api/models/${encodeURIComponent(modelId)}/delete`, {
            method: "POST"
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(payload.error || "No se pudo eliminar el modelo.");
          }
          window.location.reload();
        } catch (error) {
          window.alert(error.message || "No se pudo eliminar el modelo.");
        } finally {
          button.disabled = false;
        }
      });
    });
    closeButton.addEventListener("click", closeModal);
    modal.addEventListener("click", (event) => {
      if (event.target === modal) {
        closeModal();
      }
    });
    photoInput.addEventListener("change", (event) => {
      const remainingSlots = Math.max(0, 10 - totalSelectedPhotos());
      const normalized = Array.from(event.currentTarget.files || []).map((file) => normalizePickedFile(file)).slice(0, remainingSlots);
      modalState.newPhotos = mergeByKey(modalState.newPhotos, normalized).slice(0, Math.max(0, 10 - modalState.existingPhotos.filter((photo) => photo.keep).length));
      syncRenderedPhotos();
      event.currentTarget.value = "";
    });
    modal.querySelector('[data-target-input="create-model-photos-input"]')?.addEventListener("click", () => {
      photoInput.click();
    });
    modal.querySelector('[data-dropzone="catalog-model-photos"]')?.addEventListener("dragover", (event) => {
      event.preventDefault();
      event.currentTarget.classList.add("is-dragover");
    });
    modal.querySelector('[data-dropzone="catalog-model-photos"]')?.addEventListener("dragleave", (event) => {
      event.currentTarget.classList.remove("is-dragover");
    });
    modal.querySelector('[data-dropzone="catalog-model-photos"]')?.addEventListener("drop", async (event) => {
      event.preventDefault();
      event.currentTarget.classList.remove("is-dragover");
      const remainingSlots = Math.max(0, 10 - totalSelectedPhotos());
      const dropped = (await collectDroppedFiles(event.dataTransfer)).slice(0, remainingSlots);
      modalState.newPhotos = mergeByKey(modalState.newPhotos, dropped).slice(0, Math.max(0, 10 - modalState.existingPhotos.filter((photo) => photo.keep).length));
      syncRenderedPhotos();
    });

    submitButton.addEventListener("click", async () => {
      if (!nameField.value.trim()) {
        setModelFeedback("Debes escribir un nombre para el modelo.", true);
        return;
      }
      if (totalSelectedPhotos() < 1) {
        setModelFeedback("Debes dejar al menos una foto del modelo.", true);
        return;
      }
      try {
        submitButton.disabled = true;
        submitButton.textContent = modalState.mode === "edit" ? "Guardando cambios..." : "Guardando...";
        const formData = new FormData();
        formData.append("name", nameField.value.trim());
        formData.append("clientId", clientField.value || "");
        formData.append("ageGroup", ageGroupField.value || "");
        formData.append("gender", genderField.value || "female");
        formData.append("includesFullBody", String(Boolean(fullBodyField.checked)));
        formData.append("includesFace", String(Boolean(faceField.checked)));
        formData.append("includesHands", String(Boolean(handsField.checked)));
        formData.append("includesFeet", String(Boolean(feetField.checked)));
        formData.append("includesSwimwear", String(Boolean(swimwearField.checked)));
        formData.append("keepPhotoIds", JSON.stringify(modalState.existingPhotos.filter((photo) => photo.keep).map((photo) => photo.photoId)));
        modalState.newPhotos.forEach((item) => formData.append("modelPhotos", item.file, item.name));
        const endpoint = modalState.mode === "edit" ? `/api/models/${encodeURIComponent(modalState.modelId)}` : "/api/models";
        const response = await fetch(endpoint, {
          method: "POST",
          body: formData
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(payload.error || "No se pudo guardar el modelo.");
        }
        setModelFeedback(
          modalState.mode === "edit"
            ? `Modelo ${payload.model.name} actualizado.`
            : `Modelo ${payload.model.name} guardado.`,
          false
        );
        window.setTimeout(() => window.location.reload(), 500);
      } catch (error) {
        setModelFeedback(error.message || "No se pudo guardar el modelo.", true);
      } finally {
        submitButton.disabled = false;
        submitButton.textContent = modalState.mode === "edit" ? "Guardar cambios" : "Guardar modelo";
      }
    });

    syncRenderedPhotos();
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
  bootCarousels();
  bootPromptDrafts();
  bootBatchesPage();
  bootClientsPage();
  bootModelsPage();
})();
