import {
  CAlert,
  CBadge,
  CButton,
  CCard,
  CCardBody,
  CModal,
  CModalBody,
  CModalFooter,
  CModalHeader,
  CModalTitle,
  CFormLabel,
  CFormSelect,
  CFormTextarea,
  CProgress,
  CSpinner
} from "@coreui/react";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { api } from "../api";
import type { ProductManifest, ReviewContext } from "../types";
import { EmptyState, SectionHero, useAsyncEffect } from "./shared";
export function ReviewPage() {
  const { id } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const pathProductId = location.pathname.startsWith("/review/")
    ? decodeURIComponent(location.pathname.replace(/^\/review\//, ""))
    : undefined;
  const requestedProductId = id || pathProductId || undefined;
  const requestedBatchId = searchParams.get("batchId") || undefined;
  const [context, setContext] = useState<ReviewContext | null>(null);
  const [falModelOptions, setFalModelOptions] = useState<string[]>([]);
  const [activeProductId, setActiveProductId] = useState("");
  const [productCache, setProductCache] = useState<Record<string, ProductManifest>>({});
  const [selectionDrafts, setSelectionDrafts] = useState<Record<string, Record<string, string>>>({});
  const [promptDrafts, setPromptDrafts] = useState<Record<string, Record<string, string>>>({});
  const [providerDrafts, setProviderDrafts] = useState<Record<string, Record<string, string>>>({});
  const [visibleOutputDrafts, setVisibleOutputDrafts] = useState<Record<string, Record<string, string>>>({});
  const [regeneratingDrafts, setRegeneratingDrafts] = useState<Record<string, Record<string, boolean>>>({});
  const [pendingDelete, setPendingDelete] = useState<null | {
    productId: string;
    poseId: string;
    outputId: string;
  }>(null);

  function buildDrafts(nextProduct: ProductManifest, providerModelId: string) {
    const nextSelectionMap: Record<string, string> = {};
    const nextPromptOverrides: Record<string, string> = {};
    const nextProviderOverrides: Record<string, string> = {};
    const nextVisibleOutputs: Record<string, string> = {};
    for (const pose of nextProduct.poses) {
      const poseOutputs = nextProduct.outputs.filter((output) => output.poseId === pose.poseId);
      const approvedOutputId = nextProduct.approved[pose.poseId]?.[0] || "";
      nextSelectionMap[pose.poseId] = "";
      nextPromptOverrides[pose.poseId] = pose.lastPromptUsed || pose.promptPreview || pose.promptOverride || "";
      nextProviderOverrides[pose.poseId] = pose.providerModelId || providerModelId;
      nextVisibleOutputs[pose.poseId] = approvedOutputId || poseOutputs.at(-1)?.outputId || "";
    }
    return { nextSelectionMap, nextPromptOverrides, nextProviderOverrides, nextVisibleOutputs };
  }

  async function hydrate(preferredProductId?: string) {
    const nextContext = await api.getReviewContext(preferredProductId, requestedBatchId);
    setContext(nextContext);
    if (!nextContext.product) {
      setActiveProductId("");
      return nextContext;
    }
    setProductCache((current) => ({
      ...current,
      [nextContext.product!.productId]: nextContext.product!
    }));
    const { nextSelectionMap, nextPromptOverrides, nextProviderOverrides, nextVisibleOutputs } = buildDrafts(
      nextContext.product,
      nextContext.currentProviderModelId
    );
    setSelectionDrafts((current) => current[nextContext.product!.productId] ? current : {
      ...current,
      [nextContext.product!.productId]: nextSelectionMap
    });
    setPromptDrafts((current) => current[nextContext.product!.productId] ? current : {
      ...current,
      [nextContext.product!.productId]: nextPromptOverrides
    });
    setProviderDrafts((current) => current[nextContext.product!.productId] ? current : {
      ...current,
      [nextContext.product!.productId]: nextProviderOverrides
    });
    setVisibleOutputDrafts((current) => {
      const currentProductOutputs = current[nextContext.product!.productId] ?? {};
      const nextProductOutputs = Object.fromEntries(nextContext.product!.poses.map((pose) => {
        const poseOutputs = nextContext.product!.outputs.filter((output) => output.poseId === pose.poseId);
        const currentVisibleOutputId = currentProductOutputs[pose.poseId];
        const stillExists = poseOutputs.some((output) => output.outputId === currentVisibleOutputId);
        return [pose.poseId, stillExists ? currentVisibleOutputId : (nextVisibleOutputs[pose.poseId] || "")];
      }));
      return {
        ...current,
        [nextContext.product!.productId]: nextProductOutputs
      };
    });
    setRegeneratingDrafts((current) => {
      const currentProductDrafts = current[nextContext.product!.productId] ?? {};
      const nextProductDrafts = Object.fromEntries(
        nextContext.product!.poses.map((pose) => [
          pose.poseId,
          currentProductDrafts[pose.poseId] && !["ready", "error"].includes(pose.status)
        ])
      );
      return {
        ...current,
        [nextContext.product!.productId]: nextProductDrafts
      };
    });
    setActiveProductId(nextContext.product.productId);
    return nextContext;
  }

  useAsyncEffect(async () => {
    await hydrate(requestedProductId);
  }, [requestedBatchId, requestedProductId]);

  useAsyncEffect(async () => {
    const wizard = await api.getWizardData();
    setFalModelOptions(wizard.falModelOptions);
  }, []);

  const orderedProductIds = useMemo(() => {
    const ids = context?.allProducts.map((item) => item.productId) ?? [];
    if (activeProductId && !ids.includes(activeProductId)) {
      return [...ids, activeProductId];
    }
    return ids;
  }, [activeProductId, context?.allProducts]);

  const activeIndex = Math.max(0, orderedProductIds.indexOf(activeProductId));
  const product = (activeProductId ? productCache[activeProductId] : null) ?? context?.product ?? null;

  useEffect(() => {
    const shouldPoll = !product
      || ["pending", "generating"].includes(product.status)
      || product.poses.some((pose) => ["pending", "generating"].includes(pose.status));
    if (!shouldPoll) {
      return;
    }
    const handle = window.setInterval(() => {
      void hydrate(product?.productId || requestedProductId);
    }, 4000);
    return () => window.clearInterval(handle);
  }, [product, requestedBatchId, requestedProductId]);

  const selectionMap = product ? selectionDrafts[product.productId] ?? {} : {};
  const promptOverrides = product ? promptDrafts[product.productId] ?? {} : {};
  const providerOverrides = product ? providerDrafts[product.productId] ?? {} : {};
  const selectedCount = Object.values(selectionMap).filter(Boolean).length;
  const completedProducts = useMemo(
    () => Object.fromEntries(
      orderedProductIds.map((productId) => {
        const cachedProduct = productCache[productId] ?? (context?.product?.productId === productId ? context.product : null);
        const draftSelections = selectionDrafts[productId] ?? {};
        const required = cachedProduct?.poses.length ?? 0;
        const selected = Object.values(draftSelections).filter(Boolean).length;
        return [productId, required > 0 && selected >= required];
      })
    ),
    [orderedProductIds, productCache, context?.product, selectionDrafts]
  );
  const visibleOutputMap = product ? visibleOutputDrafts[product.productId] ?? {} : {};
  const regeneratingMap = product ? regeneratingDrafts[product.productId] ?? {} : {};
  const reviewRows = product?.poses.map((pose) => {
    const outputs = product.outputs.filter((output) => output.poseId === pose.poseId);
    const visibleOutputId = visibleOutputMap[pose.poseId] || "";
    const visibleIndex = outputs.findIndex((output) => output.outputId === visibleOutputId);
    const activeIndex = visibleIndex >= 0 ? visibleIndex : Math.max(0, outputs.length - 1);
    const output = outputs[activeIndex] ?? null;
    const isRegenerating = Boolean(regeneratingMap[pose.poseId]);
    const isInitialGenerationLoading = !output && pose.status === "pending" && (product.status === "pending" || product.status === "generating");
    const showLoader = isRegenerating || pose.status === "generating" || isInitialGenerationLoading;
    return { pose, output, outputs, activeIndex, isRegenerating, showLoader };
  }) ?? [];

  return (
    <>
      <CModal
        visible={Boolean(pendingDelete)}
        alignment="center"
        onClose={() => setPendingDelete(null)}
      >
        <CModalHeader>
          <CModalTitle>Eliminar imagen</CModalTitle>
        </CModalHeader>
        <CModalBody>
          Esta accion eliminara la imagen generada actualmente visible dentro de la card. Quieres continuar?
        </CModalBody>
        <CModalFooter>
          <CButton color="light" variant="outline" onClick={() => setPendingDelete(null)}>
            Cancelar
          </CButton>
          <CButton
            color="danger"
            onClick={async () => {
              if (!pendingDelete) {
                return;
              }
              const result = await api.deleteOutput(pendingDelete.productId, pendingDelete.outputId, requestedBatchId);
              setProductCache((current) => ({
                ...current,
                [result.product.productId]: result.product
              }));
              setSelectionDrafts((current) => ({
                ...current,
                [pendingDelete.productId]: {
                  ...(current[pendingDelete.productId] ?? {}),
                  [pendingDelete.poseId]: ""
                }
              }));
              setPendingDelete(null);
              await hydrate(product?.productId || pendingDelete.productId);
            }}
          >
            Eliminar imagen
          </CButton>
        </CModalFooter>
      </CModal>

      <SectionHero
        eyebrow="Revision"
        title={product?.productId || (requestedProductId || requestedBatchId ? "Preparando revision" : "Sin producto activo")}
        subtitle={product ? `${product.category} · ${product.status}` : (requestedProductId || requestedBatchId ? "Esperando a que el producto inicial quede disponible en el batch." : "No hay producto actualmente en foco.")}
        actions={
          <>
            <CButton color="light" variant="outline" onClick={() => void api.saveBatchState()}>Guardar batch</CButton>
            <CButton
              color="light"
              variant="outline"
              disabled={activeIndex <= 0}
              onClick={() => {
                const previousId = orderedProductIds[activeIndex - 1];
                if (previousId) {
                  void hydrate(previousId);
                }
              }}
            >
              Anterior
            </CButton>
            <CButton
              color="primary"
              disabled={activeIndex < 0 || activeIndex >= orderedProductIds.length - 1}
              onClick={() => {
                const nextId = orderedProductIds[activeIndex + 1];
                if (nextId) {
                  void hydrate(nextId);
                }
              }}
            >
              Siguiente
            </CButton>
          </>
        }
      />

      {product ? (
        <>
          <CCard className="shadow-sm mb-4">
            <CCardBody>
              <div className="review-carousel mb-4">
                <CButton
                  color="light"
                  variant="outline"
                  disabled={activeIndex <= 0}
                  onClick={() => {
                    const previousId = orderedProductIds[activeIndex - 1];
                    if (previousId) {
                      void hydrate(previousId);
                    }
                  }}
                >
                  <i className="cil-chevron-left" />
                </CButton>
                <div className="review-carousel-track">
                  {orderedProductIds.map((productId, index) => (
                    <button
                      type="button"
                      key={productId}
                      className={`review-carousel-slide${productId === product.productId ? " active" : ""}${completedProducts[productId] ? " complete" : ""}`}
                      onClick={() => void hydrate(productId)}
                    >
                      <span className="fw-semibold">Prenda {index + 1}</span>
                      <span className="small text-body-secondary">{productId}</span>
                    </button>
                  ))}
                </div>
                <CButton
                  color="light"
                  variant="outline"
                  disabled={activeIndex < 0 || activeIndex >= orderedProductIds.length - 1}
                  onClick={() => {
                    const nextId = orderedProductIds[activeIndex + 1];
                    if (nextId) {
                      void hydrate(nextId);
                    }
                  }}
                >
                  <i className="cil-chevron-right" />
                </CButton>
              </div>

              <div className="review-product-toolbar">
                <div>
                  <div className="fw-semibold">Estado de aprobacion</div>
                  <div className="small text-body-secondary">
                    {selectedCount} de {product.poses.length} referencias seleccionadas
                  </div>
                </div>
                <CBadge color={product.status === "approved" ? "success" : product.status === "error" ? "danger" : "warning"}>
                  {product.status}
                </CBadge>
              </div>
              <div className="mb-4">
                <div className="d-flex justify-content-between mb-2">
                  <span>{selectedCount} de {product.poses.length} referencias seleccionadas</span>
                  <span className="text-body-secondary">{Math.round((selectedCount / product.poses.length) * 100 || 0)}%</span>
                </div>
                <CProgress value={(selectedCount / product.poses.length) * 100 || 0} />
              </div>
              <div className="review-card-list">
                {reviewRows.map(({ pose, output, outputs, activeIndex, isRegenerating, showLoader }) => (
                  <CCard className={`shadow-sm review-output-row-card${selectionMap[pose.poseId] === output?.outputId ? " selected" : ""}`} key={pose.poseId}>
                    <CCardBody className="review-output-row-layout">
                      <div className="review-output-row-media">
                        {output ? (
                          <>
                            <div className="review-output-toolbar">
                              <div className="review-output-carousel-controls">
                                <CButton
                                  color="light"
                                  variant="outline"
                                  size="sm"
                                  disabled={outputs.length < 2 || isRegenerating}
                                  onClick={() => {
                                    const nextIndex = activeIndex <= 0 ? outputs.length - 1 : activeIndex - 1;
                                    const nextOutput = outputs[nextIndex];
                                    if (!nextOutput) {
                                      return;
                                    }
                                    setVisibleOutputDrafts((current) => ({
                                      ...current,
                                      [product.productId]: {
                                        ...(current[product.productId] ?? {}),
                                        [pose.poseId]: nextOutput.outputId
                                      }
                                    }));
                                  }}
                                >
                                  Anterior
                                </CButton>
                                <span className="review-output-carousel-index">
                                  {outputs.length ? `${activeIndex + 1} / ${outputs.length}` : "0 / 0"}
                                </span>
                                <CButton
                                  color="light"
                                  variant="outline"
                                  size="sm"
                                  disabled={outputs.length < 2 || isRegenerating}
                                  onClick={() => {
                                    const nextIndex = activeIndex >= outputs.length - 1 ? 0 : activeIndex + 1;
                                    const nextOutput = outputs[nextIndex];
                                    if (!nextOutput) {
                                      return;
                                    }
                                    setVisibleOutputDrafts((current) => ({
                                      ...current,
                                      [product.productId]: {
                                        ...(current[product.productId] ?? {}),
                                        [pose.poseId]: nextOutput.outputId
                                      }
                                    }));
                                  }}
                                >
                                  Siguiente
                                </CButton>
                              </div>
                              {outputs.length ? (
                                <div className="review-output-thumbnail-strip">
                                  {outputs.map((candidate, index) => (
                                    <button
                                      type="button"
                                      key={candidate.outputId}
                                      className={`review-output-thumbnail${candidate.outputId === output.outputId ? " active" : ""}`}
                                      disabled={isRegenerating}
                                      onClick={() => {
                                        setVisibleOutputDrafts((current) => ({
                                          ...current,
                                          [product.productId]: {
                                            ...(current[product.productId] ?? {}),
                                            [pose.poseId]: candidate.outputId
                                          }
                                        }));
                                      }}
                                      aria-label={`Ver variante ${index + 1} de ${outputs.length}`}
                                    >
                                      <img src={candidate.previewUrl} alt={candidate.outputId} />
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                            <div className="review-output-row-image">
                              <button
                                type="button"
                                className="review-output-image-button"
                                disabled={isRegenerating}
                                onClick={() => {
                                  setSelectionDrafts((current) => ({
                                    ...current,
                                    [product.productId]: {
                                      ...(current[product.productId] ?? {}),
                                      [pose.poseId]: current[product.productId]?.[pose.poseId] === output.outputId ? "" : output.outputId
                                    }
                                  }));
                                }}
                              >
                                <img src={output.previewUrl} alt={output.outputId} />
                              </button>
                              {showLoader ? (
                                <div className="review-output-loading-overlay">
                                  <CSpinner color="light" />
                                  <span>Regenerando imagen...</span>
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : (
                          <div className="review-output-empty">
                            {showLoader ? (
                              <div className="review-output-empty-loading">
                                <CSpinner color="light" />
                                <span>Generando imagen para esta referencia...</span>
                              </div>
                            ) : "Sin imagen todavia."}
                          </div>
                        )}
                      </div>
                      <div className="review-output-row-details">
                        <div className="d-flex justify-content-between align-items-start gap-3 mb-3">
                          <div>
                            <div className="fw-semibold">{pose.poseId.toUpperCase()}</div>
                            <div className="small text-body-secondary">
                              {pose.status}{output ? ` · ${output.outputId}` : ""}{outputs.length > 1 ? ` · ${outputs.length} variantes` : ""}
                            </div>
                          </div>
                          <CBadge color={selectionMap[pose.poseId] === output?.outputId ? "success" : "warning"}>
                            {selectionMap[pose.poseId] === output?.outputId ? "seleccionada" : "pendiente"}
                          </CBadge>
                        </div>

                        <div className="wizard-field">
                          <CFormLabel>Prompt</CFormLabel>
                          <CFormTextarea
                            rows={8}
                            value={promptOverrides[pose.poseId] || ""}
                            onChange={(event) => setPromptDrafts((current) => ({
                              ...current,
                              [product.productId]: {
                                ...(current[product.productId] ?? {}),
                                [pose.poseId]: event.target.value
                              }
                            }))}
                          />
                        </div>

                        <div className="wizard-field">
                          <CFormLabel>Modelo IA</CFormLabel>
                          <CFormSelect
                            value={providerOverrides[pose.poseId] || context?.currentProviderModelId || ""}
                            onChange={(event) => setProviderDrafts((current) => ({
                              ...current,
                              [product.productId]: {
                                ...(current[product.productId] ?? {}),
                                [pose.poseId]: event.target.value
                              }
                            }))}
                          >
                            {Array.from(new Set([
                              context?.currentProviderModelId || "",
                              ...falModelOptions
                            ].filter(Boolean))).map((modelId) => (
                              <option key={modelId} value={modelId}>{modelId}</option>
                            ))}
                          </CFormSelect>
                        </div>

                        <div className="d-flex gap-2 flex-wrap">
                          {output ? (
                            <CButton
                              color="danger"
                              variant="outline"
                              onClick={() => {
                                setPendingDelete({
                                  productId: product.productId,
                                  poseId: pose.poseId,
                                  outputId: output.outputId
                                });
                              }}
                            >
                              Eliminar imagen
                            </CButton>
                          ) : null}
                          <CButton
                            color="light"
                            variant="outline"
                            disabled={isRegenerating}
                            onClick={async () => {
                              setSelectionDrafts((current) => ({
                                ...current,
                                [product.productId]: {
                                  ...(current[product.productId] ?? {}),
                                  [pose.poseId]: ""
                                }
                              }));
                              setProductCache((current) => {
                                const currentProduct = current[product.productId];
                                if (!currentProduct) {
                                  return current;
                                }
                                return {
                                  ...current,
                                  [product.productId]: {
                                    ...currentProduct,
                                    status: "generating",
                                    lastError: undefined,
                                    poses: currentProduct.poses.map((currentPose) => currentPose.poseId === pose.poseId
                                      ? {
                                          ...currentPose,
                                          status: "generating",
                                          lastError: undefined
                                        }
                                      : currentPose)
                                  }
                                };
                              });
                              setRegeneratingDrafts((current) => ({
                                ...current,
                                [product.productId]: {
                                  ...(current[product.productId] ?? {}),
                                  [pose.poseId]: true
                                }
                              }));
                              try {
                                await api.regenerate(product.productId, pose.poseId, {
                                  promptOverride: promptOverrides[pose.poseId] || "",
                                  providerModelId: providerOverrides[pose.poseId] || context?.currentProviderModelId || ""
                                }, requestedBatchId);
                                const hydrated = await hydrate(product.productId);
                                const refreshedProduct = hydrated?.product;
                                const refreshedOutputs = refreshedProduct?.outputs.filter((item) => item.poseId === pose.poseId) ?? [];
                                const newestOutput = refreshedOutputs.at(-1);
                                if (newestOutput) {
                                  setVisibleOutputDrafts((current) => ({
                                    ...current,
                                    [product.productId]: {
                                      ...(current[product.productId] ?? {}),
                                      [pose.poseId]: newestOutput.outputId
                                    }
                                  }));
                                }
                              } catch (error) {
                                setRegeneratingDrafts((current) => ({
                                  ...current,
                                  [product.productId]: {
                                    ...(current[product.productId] ?? {}),
                                    [pose.poseId]: false
                                  }
                                }));
                                await hydrate(product.productId);
                              }
                            }}
                          >
                            Regenerar referencia
                          </CButton>
                        </div>

                        {pose.lastError ? <CAlert color="danger" className="mb-0 mt-3">{pose.lastError}</CAlert> : null}
                      </div>
                    </CCardBody>
                  </CCard>
                ))}
              </div>

              <CButton
                color="success"
                className="w-100 mt-4"
                onClick={async () => {
                  const result = await api.finalize(product.productId, selectionMap, requestedBatchId);
                  if (result.nextProductId) {
                    await hydrate(result.nextProductId);
                    return;
                  }
                  await hydrate(product.productId);
                }}
                disabled={selectedCount < product.poses.length}
              >
                Aprobar prenda y seguir
              </CButton>
            </CCardBody>
          </CCard>

          {product.garmentPreviewUrls[0] ? (
            <div className="review-garment-dock">
              <div className="review-garment-dock-label">Prenda fuente</div>
              <div className="review-garment-dock-thumb">
                <img src={product.garmentPreviewUrls[0].previewUrl} alt={product.garmentPreviewUrls[0].name} />
                <div className="review-garment-dock-preview">
                  <img src={product.garmentPreviewUrls[0].previewUrl} alt={product.garmentPreviewUrls[0].name} />
                </div>
              </div>
            </div>
          ) : null}
        </>
      ) : requestedProductId || requestedBatchId ? (
        <EmptyState title="Preparando revision" body="Estamos esperando a que el batch termine de registrar el producto inicial." />
      ) : (
        <EmptyState title="No hay productos para revisar" body="Puedes crear un batch nuevo desde la pantalla de generacion." />
      )}
    </>
  );
}
