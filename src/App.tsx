import { BrandLogo } from "./components/BrandLogo";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sampleTemplate } from "./data/sampleTemplate";
import { sampleData } from "./data/sampleData";
import type {
  Asset,
  Binding,
  EditorGuide,
  EditorSettings,
  PreviewMode,
  ReportElement,
  ReportPage,
  ReportTemplate,
  ShapeKind,
  TableSelection,
} from "./types/report";
import type { SnapGuide } from "./engine/editorMath";
import {
  distribute,
  formatUnit,
  PX_PER_INCH,
  rotateGroupedElements,
  scaleGroupedElements,
  translateSelectedElements,
} from "./engine/editorMath";
import { normalizeElementCorners } from "./engine/corners";
import { createUnionShape, evaluateShapeUnion } from "./engine/shapeUnion";
import {
  openedTemplateEditorState,
  savedTemplateEditorState,
} from "./engine/editorNavigation";
import { nextSelection } from "./engine/selection";
import {
  canMutateDocument,
  type EditorDocumentMode,
} from "./engine/documentPermissions";
import {
  captureEditorHistory,
  type EditorHistorySnapshot,
  upsertManualOverride,
} from "./engine/reportDocumentHistory";
import { CanvasElement } from "./components/CanvasElement";
import type { NarrativeFitListener } from "./components/useNarrativeFontFit";
import { ApplicationHub, GlobalNavigation, type Destination } from "./components/ApplicationHub";
import { NarrativeWorkspace } from "./components/NarrativeWorkspace";
import { ReviewDialog } from "./components/ReviewDialog";
import { pageSection, fitPageZoom } from "./engine/workspaceLayout";
import { displayAssetName } from "./shared/assetNames";
import "./styles/workspace.css";
import { Inspector } from "./components/Inspector";
import { DataBrowser } from "./components/DataBrowser";
import { ValidationPanel } from "./components/ValidationPanel";
import { CreateReportWizard } from "./components/CreateReportWizard";
import { ReconciliationDrilldown } from "./components/ReconciliationDrilldown";
import { validatePage } from "./engine/validation";
import { localPersistence } from "./services/persistence";
import { assetStorage } from "./services/assetStorage";
import { exportReportPdf } from "./services/pdfExport";
import { exportChromiumPdf } from "./renderers/pdf/ChromiumPdfClient";
import {
  classifyExportError,
  describeExportFailure,
} from "./services/pdfExportDiagnostics";
import {
  runExportPreflight,
  type ExportPreflightIssue,
} from "./report-engine/validation/exportPreflight";
import {
  assessExportQa,
  asExportAdvisory,
} from "./report-engine/validation/exportQa";
import { prepareTemplateForPublication } from "./report-engine/generation/prepareTemplate";
import {
  generateReportInstance,
  type GenerationProgress,
} from "./report-engine/generation/generateReport";
import { buildPresentationModel } from "./report-engine/bindings/presentationModel";
import { q2SampleReport } from "./data-providers/sample/q2SampleReport";
import type {
  ManualOverride,
  ReportGenerationRequest,
  ReportInstance,
} from "./report-engine/schema/generation";
import type { IndustrialMarketReport } from "./report-engine/schema/industrialMarketReport";
import { getByContextPath } from "./engine/bindings";
import { isPlainDisplayValue, withTableDisplayOverrides } from "./engine/tableValueOverrides";
import {
  elementRect,
  getRotatedAabb,
  normalizeRotation,
} from "./engine/geometry";
import {
  replaceImageAsset,
  replaceTemplateImageAsset,
} from "./engine/imageReplacement";
import {
  fontFamilyToCss,
  groupFontAssets,
  installManagedFonts,
  resolveAvailableManagedFontFace,
  type ManagedFontFaceDiagnostic,
} from "./services/fontRegistry";
import { normalizeReportTemplateFonts } from "./services/templateNormalization";
import {
  approvedManagedFontAssets,
  inferFontGovernanceStatus,
} from "./services/fontGovernance";
import {
  TemplateSaveConflictError,
  templateStore,
} from "./services/templateStore";
import {
  ReportSaveConflictError,
  reportInstanceStore,
} from "./services/reportInstanceStore";
import { reportRecovery } from "./services/reportRecovery";
import { templateRecovery } from "./services/templateRecovery";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "./types/templateLibrary";
import "./styles/app.css";
import "./styles/advanced.css";
import "./styles/ux-quick-wins.css";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const uid = (prefix = "item") => `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
const defaultSettings: EditorSettings = {
  unit: "px",
  gridEnabled: false,
  gridSpacingPx: 24,
  gridOpacity: 0.2,
  snapToGrid: false,
  snapToElements: true,
  snapToMargins: true,
  marginPx: 48,
  marginsEnabled: true,
  rulersEnabled: true,
  customGuides: [],
};

function hydrate(input: ReportTemplate): ReportTemplate {
  const normalized = normalizeReportTemplateFonts(input, input.assets ?? []);
  return {
    ...clone(normalized),
    assets: input.assets ?? [],
    settings: { ...defaultSettings, ...input.settings },
    pages: input.pages.map((page) => ({
      ...page,
      elements: page.elements.map((rawElement) => {
        const element = normalizeElementCorners(rawElement);
        return {
          ...element,
          rotation: normalizeRotation(element.rotation),
          style: {
            ...element.style,
            typography: element.style.typography
              ? {
                  ...element.style.typography,
                  fontStyle:
                    element.style.typography.fontStyle ??
                    (element.style.typography.italic ? "italic" : "normal"),
                }
              : undefined,
          },
        };
      }),
    })),
  };
}

type LeftTab =
  | "templates"
  | "elements"
  | "text"
  | "images"
  | "uploads"
  | "fonts"
  | "data"
  | "pages"
  | "validate";
type ContextMenuState = { x: number; y: number; id: string } | undefined;
type ReportSaveStatus =
  "clean" | "dirty" | "saving" | "saved" | "error" | "conflict";

export default function App() {
  const initialParams = new URLSearchParams(window.location.search);
  const [destination, setDestination] = useState<Destination>(() => initialParams.get("editor") === "1" || initialParams.has("report") || initialParams.get("workspace") === "editor" ? "editor" : (initialParams.get("workspace") as Destination) || "home");
  const [documentLoading, setDocumentLoading] = useState(true);
  const [openError, setOpenError] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false);
  const [panelWidth, setPanelWidth] = useState(() => Math.min(420, Math.max(220, Number(localStorage.getItem("lrs.panel-width")) || 260)));
  const [inspectorWidth, setInspectorWidth] = useState(() => Math.min(480, Math.max(240, Number(localStorage.getItem("lrs.inspector-width")) || 300)));
  const [fitMode, setFitMode] = useState<"page" | "width" | undefined>("page");
  const [pageSearch, setPageSearch] = useState("");
  const [templateFilter, setTemplateFilter] = useState("draft");
  const [showPublishReport, setShowPublishReport] = useState(false);
  const [showPublishReview, setShowPublishReview] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [showNarratives, setShowNarratives] = useState(false);
  const [narrativeDirty, setNarrativeDirty] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const [pendingLibraryPdf, setPendingLibraryPdf] = useState(false);
  const [templateSaving, setTemplateSaving] = useState(false);
  const [templateDirty, setTemplateDirty] = useState(false);
  const [templateRecovered, setTemplateRecovered] = useState(false);
  const [template, setTemplate] = useState<ReportTemplate>(() => {
    const saved = localPersistence.load();
    return hydrate(
      saved?.version === sampleTemplate.version ? saved : sampleTemplate,
    );
  });
  const latestTemplate = useRef(template);
  const [pageId, setPageId] = useState(() => template.pages[0].id);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<PreviewMode>("design");
  const [zoom, setZoom] = useState(0.72);
  const [leftTab, setLeftTab] = useState<LeftTab>("elements");
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [past, setPast] = useState<EditorHistorySnapshot[]>([]);
  const [future, setFuture] = useState<EditorHistorySnapshot[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [toast, setToast] = useState("");
  const [croppingId, setCroppingId] = useState<string>();
  const [replacingImageId, setReplacingImageId] = useState<string>();
  const [tableEditingId, setTableEditingId] = useState<string>();
  const [tableSelection, setTableSelection] = useState<TableSelection>();
  const [draggedPageId, setDraggedPageId] = useState<string>();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [reportData, setReportData] = useState(() => sampleData);
  const [normalizedReport, setNormalizedReport] =
    useState<IndustrialMarketReport>(() => q2SampleReport);
  const [reportInstance, setReportInstance] = useState<ReportInstance>();
  const latestReportInstance = useRef<ReportInstance | undefined>(undefined);
  const [reportSaveStatus, setReportSaveStatus] =
    useState<ReportSaveStatus>("clean");
  const reportSaveStatusRef = useRef<ReportSaveStatus>("clean");
  const [reportSaveError, setReportSaveError] = useState<string>();
  const [reportLastSavedAt, setReportLastSavedAt] = useState<string>();
  const [documentMode, setDocumentMode] =
    useState<EditorDocumentMode>("master-template");
  const [templateLibrary, setTemplateLibrary] = useState<
    TemplateVersionSummary[]
  >([]);
  const [activeTemplateRecord, setActiveTemplateRecord] =
    useState<StoredTemplateVersion>();
  const [publishedTemplate, setPublishedTemplate] =
    useState<StoredTemplateVersion>();
  const [librarySaveState, setLibrarySaveState] = useState<
    "loading" | "saved" | "local" | "error" | "conflict"
  >("loading");
  const [librarySaveError, setLibrarySaveError] = useState<string>();
  const [renamingVersionKey, setRenamingVersionKey] = useState<string>();
  const [fontDiagnostics, setFontDiagnostics] = useState<
    ManagedFontFaceDiagnostic[]
  >([]);
  const [reconciliationPath, setReconciliationPath] = useState<string>();
  const [versionMenuKey, setVersionMenuKey] = useState<string>();
  const [draftToDelete, setDraftToDelete] = useState<TemplateVersionSummary>();
  const [deletingDraft, setDeletingDraft] = useState(false);
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgress>();
  const [preflightIssues, setPreflightIssues] = useState<
    ExportPreflightIssue[]
  >([]);
  const [pendingPdfExport, setPendingPdfExport] = useState<{
    template: ReportTemplate;
    warningCount: number;
    /** Presentation data built from the exact snapshot preflight checked. */
    data: unknown;
  }>();
  /** Narrative overflow writes in flight, keyed by market, to avoid repeats. */
  const narrativeOverflowSync = useRef(new Map<string, boolean>());
  const interactionStart = useRef<EditorHistorySnapshot | undefined>(undefined);
  const clipboard = useRef<ReportElement[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const pageListRef = useRef<HTMLDivElement>(null);
  const managedServerAssets = useRef<Asset[]>([]);
  const initialLoadStarted = useRef(false);
  const reportSaveTimer = useRef<number | undefined>(undefined);
  const reportSaveInFlight = useRef(false);
  const reportChangeSequence = useRef(0);
  const reportRetryCount = useRef(0);
  const runReportSaveRef = useRef<() => void>(() => undefined);
  const transientScope = `${documentMode}:${reportInstance?.id ?? `${template.id}@${template.version}`}:${pageId}`;
  const previousTransientScope = useRef(transientScope);

  useEffect(() => {
    if (previousTransientScope.current === transientScope) return;
    previousTransientScope.current = transientScope;
    setCroppingId(undefined);
    setReplacingImageId(undefined);
    setTableEditingId(undefined);
    setTableSelection(undefined);
    setDraggedPageId(undefined);
    setContextMenu(undefined);
    setGuides([]);
    interactionStart.current = undefined;
  }, [transientScope]);

  const setReportSaveState = useCallback(
    (status: ReportSaveStatus, error?: string) => {
      reportSaveStatusRef.current = status;
      setReportSaveStatus(status);
      setReportSaveError(error);
    },
    [],
  );

  const scheduleReportSave = useCallback((delayMs = 650) => {
    if (reportSaveTimer.current !== undefined)
      window.clearTimeout(reportSaveTimer.current);
    reportSaveTimer.current = window.setTimeout(
      () => runReportSaveRef.current(),
      delayMs,
    );
  }, []);

  const stageReportDocument = useCallback(
    (nextTemplate: ReportTemplate, manualOverrides?: ManualOverride[]) => {
      const current = latestReportInstance.current;
      if (!current) return;
      const next: ReportInstance = {
        ...current,
        pages: clone(nextTemplate.pages),
        manualOverrides: clone(manualOverrides ?? current.manualOverrides),
      };
      latestReportInstance.current = next;
      setReportInstance(next);
      reportChangeSequence.current += 1;
      reportRetryCount.current = 0;
      reportRecovery.save({
        reportId: next.id,
        baseRevision: next.revision,
        pages: next.pages,
        manualOverrides: next.manualOverrides,
        savedAt: new Date().toISOString(),
      });
      setReportSaveState("dirty");
      scheduleReportSave();
    },
    [scheduleReportSave, setReportSaveState],
  );

  runReportSaveRef.current = () => {
    if (reportSaveInFlight.current) {
      scheduleReportSave(250);
      return;
    }
    const snapshot = latestReportInstance.current;
    if (!snapshot || reportSaveStatusRef.current === "conflict") return;
    const sequence = reportChangeSequence.current;
    reportSaveInFlight.current = true;
    setReportSaveState("saving");
    void reportInstanceStore
      .saveDocument(snapshot.id, {
        baseRevision: snapshot.revision,
        pages: snapshot.pages,
        manualOverrides: snapshot.manualOverrides,
      })
      .then((saved) => {
        const current = latestReportInstance.current;
        if (!current || current.id !== saved.id) return;
        if (reportChangeSequence.current === sequence) {
          latestReportInstance.current = saved;
          setReportInstance(saved);
          reportRecovery.clear(saved.id);
          reportRetryCount.current = 0;
          setReportLastSavedAt(new Date().toISOString());
          setReportSaveState("saved");
          return;
        }
        const merged = {
          ...saved,
          pages: current.pages,
          manualOverrides: current.manualOverrides,
        };
        latestReportInstance.current = merged;
        setReportInstance(merged);
        reportRecovery.save({
          reportId: merged.id,
          baseRevision: merged.revision,
          pages: merged.pages,
          manualOverrides: merged.manualOverrides,
          savedAt: new Date().toISOString(),
        });
        setReportSaveState("dirty");
      })
      .catch((error: unknown) => {
        const current = latestReportInstance.current;
        if (!current || current.id !== snapshot.id) return;
        if (error instanceof ReportSaveConflictError) {
          reportRecovery.save({
            reportId: current.id,
            baseRevision: current.revision,
            pages: current.pages,
            manualOverrides: current.manualOverrides,
            savedAt: new Date().toISOString(),
          });
          setReportSaveState(
            "conflict",
            `Server revision ${error.currentRevision} replaced local base ${error.baseRevision}. Local edits are preserved for recovery.`,
          );
          return;
        }
        reportRetryCount.current += 1;
        setReportSaveState(
          "error",
          error instanceof Error ? error.message : "Report autosave failed.",
        );
        if (reportRetryCount.current <= 2) scheduleReportSave(2_000);
      })
      .finally(() => {
        reportSaveInFlight.current = false;
        if (
          reportChangeSequence.current !== sequence &&
          reportSaveStatusRef.current === "dirty"
        )
          scheduleReportSave(250);
      });
  };

  const page =
    template.pages.find((item) => item.id === pageId) ?? template.pages[0];
  const selectedElements = page.elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const selected = selectedElements[0];
  const documentMutable = canMutateDocument({
    mode: documentMode,
    templateStatus: activeTemplateRecord?.status,
    reportStatus: reportInstance?.status,
  });
  const unionAvailability = useMemo(
    () => evaluateShapeUnion(selectedElements),
    [selectedElements],
  );
  const reconciliationRecord = normalizedReport.provenance.find(
    (record) => record.fieldPath === reconciliationPath,
  );
  const settings = { ...defaultSettings, ...template.settings };
  const validations = useMemo(() => {
    const readinessAdvisories =
      reportInstance?.readiness.issues.map((issue) => ({
        level: "warning" as const,
        category: "data" as const,
        message: issue.message,
        path: issue.path,
      })) ?? [];
    const pageAdvisories = template.pages.flatMap((reportPage) =>
      validatePage(reportPage, reportData).map((issue) => ({
        ...asExportAdvisory(issue),
        pageId: reportPage.id,
      })),
    );
    const assessment = assessExportQa(preflightIssues, [
      ...readinessAdvisories,
      ...pageAdvisories,
    ]);
    return [...assessment.blockers, ...assessment.warnings];
  }, [reportData, preflightIssues, reportInstance, template.pages]);

  useEffect(() => {
    if (leftTab !== "pages") return;
    pageListRef.current
      ?.querySelector<HTMLElement>("button.active")
      ?.scrollIntoView({ block: "nearest" });
  }, [leftTab, pageId]);

  const mutate = useCallback(
    (
      updater: (current: ReportTemplate) => ReportTemplate,
      record = true,
      overrideUpdater?: (current: ManualOverride[]) => ManualOverride[],
    ) => {
      if (!documentMutable) {
        if (record) {
          setToast(
            "Published templates are read-only. Create a draft version to edit.",
          );
          window.setTimeout(() => setToast(""), 1800);
        }
        return;
      }
      const current = latestTemplate.current;
      const currentOverrides =
        latestReportInstance.current?.manualOverrides ?? [];
      if (record) {
        setPast((items) => [
          ...items.slice(-49),
          captureEditorHistory(current, currentOverrides),
        ]);
        setFuture([]);
        setLibrarySaveState("local");
        setTemplateDirty(true);
      }
      const next = updater(current);
      latestTemplate.current = next;
      setTemplate(next);
      if (documentMode === "report-instance" && latestReportInstance.current)
        stageReportDocument(
          next,
          overrideUpdater
            ? overrideUpdater(currentOverrides)
            : currentOverrides,
        );
    },
    [documentMode, documentMutable, stageReportDocument],
  );
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };
  const refreshTemplateLibrary = useCallback(async () => {
    const templates = await templateStore.list();
    setTemplateLibrary(templates);
    const published = await templateStore.getPublished(sampleTemplate.id);
    setPublishedTemplate(published);
    return templates;
  }, []);
  const openTemplateRecord = useCallback(
    (record: StoredTemplateVersion) => {
      const browserAssets = (record.template.assets ?? []).filter(
        (asset) => asset.storage !== "backend",
      );
      const assets = [...browserAssets, ...managedServerAssets.current];
      let next = hydrate(
        normalizeReportTemplateFonts({ ...record.template, assets }, assets),
      );
      setLibrarySaveError(undefined);
      const recovery = templateRecovery.load(record.id, record.version);
      if (recovery) {
        if (recovery.baseRevision === record.revision) {
          // Nobody else has changed this draft since the rejected save —
          // safe to restore the local edit rather than lose it.
          next = hydrate(
            normalizeReportTemplateFonts(
              { ...recovery.template, assets },
              assets,
            ),
          );
          templateRecovery.clear(record.id, record.version);
          notify(`Recovered unsaved edits to v${record.version}`);
        } else {
          setLibrarySaveError(
            `Recovery is based on revision ${recovery.baseRevision}, but this draft is at revision ${record.revision}. Recovery was retained without overwriting the server.`,
          );
        }
      }
      setTemplateDirty(Boolean(recovery && recovery.baseRevision === record.revision));
      setTemplateRecovered(Boolean(recovery));
      setActiveTemplateRecord(record);
      setTemplate(next);
      latestTemplate.current = next;
      setDocumentMode("master-template");
      latestReportInstance.current = undefined;
      setReportInstance(undefined);
      setReportSaveState("clean");
      setReportData(sampleData);
      setNormalizedReport(q2SampleReport);
      const editorState = openedTemplateEditorState(next);
      setPageId(editorState.pageId);
      setSelectedIds(editorState.selectedIds);
      setPast([]);
      setFuture([]);
      setLibrarySaveState("saved");
    },
    [setReportSaveState],
  );
  const applySavedTemplateRecord = (record: StoredTemplateVersion) => {
    const browserAssets = (record.template.assets ?? []).filter(
      (asset) => asset.storage !== "backend",
    );
    const next = hydrate(
      normalizeReportTemplateFonts(
        {
          ...record.template,
          assets: [...browserAssets, ...managedServerAssets.current],
        },
        [...browserAssets, ...managedServerAssets.current],
      ),
    );
    const editorState = savedTemplateEditorState(next, pageId, selectedIds);
    setTemplateDirty(false);
    setTemplateRecovered(false);
    setActiveTemplateRecord(record);
    setTemplate(next);
    latestTemplate.current = next;
    setDocumentMode("master-template");
    latestReportInstance.current = undefined;
    setReportInstance(undefined);
    setReportSaveState("clean");
    setPageId(editorState.pageId);
    setSelectedIds(editorState.selectedIds);
    setPast([]);
    setFuture([]);
    setLibrarySaveState("saved");
  };
  useEffect(() => {
    latestTemplate.current = template;
    const timer = window.setTimeout(() => localPersistence.save(template), 250);
    return () => window.clearTimeout(timer);
  }, [template]);
  useEffect(
    () => () => {
      if (reportSaveTimer.current !== undefined)
        window.clearTimeout(reportSaveTimer.current);
    },
    [],
  );
  useEffect(() => {
    const shouldWarn = ["dirty", "saving", "error", "conflict"].includes(
      reportSaveStatus,
    );
    if (!shouldWarn && !templateDirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [reportSaveStatus, templateDirty]);
  useEffect(() => {
    installManagedFonts(template.assets ?? [])
      .then(setFontDiagnostics)
      .catch((error) => {
        setFontDiagnostics([]);
        console.warn("Saved managed fonts could not be restored.", error);
      });
  }, [template.assets]);
  useEffect(() => {
    // Guards against StrictMode's intentional double-invocation of mount
    // effects in development: without it, two concurrent openTemplateRecord
    // calls race, and the second (which finds no recovery, since the first
    // already consumed and cleared it) silently overwrites the first's
    // just-recovered edit with the plain server copy.
    if (initialLoadStarted.current) return;
    initialLoadStarted.current = true;
    Promise.all([
      refreshTemplateLibrary(),
      assetStorage.list().catch(() => [] as Asset[]),
    ])
      .then(async ([records, serverAssets]) => {
        await reportInstanceStore.discardDeletedRecovery();
        managedServerAssets.current = serverAssets;
        const preferred =
          records.find((record) => record.status === "draft") ?? records[0];
        if (preferred)
          openTemplateRecord(
            await templateStore.get(preferred.id, preferred.version),
          );
        const reportId = new URLSearchParams(window.location.search).get("report") ?? (new URLSearchParams(window.location.search).get("workspace") === "templates" ? undefined : reportInstanceStore.lastId());
        if (reportId) {
          try {
            const restored = await reportInstanceStore.get(reportId);
            let legacySource: StoredTemplateVersion | undefined;
            if (!restored.sourceTemplateSnapshot) {
              try {
                legacySource = await templateStore.get(
                  restored.templateId,
                  restored.templateVersion,
                );
              } catch (error) {
                console.warn(
                  JSON.stringify({
                    event: "source_template_missing_during_report_restore",
                    operation: "report_restore",
                    reportId: restored.id,
                    templateId: restored.templateId,
                    templateVersion: restored.templateVersion,
                    errorName:
                      error instanceof Error ? error.name : "UnknownError",
                  }),
                );
              }
            }
            const browserAssets = (legacySource?.template.assets ?? []).filter(
              (asset) => asset.storage !== "backend",
            );
            const recovery = reportRecovery.load(restored.id);
            const recoveryMatches =
              recovery?.baseRevision === restored.revision;
            const recoveryDiffers =
              recoveryMatches &&
              (JSON.stringify(recovery.pages) !==
                JSON.stringify(restored.pages) ||
                JSON.stringify(recovery.manualOverrides) !==
                  JSON.stringify(restored.manualOverrides));
            const effective = recoveryDiffers
              ? {
                  ...restored,
                  pages: recovery.pages,
                  manualOverrides: recovery.manualOverrides,
                }
              : restored;
            const reportTemplate = hydrate({
              ...(legacySource?.template ?? {
                id: restored.templateId,
                version: restored.templateVersion,
                name:
                  restored.sourceTemplateSnapshot?.name ??
                  `${restored.generationRequest.period} ${restored.generationRequest.market} Industrial Market Report`,
                pages: effective.pages,
                settings: restored.sourceTemplateSnapshot?.settings,
              }),
              name: `${restored.generationRequest.period} ${restored.generationRequest.market} Industrial Market Report`,
              assets: [...browserAssets, ...managedServerAssets.current],
              pages: effective.pages,
            });
            setTemplate(reportTemplate);
            latestTemplate.current = reportTemplate;
            setReportData(buildPresentationModel(effective.dataSnapshot));
            setNormalizedReport(effective.dataSnapshot);
            latestReportInstance.current = effective;
            setReportInstance(effective);
            setDocumentMode("report-instance");
            setPageId(reportTemplate.pages[0].id);
            setMode("data");
            if (recoveryDiffers) {
              stageReportDocument(reportTemplate, effective.manualOverrides);
            } else if (recovery && !recoveryMatches) {
              setReportSaveState(
                "conflict",
                `Recovery is based on revision ${recovery.baseRevision}, but the server is at revision ${restored.revision}. Recovery was retained without overwriting the server.`,
              );
            } else {
              if (recovery) reportRecovery.clear(restored.id);
              setReportSaveState("saved");
              setReportLastSavedAt(restored.publishedAt);
            }
          } catch (error) {
            reportInstanceStore.forget();
            console.warn("Saved report instance could not be restored.", error);
          }
        }
      })
      .catch((error) => {
        setLibrarySaveState("local");
        console.warn(
          "Template library unavailable; local recovery remains active.",
          error,
        );
      }).finally(() => setDocumentLoading(false));
  }, [
    openTemplateRecord,
    refreshTemplateLibrary,
    setReportSaveState,
    stageReportDocument,
  ]);

  const updatePage = useCallback(
    (
      updater: (current: ReportPage) => ReportPage,
      record = true,
      overrideUpdater?: (current: ManualOverride[]) => ManualOverride[],
    ) =>
      mutate(
        (current) => ({
          ...current,
          pages: current.pages.map((item) =>
            item.id === page.id ? updater(item) : item,
          ),
        }),
        record,
        overrideUpdater,
      ),
    [mutate, page.id],
  );
  const updateElement = useCallback(
    (id: string, patch: Partial<ReportElement>, record = false) =>
      updatePage((current) => {
        const source = current.elements.find((element) => element.id === id),
          dx = source && patch.x != null ? patch.x - source.x : 0,
          dy = source && patch.y != null ? patch.y - source.y : 0;
        const positionOnly = Object.keys(patch).every(
          (key) => key === "x" || key === "y",
        );
        if (
          source &&
          selectedIds.length > 1 &&
          selectedIds.includes(id) &&
          positionOnly &&
          (patch.x != null || patch.y != null)
        ) {
          return {
            ...current,
            elements: translateSelectedElements(
              current.elements,
              selectedIds,
              id,
              patch.x ?? source.x,
              patch.y ?? source.y,
            ),
          };
        }
        if (source?.groupId && (patch.width != null || patch.height != null)) {
          return {
            ...current,
            elements: scaleGroupedElements(current.elements, id, patch),
          };
        }
        if (source?.groupId && patch.rotation != null) {
          return {
            ...current,
            elements: rotateGroupedElements(
              current.elements,
              id,
              patch.rotation,
            ),
          };
        }
        return {
          ...current,
          elements: current.elements.map((element) => {
            if (element.id === id)
              return normalizeElementCorners({
                ...element,
                ...patch,
                style: patch.style
                  ? { ...element.style, ...patch.style }
                  : element.style,
              } as ReportElement);
            if (
              source?.groupId &&
              element.groupId === source.groupId &&
              (dx || dy)
            )
              return { ...element, x: element.x + dx, y: element.y + dy };
            return element;
          }),
        };
      }, record),
    [selectedIds, updatePage],
  );
  const updateSelected = (patch: Partial<ReportElement>) => {
    const recordsManualOverride =
      Object.prototype.hasOwnProperty.call(patch, "text") &&
      selected?.binding &&
      reportInstance;
    let overrideUpdater:
      ((current: ManualOverride[]) => ManualOverride[]) | undefined;
    if (recordsManualOverride && selected?.binding) {
      const generatedValue = getByContextPath(
        reportData,
        selected.binding.path,
        selected.bindingContext,
      );
      const bindingPath = selected.binding.path;
      const overrideValue = (patch as { text?: string }).text;
      overrideUpdater = (current) =>
        upsertManualOverride(current, {
          elementId: selected.id,
          bindingPath,
          generatedValue,
          overrideValue,
        });
    }
    updatePage(
      (current) => ({
        ...current,
        elements: current.elements.map((element) =>
          selectedIds.includes(element.id)
            ? normalizeElementCorners({
                ...element,
                ...patch,
                style: patch.style
                  ? { ...element.style, ...patch.style }
                  : element.style,
              } as ReportElement)
            : element,
        ),
      }),
      true,
      overrideUpdater,
    );
  };
  const setSettings = (patch: Partial<EditorSettings>) =>
    mutate((current) => ({
      ...current,
      settings: { ...defaultSettings, ...current.settings, ...patch },
    }));
  const updateGuide = (id: string, position: number, record = false) =>
    mutate(
      (current) => ({
        ...current,
        settings: {
          ...defaultSettings,
          ...current.settings,
          customGuides: (current.settings?.customGuides ?? []).map((guide) =>
            guide.id === id
              ? { ...guide, position: Math.round(position) }
              : guide,
          ),
        },
      }),
      record,
    );
  const addGuide = (axis: "x" | "y", position: number) => {
    const guide: EditorGuide = {
      id: uid("guide"),
      axis,
      position: Math.max(0, Math.round(position)),
    };
    setSettings({ customGuides: [...(settings.customGuides ?? []), guide] });
    notify("Guide added · double-click to remove");
  };
  const startGuideDrag = (event: React.PointerEvent, guide: EditorGuide) => {
    event.preventDefault();
    event.stopPropagation();
    beginInteraction();
    const canvas = (
      event.currentTarget.closest(".page-canvas") as HTMLElement
    ).getBoundingClientRect();
    const move = (ev: PointerEvent) =>
      updateGuide(
        guide.id,
        guide.axis === "x"
          ? (ev.clientX - canvas.left) / zoom
          : (ev.clientY - canvas.top) / zoom,
      );
    const up = () => {
      endInteraction();
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  const removeGuide = (id: string) =>
    setSettings({
      customGuides: (settings.customGuides ?? []).filter(
        (guide) => guide.id !== id,
      ),
    });

  const beginInteraction = () => {
    if (!interactionStart.current)
      interactionStart.current = captureEditorHistory(
        latestTemplate.current,
        latestReportInstance.current?.manualOverrides ?? [],
      );
  };
  const endInteraction = () => {
    const start = interactionStart.current;
    interactionStart.current = undefined;
    if (
      start &&
      JSON.stringify(start.template) !== JSON.stringify(latestTemplate.current)
    ) {
      setPast((items) => [...items.slice(-49), start]);
      setFuture([]);
    }
  };
  const undo = useCallback(() => {
    if (!documentMutable) return;
    const previous = past.at(-1);
    if (!previous) return;
    setFuture([
      captureEditorHistory(
        latestTemplate.current,
        latestReportInstance.current?.manualOverrides ?? [],
      ),
      ...future.slice(0, 49),
    ]);
    setPast(past.slice(0, -1));
    latestTemplate.current = clone(previous.template);
    setTemplate(clone(previous.template));
    if (documentMode === "report-instance")
      stageReportDocument(previous.template, previous.manualOverrides);
  }, [documentMode, documentMutable, future, past, stageReportDocument]);
  const redo = useCallback(() => {
    if (!documentMutable) return;
    const next = future[0];
    if (!next) return;
    setPast([
      ...past.slice(-49),
      captureEditorHistory(
        latestTemplate.current,
        latestReportInstance.current?.manualOverrides ?? [],
      ),
    ]);
    setFuture(future.slice(1));
    latestTemplate.current = clone(next.template);
    setTemplate(clone(next.template));
    if (documentMode === "report-instance")
      stageReportDocument(next.template, next.manualOverrides);
  }, [documentMode, documentMutable, future, past, stageReportDocument]);

  const select = (id: string, additive: boolean) => {
    if (croppingId && croppingId !== id) setCroppingId(undefined);
    if (tableEditingId && tableEditingId !== id) {
      setTableEditingId(undefined);
      setTableSelection(undefined);
    }
    setSelectedIds((current) => nextSelection(current, id, additive));
  };
  const addText = (variant: "heading" | "subheading" | "body" = "body") => {
    const id = uid("text"),
      sizes = { heading: 32, subheading: 22, body: 14 },
      weight =
        variant === "heading" ? 700 : variant === "subheading" ? 600 : 400,
      managedFace = resolveAvailableManagedFontFace(
        latestTemplate.current.assets ?? [],
        "Nunito Sans",
        weight,
        "normal",
      );
    const element: ReportElement = {
      id,
      type: "text",
      name:
        variant === "heading"
          ? "Heading"
          : variant === "subheading"
            ? "Subheading"
            : "Body Text",
      x: 96,
      y: 96,
      width: 320,
      height: variant === "body" ? 72 : 54,
      text:
        variant === "heading"
          ? "Add a heading"
          : variant === "subheading"
            ? "Add a subheading"
            : "Add body text",
      style: {
        typography: {
          fontFamily: "Nunito Sans",
          fontWeight: managedFace?.fontWeight ?? weight,
          fontStyle: managedFace?.fontStyle ?? "normal",
          fontAssetId: managedFace?.id,
          fontChecksum: managedFace?.checksum,
          fontSize: sizes[variant],
          color: "#172033",
          letterSpacing: 0,
          lineHeight: 1.2,
          textAlign: "left",
          verticalAlign: "top",
          italic: false,
          underline: false,
        },
        opacity: 1,
      },
    };
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    setSelectedIds([id]);
  };
  const addShape = (shape: ShapeKind) => {
    const id = uid("shape"),
      round = shape === "circle" || shape === "ellipse";
    const element: ReportElement = {
      id,
      type: "shape",
      shape,
      name: shape
        .split("-")
        .map((v) => v[0].toUpperCase() + v.slice(1))
        .join(" "),
      x: 110,
      y: 120,
      width: shape === "line" ? 240 : shape === "circle" ? 140 : 200,
      height: shape === "line" ? 2 : shape === "circle" ? 140 : 120,
      style: {
        fill: { type: "solid", color: "#DCE7F4" },
        stroke: {
          enabled: false,
          color: "#173B64",
          width: 1,
          opacity: 1,
          style: "solid",
        },
        borderRadius: round ? 999 : shape === "rounded-rectangle" ? 16 : 0,
        cornerRadii: {
          topLeft: round ? 70 : shape === "rounded-rectangle" ? 16 : 0,
          topRight: round ? 70 : shape === "rounded-rectangle" ? 16 : 0,
          bottomRight: round ? 70 : shape === "rounded-rectangle" ? 16 : 0,
          bottomLeft: round ? 70 : shape === "rounded-rectangle" ? 16 : 0,
          linked: true,
        },
        opacity: 1,
      },
    };
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    setSelectedIds([id]);
  };
  const useImageAsset = (asset: Asset) => {
    if (!documentMutable) {
      notify(
        "Published templates are read-only. Create a draft version to edit.",
      );
      return;
    }
    if (replacingImageId) {
      if (asset.storage !== "backend") {
        notify("Replacement images must be uploaded as managed assets.");
        return;
      }
      updatePage((current) => ({
        ...current,
        elements: current.elements.map((element) =>
          element.id === replacingImageId && element.type === "image"
            ? replaceImageAsset(element, asset)
            : element,
        ),
      }));
      setSelectedIds([replacingImageId]);
      setCroppingId(undefined);
      setReplacingImageId(undefined);
      notify(`${displayAssetName(asset.name)} replaced the selected image`);
      return;
    }
    const id = uid("image"),
      element: ReportElement = {
        id,
        type: "image",
        name: asset.name,
        x: 110,
        y: 120,
        width: 300,
        height: 200,
        src: asset.source,
        assetId: asset.id,
        fit: "cover",
        crop: { x: 50, y: 50, zoom: 1 },
        style: {
          opacity: 1,
          borderRadius: 8,
          cornerRadii: {
            topLeft: 8,
            topRight: 8,
            bottomRight: 8,
            bottomLeft: 8,
            linked: true,
          },
        },
      };
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    setSelectedIds([id]);
  };
  const duplicateSelected = useCallback(() => {
    if (!selectedElements.length) return;
    const copies = selectedElements.map(
      (element) =>
        ({
          ...clone(element),
          id: uid(element.type),
          name: `${element.name} Copy`,
          x: element.x + 16,
          y: element.y + 16,
        }) as ReportElement,
    );
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, ...copies],
    }));
    setSelectedIds(copies.map((item) => item.id));
  }, [selectedElements, updatePage]);
  const deleteSelected = useCallback(() => {
    if (!selectedIds.length) return;
    updatePage((current) => ({
      ...current,
      elements: current.elements.filter(
        (element) => !selectedIds.includes(element.id),
      ),
    }));
    setSelectedIds([]);
  }, [selectedIds, updatePage]);
  const copySelected = useCallback(() => {
    clipboard.current = clone(selectedElements);
    notify(
      `${selectedElements.length} element${selectedElements.length === 1 ? "" : "s"} copied`,
    );
  }, [selectedElements]);
  const paste = useCallback(() => {
    if (!clipboard.current.length) return;
    const copies = clipboard.current.map(
      (element) =>
        ({
          ...clone(element),
          id: uid(element.type),
          x: element.x + 20,
          y: element.y + 20,
        }) as ReportElement,
    );
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, ...copies],
    }));
    setSelectedIds(copies.map((item) => item.id));
  }, [updatePage]);
  const reorderLayer = (action: "front" | "forward" | "backward" | "back") =>
    updatePage((current) => {
      const rest = current.elements.filter(
          (element) => !selectedIds.includes(element.id),
        ),
        chosen = current.elements.filter((element) =>
          selectedIds.includes(element.id),
        );
      if (action === "front")
        return { ...current, elements: [...rest, ...chosen] };
      if (action === "back")
        return { ...current, elements: [...chosen, ...rest] };
      const elements = [...current.elements];
      chosen.forEach((item) => {
        const index = elements.findIndex((e) => e.id === item.id);
        const target =
          action === "forward"
            ? Math.min(elements.length - 1, index + 1)
            : Math.max(0, index - 1);
        elements.splice(index, 1);
        elements.splice(target, 0, item);
      });
      return { ...current, elements };
    });
  const group = () => {
    if (selectedIds.length < 2) return;
    if (!documentMutable) {
      notify(
        "Published templates are read-only. Create a draft version to edit.",
      );
      return;
    }
    const groupId = uid("group");
    updatePage((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) ? { ...element, groupId } : element,
      ),
    }));
    notify("Elements grouped");
  };
  const ungroup = () => {
    if (!documentMutable) {
      notify(
        "Published templates are read-only. Create a draft version to edit.",
      );
      return;
    }
    updatePage((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id)
          ? { ...element, groupId: undefined }
          : element,
      ),
    }));
  };

  const unionSelectedShapes = () => {
    if (!documentMutable) {
      notify(
        "Published templates are read-only. Create a draft version to edit.",
      );
      return;
    }
    if (!unionAvailability.enabled) {
      notify(unionAvailability.reason);
      return;
    }
    const chosen = page.elements.filter(
      (element): element is Extract<ReportElement, { type: "shape" }> =>
        selectedIds.includes(element.id) && element.type === "shape",
    );
    try {
      const unionShape = createUnionShape(chosen, uid("shape-union"));
      updatePage((current) => {
        const chosenIds = new Set(chosen.map((element) => element.id));
        const topIndex = Math.max(
          ...current.elements.map((element, index) =>
            chosenIds.has(element.id) ? index : -1,
          ),
        );
        const elements = current.elements.filter(
          (element) => !chosenIds.has(element.id),
        );
        const insertion = Math.max(0, topIndex - chosen.length + 1);
        elements.splice(insertion, 0, unionShape);
        return { ...current, elements };
      });
      setSelectedIds([unionShape.id]);
      notify("Shapes united");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Shapes could not be united",
      );
    }
  };

  const align = (
    value: "left" | "center" | "right" | "top" | "middle" | "bottom",
  ) =>
    updatePage((current) => {
      const chosen = current.elements.filter((element) =>
        selectedIds.includes(element.id),
      );
      if (!chosen.length) return current;
      const chosenBounds = chosen.map((element) => ({
        element,
        bounds: getRotatedAabb(elementRect(element)),
      }));
      const minX =
          chosen.length === 1
            ? 0
            : Math.min(...chosenBounds.map(({ bounds }) => bounds.x)),
        maxX =
          chosen.length === 1
            ? page.width
            : Math.max(
                ...chosenBounds.map(({ bounds }) => bounds.x + bounds.width),
              );
      const minY =
          chosen.length === 1
            ? 0
            : Math.min(...chosenBounds.map(({ bounds }) => bounds.y)),
        maxY =
          chosen.length === 1
            ? page.height
            : Math.max(
                ...chosenBounds.map(({ bounds }) => bounds.y + bounds.height),
              );
      return {
        ...current,
        elements: current.elements.map((element) => {
          if (!selectedIds.includes(element.id)) return element;
          const bounds = getRotatedAabb(elementRect(element));
          if (value === "left")
            return { ...element, x: element.x + minX - bounds.x };
          if (value === "right")
            return {
              ...element,
              x: element.x + maxX - (bounds.x + bounds.width),
            };
          if (value === "center")
            return {
              ...element,
              x: element.x + (minX + maxX) / 2 - (bounds.x + bounds.width / 2),
            };
          if (value === "top")
            return { ...element, y: element.y + minY - bounds.y };
          if (value === "bottom")
            return {
              ...element,
              y: element.y + maxY - (bounds.y + bounds.height),
            };
          return {
            ...element,
            y: element.y + (minY + maxY) / 2 - (bounds.y + bounds.height / 2),
          };
        }),
      };
    });
  const distributeSelection = (axis: "x" | "y") =>
    updatePage((current) => {
      const positions = distribute(
        current.elements.filter((e) => selectedIds.includes(e.id)),
        axis,
      );
      return {
        ...current,
        elements: current.elements.map((element) =>
          positions.has(element.id)
            ? { ...element, [axis]: positions.get(element.id)! }
            : element,
        ),
      };
    });

  const addPage = () => {
    const id = uid("page"),
      next: ReportPage = {
        id,
        name: `Page ${template.pages.length + 1}`,
        width: 816,
        height: 1056,
        background: "#fff",
        elements: [],
      };
    mutate((current) => ({ ...current, pages: [...current.pages, next] }));
    setPageId(id);
    setSelectedIds([]);
  };
  const duplicatePage = () => {
    const next = clone(page);
    next.id = uid("page");
    next.name = `${next.name} Copy`;
    next.elements = next.elements.map(
      (element) => ({ ...element, id: uid(element.type) }) as ReportElement,
    );
    mutate((current) => ({ ...current, pages: [...current.pages, next] }));
    setPageId(next.id);
    setSelectedIds([]);
  };
  const deletePage = () => {
    if (template.pages.length === 1) return;
    const remaining = template.pages.filter((item) => item.id !== page.id);
    mutate((current) => ({ ...current, pages: remaining }));
    setPageId(remaining[0].id);
    setSelectedIds([]);
  };
  const movePage = (direction: -1 | 1) =>
    mutate((current) => {
      const pages = [...current.pages],
        index = pages.findIndex((item) => item.id === page.id),
        target = Math.max(0, Math.min(pages.length - 1, index + direction));
      const [item] = pages.splice(index, 1);
      pages.splice(target, 0, item);
      return { ...current, pages };
    });
  const dropPage = (targetId: string) => {
    if (!draggedPageId || draggedPageId === targetId) return;
    mutate((current) => {
      const pages = [...current.pages],
        from = pages.findIndex((item) => item.id === draggedPageId),
        to = pages.findIndex((item) => item.id === targetId),
        [item] = pages.splice(from, 1);
      pages.splice(to, 0, item);
      return { ...current, pages };
    });
    setDraggedPageId(undefined);
  };

  const bind = (path: string, format?: string) =>
    selected &&
    updateSelected({
      binding: {
        ...(selected.binding ?? {}),
        path,
        label: path,
        format: (format ?? "text") as Binding["format"],
      },
    });
  const downloadTemplate = () => {
    const blob = new Blob([JSON.stringify(template, null, 2)], {
        type: "application/json",
      }),
      url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "lee-report-template.json";
    anchor.click();
    URL.revokeObjectURL(url);
    notify("Template exported");
  };
  const saveMasterTemplate = async () => {
    if (documentMode !== "master-template" || !activeTemplateRecord) return;
    if (activeTemplateRecord.status !== "draft") {
      notify("Published templates require Save As New Version.");
      return;
    }
    setTemplateSaving(true);
    const base = activeTemplateRecord;
    const normalized = normalizeReportTemplateFonts(
      latestTemplate.current,
      latestTemplate.current.assets ?? [],
    );
    try {
      const saved = await templateStore.saveDraft(base, normalized);
      applySavedTemplateRecord(saved);
      templateRecovery.clear(base.id, base.version);
      await refreshTemplateLibrary();
      setLibrarySaveState("saved");
      setLibrarySaveError(undefined);
      notify(`Template v${saved.version} saved to library`);
    } catch (error) {
      if (error instanceof TemplateSaveConflictError) {
        // Never silently overwrite, and never silently discard: the base
        // this edit started from is stale, so the edit is preserved for
        // recovery instead of being sent over the newer server content.
        // baseRevision is the revision the *conflict* reported as current,
        // not the stale one this edit started from — reopening later can
        // then tell whether the draft is still exactly there (safe to
        // silently restore this edit) or has moved again since (must not
        // silently restore over content the user hasn't seen).
        templateRecovery.save({
          id: base.id,
          version: base.version,
          baseRevision: error.currentRevision,
          template: normalized,
          savedAt: new Date().toISOString(),
        });
        setLibrarySaveState("conflict");
        setLibrarySaveError(
          `v${base.version} changed elsewhere (revision ${error.currentRevision}) since you opened it. Your edits were not saved — they're preserved locally. Use "Save as version" to keep them as a new draft, or reopen v${base.version} to see the latest.`,
        );
        notify(
          `v${base.version} was changed elsewhere — your edit was not saved, but is preserved`,
        );
        return;
      }
      setLibrarySaveState("error");
      setLibrarySaveError(undefined);
      setLibrarySaveError(error instanceof Error ? error.message : "Template save failed");
      notify(error instanceof Error ? error.message : "Template save failed");
    } finally { setTemplateSaving(false); }
  };
  const renameTemplateVersion = async (
    record: StoredTemplateVersion | TemplateVersionSummary,
    label: string,
  ) => {
    try {
      const renamed = await templateStore.rename(record, label);
      await refreshTemplateLibrary();
      if (
        activeTemplateRecord?.id === renamed.id &&
        activeTemplateRecord.version === renamed.version
      )
        setActiveTemplateRecord((current) =>
          current ? { ...current, label: renamed.label } : current,
        );
      notify(`v${renamed.version} renamed`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Rename failed");
    } finally {
      setRenamingVersionKey(undefined);
    }
  };
  const saveAsNewTemplateVersion = async (
    source = activeTemplateRecord,
    sourceTemplate = latestTemplate.current,
  ) => {
    if (!source) return;
    try {
      const created = await templateStore.createVersion(
        source,
        normalizeReportTemplateFonts(
          sourceTemplate,
          sourceTemplate.assets ?? [],
        ),
      );
      applySavedTemplateRecord(created);
      await refreshTemplateLibrary();
      notify(`Draft v${created.version} created`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "New version failed");
    }
  };
  const publishMasterTemplate = async () => {
    if (!activeTemplateRecord || activeTemplateRecord.status !== "draft") {
      notify("Only a saved draft can be published.");
      return;
    }
    try {
      const saved = await templateStore.saveDraft(
        activeTemplateRecord,
        normalizeReportTemplateFonts(
          latestTemplate.current,
          latestTemplate.current.assets ?? [],
        ),
      );
      const published = await templateStore.publish(saved);
      applySavedTemplateRecord(published);
      await refreshTemplateLibrary();
      notify(`Template v${published.version} published`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Publish failed");
    }
  };
  const openTemplateVersion = async (summary: TemplateVersionSummary) => {
    try {
      openTemplateRecord(await templateStore.get(summary.id, summary.version));
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Template could not be opened",
      );
    }
  };
  const createDraftFromVersion = async (summary: TemplateVersionSummary) => {
    try {
      const source = await templateStore.get(summary.id, summary.version);
      await saveAsNewTemplateVersion(source, source.template);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Draft could not be created",
      );
    }
  };
  const confirmDeleteDraft = async () => {
    if (!draftToDelete || deletingDraft) return;
    setDeletingDraft(true);
    try {
      await templateStore.deleteDraft(draftToDelete);
      const records = await refreshTemplateLibrary();
      if (
        documentMode === "master-template" &&
        activeTemplateRecord?.id === draftToDelete.id &&
        activeTemplateRecord.version === draftToDelete.version
      ) {
        const family = records.filter(
          (record) => record.id === draftToDelete.id,
        );
        const fallback =
          family.find((record) => record.status === "published") ??
          family.find((record) => record.status === "draft") ??
          family[0];
        if (fallback)
          openTemplateRecord(
            await templateStore.get(fallback.id, fallback.version),
          );
      }
      notify(`Draft v${draftToDelete.version} deleted`);
      setDraftToDelete(undefined);
      setVersionMenuKey(undefined);
    } catch (error) {
      notify(error instanceof Error ? error.message : "Draft deletion failed");
    } finally {
      setDeletingDraft(false);
    }
  };
  const startCreateReport = () => {
    if (!activeTemplateRecord && !publishedTemplate) {
      setLeftTab("templates");
      notify("Open a master template before generating a report.");
      return;
    }
    setShowWizard(true);
  };
  const performPdfExport = async (
    publicationTemplate: ReportTemplate,
    warningCount: number,
    exportData: unknown = reportData,
  ) => {
    setExportingPdf(true);
    try {
      const fileName = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      let chromiumFailure: ReturnType<typeof classifyExportError> | undefined;
      try {
        await exportChromiumPdf(publicationTemplate, exportData, fileName);
      } catch (chromiumError) {
        chromiumFailure = classifyExportError("chromium", chromiumError);
        console.warn(
          "Chromium renderer unavailable; using deterministic fallback.",
          chromiumFailure,
        );
        try {
          await exportReportPdf(publicationTemplate, exportData, fileName);
        } catch (fallbackError) {
          const fallbackFailure = classifyExportError(
            "fallback",
            fallbackError,
          );
          console.error(
            "PDF export failed on both the Chromium and fallback renderers.",
            { chromiumFailure, fallbackFailure },
          );
          notify(describeExportFailure(chromiumFailure, fallbackFailure));
          return;
        }
      }
      notify(
        `${template.pages.filter((item) => !item.hidden).length}-page PDF exported${warningCount ? ` · ${warningCount} QA warning${warningCount === 1 ? "" : "s"} acknowledged` : ""}`,
      );
    } catch (error) {
      console.error("PDF export failed unexpectedly.", error);
      notify("The PDF could not be generated.");
    } finally {
      setExportingPdf(false);
    }
  };
  const downloadPdf = async () => {
    setExportingPdf(true);
    try {
      // Snapshot integrity: never combine narratives reviewed against one
      // data snapshot with report data from another. Pending edits must reach
      // the server first, then staleness is re-evaluated there and the PDF
      // is built from that exact refreshed instance.
      let exportInstance = latestReportInstance.current ?? reportInstance;
      let exportData: unknown = reportData;
      if (documentMode === "report-instance" && exportInstance) {
        if (
          ["dirty", "saving", "error", "conflict"].includes(
            reportSaveStatusRef.current,
          )
        ) {
          notify(
            "Report changes have not finished saving. Export again once the report is saved.",
          );
          return;
        }
        if (exportInstance.status !== "published") exportInstance = await reportInstanceStore.refresh(exportInstance.id);
        handleReportInstanceChange(exportInstance);
        exportData = withTableDisplayOverrides(buildPresentationModel(exportInstance.dataSnapshot), exportInstance.manualOverrides);
      }
      const publicationTemplate = prepareTemplateForPublication(template);
      const issues = await runExportPreflight(publicationTemplate);
      setPreflightIssues(issues);
      const readinessAdvisories =
        exportInstance?.readiness.issues.map((issue) => ({
          level: issue.level,
          category: "data" as const,
          message: issue.message,
          path: issue.path,
        })) ?? [];
      const pageAdvisories = template.pages.flatMap((reportPage) =>
        validatePage(reportPage, exportData).map((issue) => ({
          ...issue,
          pageId: reportPage.id,
        })),
      );
      const assessment = assessExportQa(issues, [
        ...readinessAdvisories,
        ...pageAdvisories,
      ]);
      if (assessment.blockers.length) {
        setLeftTab("validate");
        const failure = classifyExportError(
          "preflight",
          new Error(
            assessment.blockers.map((issue) => issue.message).join(" "),
          ),
        );
        console.error(
          "PDF export blocked by technical preflight errors.",
          failure,
        );
        notify(
          `${assessment.blockers.length} blocking QA issue${assessment.blockers.length === 1 ? "" : "s"} must be fixed before export. ${describeExportFailure(failure)}`,
        );
        return;
      }
      if (assessment.warnings.length) {
        setPendingPdfExport({
          template: publicationTemplate,
          warningCount: assessment.warnings.length,
          data: exportData,
        });
        return;
      }
      await performPdfExport(publicationTemplate, 0, exportData);
    } catch (error) {
      console.error("PDF preflight failed unexpectedly.", error);
      notify("The PDF preflight could not be completed.");
    } finally {
      setExportingPdf(false);
    }
  };
  const handleReportInstanceChange = (instance: ReportInstance) => {
    reportInstanceStore.remember(instance.id);
    setReportData(buildPresentationModel(instance.dataSnapshot));
    setNormalizedReport(instance.dataSnapshot);
    const local = latestReportInstance.current;
    if (
      local?.id === instance.id &&
      ["dirty", "saving", "error"].includes(reportSaveStatusRef.current)
    ) {
      const merged = {
        ...instance,
        pages: local.pages,
        manualOverrides: local.manualOverrides,
      };
      latestReportInstance.current = merged;
      setReportInstance(merged);
      stageReportDocument(latestTemplate.current, merged.manualOverrides);
      return;
    }
    if (local?.id === instance.id && reportSaveStatusRef.current === "conflict")
      return;
    latestReportInstance.current = instance;
    setReportInstance(instance);
    reportRecovery.clear(instance.id);
    setReportSaveState("saved");
    setReportLastSavedAt(new Date().toISOString());
  };
  /**
   * Dynamic narrative sizing reports whether a narrative still overflows its
   * text box at the authored minimum size. That measured state is persisted
   * on the narrative record, where the existing rules already block approval
   * and publication of overflowing narratives.
   */
  const handleNarrativeFit: NarrativeFitListener = (marketId, result) => {
    const instance = latestReportInstance.current;
    if (documentMode !== "report-instance" || mode !== "data" || !instance || instance.status === "published")
      return;
    const record = instance.narratives.find(
      (item) => item.marketId === marketId,
    );
    if (!record || !record.text.trim() || record.overflow === result.overflow)
      return;
    if (narrativeOverflowSync.current.get(marketId) === result.overflow) return;
    narrativeOverflowSync.current.set(marketId, result.overflow);
    void reportInstanceStore
      .overflow(instance.id, marketId, result.overflow)
      .then(handleReportInstanceChange)
      .catch((error) =>
        console.warn("Narrative overflow state could not be saved.", error),
      )
      .finally(() => narrativeOverflowSync.current.delete(marketId));
  };
  const handleGenerate = async (
    request: ReportGenerationRequest,
  ): Promise<ReportInstance> => {
    const sourceTemplate = await templateStore.get(
      request.templateId,
      request.templateVersion,
    );
    const instance = await generateReportInstance(
      sourceTemplate.template,
      request,
      setGenerationProgress,
    );
    const persisted = await reportInstanceStore.create(instance);
    const next = hydrate({
      ...sourceTemplate.template,
      name: `${request.period} ${request.market} Industrial Market Report`,
      pages: persisted.pages,
    });
    setTemplate(next);
    latestTemplate.current = next;
    latestReportInstance.current = persisted;
    handleReportInstanceChange(persisted);
    setDocumentMode("report-instance");
    setPageId(next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    setMode("data");
    notify("Data validated · narratives ready for review");
    return persisted;
  };
  const reset = () => {
    const source = activeTemplateRecord?.template ?? sampleTemplate;
    const browserAssets = (source.assets ?? []).filter(
      (asset) => asset.storage !== "backend",
    );
    const assets = [...browserAssets, ...managedServerAssets.current];
    const next = hydrate(
      normalizeReportTemplateFonts({ ...source, assets }, assets),
    );
    localPersistence.clear();
    if (latestReportInstance.current)
      reportRecovery.clear(latestReportInstance.current.id);
    reportInstanceStore.forget();
    if (reportSaveTimer.current !== undefined)
      window.clearTimeout(reportSaveTimer.current);
    setTemplate(next);
    latestTemplate.current = next;
    setReportData(sampleData);
    setNormalizedReport(q2SampleReport);
    setReportInstance(undefined);
    latestReportInstance.current = undefined;
    setReportSaveState("clean");
    setDocumentMode("master-template");
    setPageId(next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    notify(activeTemplateRecord ? "Saved master restored" : "Demo restored");
  };
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    if (!documentMutable) {
      notify("Create a draft version before changing managed assets.");
      return;
    }
    try {
      notify("Uploading assets…");
      const { assets, summary } = await assetStorage.upload(Array.from(files));
      if (
        replacingImageId &&
        assets.some(
          (asset) => asset.type !== "font" && asset.storage !== "backend",
        )
      ) {
        notify("Replacement images must be uploaded as managed assets.");
        return;
      }
      const allAssets = [...(latestTemplate.current.assets ?? []), ...assets];
      managedServerAssets.current = allAssets.filter(
        (asset) => asset.storage === "backend",
      );
      setFontDiagnostics(await installManagedFonts(allAssets));
      const replacement = replacingImageId
        ? assets.find(
            (asset) => asset.type !== "font" && asset.storage === "backend",
          )
        : undefined;
      mutate((current) => {
        const normalized = normalizeReportTemplateFonts(
          { ...current, assets: allAssets },
          allAssets,
        );
        return replacement && replacingImageId
          ? replaceTemplateImageAsset(normalized, replacingImageId, replacement)
          : normalized;
      });
      if (replacement && replacingImageId) {
        setSelectedIds([replacingImageId]);
        setCroppingId(undefined);
        setReplacingImageId(undefined);
      }
      const details = [
        summary.duplicates
          ? `${summary.duplicates} duplicate${summary.duplicates === 1 ? "" : "s"} skipped`
          : "",
        summary.conflicts
          ? `${summary.conflicts} version conflict${summary.conflicts === 1 ? "" : "s"} retained`
          : "",
        summary.rejected.length ? `${summary.rejected.length} rejected` : "",
      ]
        .filter(Boolean)
        .join(" · ");
      notify(
        `${summary.imported + summary.conflicts} imported${details ? ` · ${details}` : ""}`,
      );
    } catch (error) {
      console.error(error);
      notify("These files could not be uploaded.");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };
  const removeAsset = async (asset: Asset) => {
    if (!documentMutable) {
      notify("Create a draft version before changing managed assets.");
      return;
    }
    try {
      await assetStorage.remove(asset.id);
      managedServerAssets.current = managedServerAssets.current.filter(
        (item) => item.id !== asset.id,
      );
      mutate((current) => ({
        ...current,
        assets: (current.assets ?? []).filter((item) => item.id !== asset.id),
      }));
      notify(`${displayAssetName(asset.name)} removed`);
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Asset could not be removed.",
      );
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const mod = event.ctrlKey || event.metaKey;
      const isFormControl = ["INPUT", "TEXTAREA", "SELECT"].includes(
        target.tagName,
      );
      // Bound-text edits and their audit override share the editor history.
      // Route undo/redo through that history even while the textarea is focused.
      if (isFormControl && !(mod && event.key.toLowerCase() === "z")) return;
      if (event.key === "Escape" && croppingId) {
        event.preventDefault();
        setCroppingId(undefined);
      } else if (event.key === "Escape" && tableEditingId) {
        event.preventDefault();
        setTableEditingId(undefined);
        setTableSelection(undefined);
      } else if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedIds.length
      ) {
        event.preventDefault();
        deleteSelected();
      } else if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (mod && event.key.toLowerCase() === "c") {
        event.preventDefault();
        copySelected();
      } else if (mod && event.key.toLowerCase() === "v") {
        event.preventDefault();
        paste();
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicateSelected();
      } else if (mod && event.key.toLowerCase() === "g") {
        event.preventDefault();
        event.shiftKey ? ungroup() : group();
      } else if (mod && (event.key === "+" || event.key === "=")) {
        event.preventDefault();
        setZoom((value) => Math.min(1.5, value + 0.1));
      } else if (mod && event.key === "-") {
        event.preventDefault();
        setZoom((value) => Math.max(0.25, value - 0.1));
      } else if (mod && event.key === "0") {
        event.preventDefault();
        setZoom(1);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        selectedIds.length
      ) {
        event.preventDefault();
        const amount = event.shiftKey ? 10 : 1,
          dx =
            event.key === "ArrowLeft"
              ? -amount
              : event.key === "ArrowRight"
                ? amount
                : 0,
          dy =
            event.key === "ArrowUp"
              ? -amount
              : event.key === "ArrowDown"
                ? amount
                : 0;
        updatePage((current) => ({
          ...current,
          elements: current.elements.map((element) =>
            selectedIds.includes(element.id) && !element.locked
              ? { ...element, x: element.x + dx, y: element.y + dy }
              : element,
          ),
        }));
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    copySelected,
    croppingId,
    deleteSelected,
    duplicateSelected,
    paste,
    redo,
    selectedIds,
    tableEditingId,
    undo,
    updatePage,
  ]);

  const navigate = (next: Destination) => {
    setDestination(next);
    const url = new URL(window.location.href);
    url.searchParams.delete("editor"); url.searchParams.delete("report");
    url.searchParams.set("workspace", next);
    window.history.pushState({}, "", url);
  };
  useEffect(() => {
    const back = () => {
      const params = new URLSearchParams(window.location.search);
      setDestination(params.has("report") || params.get("editor") === "1" ? "editor" : (params.get("workspace") as Destination) || "home");
    };
    window.addEventListener("popstate", back);
    return () => window.removeEventListener("popstate", back);
  }, []);
  const openReportFromLibrary = async (id: string, pdf = false) => {
    if (["dirty", "saving", "error", "conflict"].includes(reportSaveStatusRef.current)) {
      setOpenError("Finish saving the current report before opening another. Your current document is retained."); return;
    }
    if (documentMode === "master-template" && templateDirty) {
      setOpenError("Save the current template draft or create a new version before opening another document."); return;
    }
    setDocumentLoading(true); setOpenError("");
    try {
      const restored = await reportInstanceStore.get(id);
      const recovery = reportRecovery.load(id);
      const matches = recovery?.baseRevision === restored.revision;
      const effective = matches ? { ...restored, pages: recovery.pages, manualOverrides: recovery.manualOverrides } : restored;
      const next = hydrate({ id: restored.templateId, version: restored.templateVersion, name: `${restored.generationRequest.period} ${restored.generationRequest.market} Industrial Market Report`, pages: effective.pages, settings: restored.sourceTemplateSnapshot?.settings, assets: [...managedServerAssets.current] });
      setTemplate(next); latestTemplate.current = next;
      setReportData(buildPresentationModel(effective.dataSnapshot)); setNormalizedReport(effective.dataSnapshot);
      latestReportInstance.current = effective; setReportInstance(effective); setDocumentMode("report-instance");
      setPageId(next.pages[0].id); setSelectedIds([]); setPast([]); setFuture([]); setMode("data");
      if (matches) stageReportDocument(next, effective.manualOverrides);
      else if (recovery) setReportSaveState("conflict", "Local recovery uses an older revision. It was retained without overwriting saved work.");
      else setReportSaveState("saved");
      setReportLastSavedAt(undefined); reportInstanceStore.remember(id);
      navigate("editor"); setLeftTab("pages"); setPendingLibraryPdf(pdf);
    } catch(e) { setOpenError((e as Error).message); }
    finally { setDocumentLoading(false); }
  };
  useEffect(() => {
    if (!pendingLibraryPdf || documentLoading || !reportInstance) return;
    setPendingLibraryPdf(false); void downloadPdf();
  }, [pendingLibraryPdf, documentLoading, reportInstance]);
  useEffect(() => {
    if (destination !== "editor" || !fitMode || !stageRef.current) return;
    const stage = stageRef.current;
    const resize = () => setZoom(fitPageZoom(stage.clientWidth, stage.clientHeight, page.width, page.height, fitMode));
    resize(); const observer = new ResizeObserver(resize); observer.observe(stage);
    return () => observer.disconnect();
  }, [destination, fitMode, page.width, page.height, focusMode, leftCollapsed, inspectorCollapsed, panelWidth, inspectorWidth]);
  const resizePanel = (event: React.PointerEvent, side: "left" | "right") => {
    const start = event.clientX, width = side === "left" ? panelWidth : inspectorWidth;
    const move = (e: PointerEvent) => {
      const next = Math.max(side === "left" ? 220 : 240, Math.min(side === "left" ? 420 : 480, width + (e.clientX - start) * (side === "left" ? 1 : -1)));
      if (side === "left") setPanelWidth(next); else setInspectorWidth(next);
      localStorage.setItem(side === "left" ? "lrs.panel-width" : "lrs.inspector-width", String(next));
    };
    const end = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", end); };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", end, {once:true});
  };
  const saveLabel = documentLoading ? "Loading Document" : reportInstance
    ? ({clean:"Saved",dirty:"Unsaved Changes",saving:"Saving…",saved:"Saved",error:"Save Failed",conflict:"Conflict"}[reportSaveStatus])
    : templateSaving ? "Saving…" : librarySaveState === "conflict" ? "Conflict" : librarySaveState === "error" ? "Save Failed" : activeTemplateRecord?.status !== "draft" && activeTemplateRecord ? "Published / Read Only" : templateDirty ? "Unsaved Changes" : templateRecovered || librarySaveState === "local" ? "Local Recovery Available" : "Saved";
  const openMasterFromHub = async (record: TemplateVersionSummary) => {
    if (templateDirty || ["dirty","saving","error","conflict"].includes(reportSaveStatusRef.current)) { setOpenError("Save your current document before opening another template. Your edits are retained."); return; }
    setDocumentLoading(true); setOpenError("");
    try { await openTemplateVersion(record); reportInstanceStore.forget(); navigate("editor"); }
    finally { setDocumentLoading(false); }
  };
  const sidebar = () => {
    if (leftTab === "elements")
      return (
        <>
          <PanelTitle title="Elements" subtitle="Shapes & components" />
          <div className="shape-grid">
            {(
              [
                ["rectangle", "□"],
                ["rounded-rectangle", "▢"],
                ["circle", "○"],
                ["ellipse", "⬭"],
                ["triangle", "△"],
                ["diamond", "◇"],
                ["line", "╱"],
              ] as const
            ).map(([shape, icon]) => (
              <button key={shape} onClick={() => addShape(shape)}>
                <span>{icon}</span>
                {shape.replace("-", " ")}
              </button>
            ))}
          </div>
          <PanelTitle title="Layers" />
          <div className="layer-list">
            {[...page.elements].reverse().map((element) => (
              <button
                key={element.id}
                className={selectedIds.includes(element.id) ? "active" : ""}
                onClick={(event) => select(element.id, event.shiftKey)}
              >
                <span>{element.hidden ? "◌" : element.locked ? "▣" : "◇"}</span>
                <em>{displayAssetName(element.name)}</em>
                <small>{element.type}</small>
              </button>
            ))}
          </div>
        </>
      );
    if (leftTab === "text")
      return (
        <>
          <PanelTitle title="Text" subtitle="Add text to your page" />
          <button
            className="text-preset heading"
            onClick={() => addText("heading")}
          >
            Add a heading
          </button>
          <button
            className="text-preset subheading"
            onClick={() => addText("subheading")}
          >
            Add a subheading
          </button>
          <button className="text-preset" onClick={() => addText("body")}>
            Add body text
          </button>
        </>
      );
    if (leftTab === "fonts") {
      const fontAssets = approvedManagedFontAssets(
        template.assets ?? [],
      ).filter((asset) => asset.fontFamily);
      const families = groupFontAssets(fontAssets);
      return (
        <>
          <PanelTitle
            title="Fonts"
            subtitle="Managed organization font library"
          />
          <button
            className="upload-drop compact-upload"
            onClick={() => uploadRef.current?.click()}
          >
            <span>↥</span>
            <strong>Import font bundle</strong>
            <small>ZIP, WOFF2, WOFF, TTF or OTF</small>
          </button>
          <input
            hidden
            multiple
            ref={uploadRef}
            type="file"
            accept=".zip,.woff,.woff2,.ttf,.otf"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="font-library">
            {[...families.entries()].map(([family, faces]) => {
              const sortedFaces = [...faces].sort(
                (a, b) =>
                  (a.fontWeight ?? 400) - (b.fontWeight ?? 400) ||
                  (a.fontStyle ?? "normal").localeCompare(
                    b.fontStyle ?? "normal",
                  ),
              );
              const previewFace =
                sortedFaces.find(
                  (face) =>
                    (face.fontWeight ?? 400) === 400 &&
                    (face.fontStyle ?? "normal") === "normal",
                ) ?? sortedFaces[0];
              const loadedFaces = faces.filter((face) =>
                fontDiagnostics.some(
                  (diagnostic) =>
                    diagnostic.assetId === face.id && diagnostic.loaded,
                ),
              ).length;
              const licenseTypes = [
                ...new Set(
                  faces.flatMap((face) =>
                    face.license?.type ? [face.license.type] : [],
                  ),
                ),
              ];
              const licenseFiles = [
                ...new Set(
                  faces.flatMap((face) =>
                    face.license?.fileName ? [face.license.fileName] : [],
                  ),
                ),
              ];
              const licenseLabel = licenseTypes.length
                ? licenseTypes.join(", ")
                : licenseFiles.length
                  ? `Unverified · ${licenseFiles.join(", ")}`
                  : "Not provided · Unverified";
              return (
                <section className="font-family-card" key={family}>
                  <header>
                    <strong style={{ fontFamily: fontFamilyToCss(family) }}>
                      {family}
                    </strong>
                    <span>{faces.length} faces</span>
                  </header>
                  <p
                    className="font-family-preview"
                    style={{
                      fontFamily: fontFamilyToCss(family),
                      fontWeight: previewFace?.fontWeight ?? 400,
                      fontStyle: previewFace?.fontStyle ?? "normal",
                    }}
                  >
                    The quick brown fox jumps over the lazy dog.
                  </p>
                  <div className="font-family-status">
                    <span>
                      {loadedFaces}/{faces.length} loaded
                    </span>
                    <span>License: {licenseLabel}</span>
                    <span>
                      Governance: {inferFontGovernanceStatus(faces[0]!)} ·
                      checksum verified
                    </span>
                  </div>
                  {sortedFaces.map((face) => (
                    <div className="font-face-row" key={face.id}>
                      <span>
                        {face.fontWeight ?? 400} {face.fontStyle ?? "normal"}
                      </span>
                      <small
                        title={`Managed asset ${face.id}\nChecksum ${face.checksum ?? "missing"}`}
                      >
                        {fontDiagnostics.find(
                          (diagnostic) => diagnostic.assetId === face.id,
                        )?.loaded
                          ? "Loaded ✓ · "
                          : "Unavailable ⚠ · "}
                        {face.license?.type ??
                          (face.license?.fileName
                            ? `Unverified · ${face.license.fileName}`
                            : "Not provided · Unverified")}
                        {` · asset v${face.version ?? 1}`}
                        {face.checksum
                          ? ` · ${face.checksum.slice(0, 10)}…`
                          : ""}
                      </small>
                      <button
                        title="Remove font face"
                        onClick={() => removeAsset(face)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </section>
              );
            })}
          </div>
          {!fontAssets.length && (
            <div className="empty-state">
              <strong>No managed fonts</strong>
              <span>
                Import a font-family ZIP to expose its real weights and styles
                in the editor.
              </span>
            </div>
          )}
        </>
      );
    }
    if (leftTab === "uploads" || leftTab === "images")
      return (
        <>
          <PanelTitle
            title={
              replacingImageId
                ? "Replace Image"
                : leftTab === "uploads"
                  ? "Uploads"
                  : "Images"
            }
            subtitle={
              replacingImageId
                ? "Choose or upload a managed image"
                : "Images, logos & fonts"
            }
          />
          {replacingImageId && (
            <button
              className="cancel-image-replacement"
              onClick={() => setReplacingImageId(undefined)}
            >
              Cancel replacement
            </button>
          )}
          <button
            className="upload-drop"
            onClick={() => uploadRef.current?.click()}
          >
            <span>↥</span>
            <strong>Upload files</strong>
            <small>PNG, JPG, WebP, SVG, ZIP, WOFF2, WOFF, TTF or OTF</small>
          </button>
          <input
            hidden
            multiple
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.zip,.woff,.woff2,.ttf,.otf"
            onChange={(e) => handleFiles(e.target.files)}
          />
          <div className="asset-grid">
            {(template.assets ?? [])
              .filter((asset) => asset.type !== "font")
              .map((asset) => (
                <button
                  key={asset.id}
                  aria-label={`${replacingImageId ? "Replace image with" : "Add"} ${displayAssetName(asset.name)}`}
                  onClick={() => useImageAsset(asset)}
                >
                  <img src={asset.source} alt="" />
                  <span>{displayAssetName(asset.name)}</span>
                </button>
              ))}
          </div>
          {!(template.assets ?? []).length && (
            <div className="empty-state">
              <strong>No uploads yet</strong>
              <span>
                Upload an image, logo, or font to use it in your report.
              </span>
            </div>
          )}
        </>
      );
    if (leftTab === "data")
      return <DataBrowser onBind={bind} reportInstance={reportInstance} />;
    if (leftTab === "templates")
      return (
        <>
          {leftTab === "templates" && (
            <>
              <PanelTitle
                title="Template Library"
                subtitle="Drafts, published templates and history"
              />
              <div className="master-mode-card">
                <strong>
                  {documentMode === "master-template"
                    ? "Master template"
                    : "Quarterly report"}
                </strong>
                <span>
                  {documentMode === "report-instance" && reportInstance
                    ? `${reportInstance.generationRequest.period} · ${reportInstance.status === "published" ? "Published report · Read only" : "Draft report"} · Pinned template v${reportInstance.templateVersion}`
                    : activeTemplateRecord ? `${activeTemplateRecord.label || activeTemplateRecord.name} · v${activeTemplateRecord.version} · ${activeTemplateRecord.status}` : "Loading template library…"}
                </span>
                <small>
                  {documentMode === "master-template"
                    ? "Published changes affect future reports only."
                    : reportInstance?.status === "published" ? "This finalized report is read-only. The templates below are separate reusable layouts." : "Edits are isolated to this generated report. The templates below are separate reusable layouts."}
                </small>
              </div>
              <div className="template-version-list">
                <div className="library-tabs">{[["draft","Drafts"],["published","Published"],["archived","History"]].map(([key,label]) => <button key={key} aria-pressed={templateFilter === key} onClick={() => setTemplateFilter(key)}>{label}</button>)}</div>
                {templateLibrary.filter(record => record.status === templateFilter).map((record) => (
                  <section
                    key={`${record.id}-${record.version}`}
                    className={
                      activeTemplateRecord?.id === record.id &&
                      activeTemplateRecord.version === record.version
                        ? "active"
                        : ""
                    }
                  >
                    <div>
                      {renamingVersionKey ===
                      `${record.id}-${record.version}` ? (
                        <form
                          className="rename-version-form"
                          onSubmit={(event) => {
                            event.preventDefault();
                            const input =
                              event.currentTarget.elements.namedItem(
                                "label",
                              ) as HTMLInputElement;
                            void renameTemplateVersion(record, input.value);
                          }}
                        >
                          <input
                            name="label"
                            aria-label={`Label for v${record.version}`}
                            defaultValue={record.label ?? ""}
                            placeholder={record.name}
                            autoFocus
                            onKeyDown={(event) => {
                              if (event.key === "Escape")
                                setRenamingVersionKey(undefined);
                            }}
                          />
                          <button type="submit">Save</button>
                          <button
                            type="button"
                            onClick={() => setRenamingVersionKey(undefined)}
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <strong>{record.label || record.name}</strong>
                      )}
                      <span>
                        v{record.version} · {record.status}
                      </span>
                      <small>
                        Updated {new Date(record.updatedAt).toLocaleString()}
                      </small>
                    </div>
                    <div className="template-version-actions">
                      <button onClick={() => openTemplateVersion(record)}>
                        {record.status === "draft" ? "Open Draft" : "Open"}
                      </button>
                      <button onClick={() => createDraftFromVersion(record)}>
                        {record.status === "draft"
                          ? "Create New Version"
                          : "Create Draft From Version"}
                      </button>
                      {record.status === "draft" && (
                        <button
                          className="delete-draft-button"
                          onClick={() => setDraftToDelete(record)}
                        >
                          Delete Draft
                        </button>
                      )}
                      <div className="template-version-menu">
                        <button
                          aria-label={`More actions for v${record.version}`}
                          aria-expanded={
                            versionMenuKey === `${record.id}-${record.version}`
                          }
                          onClick={() =>
                            setVersionMenuKey((current) =>
                              current === `${record.id}-${record.version}`
                                ? undefined
                                : `${record.id}-${record.version}`,
                            )
                          }
                        >
                          •••
                        </button>
                        {versionMenuKey ===
                          `${record.id}-${record.version}` && (
                          <div role="menu">
                            <button
                              role="menuitem"
                              onClick={() => openTemplateVersion(record)}
                            >
                              Open version
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => createDraftFromVersion(record)}
                            >
                              Duplicate as new draft
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                setRenamingVersionKey(
                                  `${record.id}-${record.version}`,
                                );
                                setVersionMenuKey(undefined);
                              }}
                            >
                              Rename
                            </button>
                            <button
                              role="menuitem"
                              onClick={() => {
                                notify(
                                  "All versions are shown in this version history.",
                                );
                                setVersionMenuKey(undefined);
                              }}
                            >
                              View version history
                            </button>
                            {record.status === "draft" && (
                              <button
                                role="menuitem"
                                className="danger"
                                onClick={() => setDraftToDelete(record)}
                              >
                                Delete draft
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </section>
                ))}
              </div>
              {documentMode === "master-template" && <div className="panel-actions template-actions">
                <button
                  disabled={
                    documentMode !== "master-template" ||
                    activeTemplateRecord?.status !== "draft"
                  }
                  onClick={saveMasterTemplate}
                >
                  Save
                </button>
                <button
                  disabled={!activeTemplateRecord}
                  onClick={() => saveAsNewTemplateVersion()}
                >
                  Save As New Version
                </button>
                <button
                  disabled={activeTemplateRecord?.status !== "draft"}
                  onClick={() => setShowPublishReview(true)}
                >
                  Publish Template
                </button>
              </div>}
            </>
          )}
        </>
      );
    if (leftTab === "pages")
      return (
        <>
          <PanelTitle
            title="Pages"
            subtitle={`${template.pages.length} page${template.pages.length === 1 ? "" : "s"} · current page highlighted`}
          />
          <button className="create-report-button" onClick={startCreateReport}>
            ＋ Create report from data
          </button>
          <input className="page-search" type="search" aria-label="Search pages or markets" placeholder="Find a page or market…" value={pageSearch} onChange={e => setPageSearch(e.target.value)} />
          <div className="page-list" ref={pageListRef}>
            {template.pages.map((item, index) => ({item,index})).filter(({item}) => `${item.name} ${pageSection(item, normalizedReport)} ${item.pageNumber ?? ""}`.toLowerCase().includes(pageSearch.toLowerCase())).map(({item,index}, visibleIndex, visiblePages) => (
              <React.Fragment key={item.id}>
              {(visibleIndex === 0 || pageSection(visiblePages[visibleIndex-1].item, normalizedReport) !== pageSection(item, normalizedReport)) && <div className="page-section-label">{pageSection(item, normalizedReport)}</div>}
              <button
                type="button"
                draggable
                key={item.id}
                className={`${item.id === page.id ? "active" : ""} ${draggedPageId === item.id ? "dragging" : ""}`}
                onDragStart={() => setDraggedPageId(item.id)}
                onDragEnd={() => setDraggedPageId(undefined)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => dropPage(item.id)}
                onClick={() => {
                  setPageId(item.id);
                  setSelectedIds([]);
                }}
              >
                <div className="thumb">
                  <span>{index + 1}</span>
                  {item.elements.slice(0, 8).map((element) => (
                    <i
                      key={element.id}
                      style={{
                        left: `${(element.x / item.width) * 100}%`,
                        top: `${(element.y / item.height) * 100}%`,
                        width: `${Math.max(3, (element.width / item.width) * 100)}%`,
                        height: `${Math.max(1, (element.height / item.height) * 100)}%`,
                      }}
                    />
                  ))}
                </div>
                <span><small className="page-number">Page {item.pageNumber ?? index+1}</small>{item.name}</span>
              </button></React.Fragment>
            ))}
          </div>
          <div className="page-setup">
            <label>
              Page name
              <input
                value={page.name}
                onChange={(e) =>
                  updatePage((current) => ({
                    ...current,
                    name: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              Page size
              <select
                value={page.width > page.height ? "landscape" : "portrait"}
                onChange={(e) =>
                  updatePage((current) => ({
                    ...current,
                    width: e.target.value === "landscape" ? 1056 : 816,
                    height: e.target.value === "landscape" ? 816 : 1056,
                  }))
                }
              >
                <option value="portrait">Letter portrait</option>
                <option value="landscape">Letter landscape</option>
              </select>
            </label>
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.marginsEnabled}
                  onChange={(e) =>
                    setSettings({ marginsEnabled: e.target.checked })
                  }
                />{" "}
                Margins
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.snapToMargins}
                  onChange={(e) =>
                    setSettings({ snapToMargins: e.target.checked })
                  }
                />{" "}
                Snap margins
              </label>
            </div>
            <div className="field-grid">
              <label>
                Margin (px)
                <input
                  type="number"
                  min="0"
                  value={settings.marginPx}
                  onChange={(e) =>
                    setSettings({ marginPx: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Grid (px)
                <input
                  type="number"
                  min="2"
                  value={settings.gridSpacingPx}
                  onChange={(e) =>
                    setSettings({ gridSpacingPx: Number(e.target.value) })
                  }
                />
              </label>
            </div>
            <div className="check-row">
              <label>
                <input
                  type="checkbox"
                  checked={settings.snapToGrid}
                  onChange={(e) =>
                    setSettings({ snapToGrid: e.target.checked })
                  }
                />{" "}
                Snap grid
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.snapToElements}
                  onChange={(e) =>
                    setSettings({ snapToElements: e.target.checked })
                  }
                />{" "}
                Snap objects
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={settings.rulersEnabled ?? true}
                  onChange={(e) =>
                    setSettings({ rulersEnabled: e.target.checked })
                  }
                />{" "}
                Rulers
              </label>
            </div>
          </div>
          <div className="panel-actions">
            <button onClick={addPage}>+ Add page</button>
            <button onClick={duplicatePage}>Duplicate</button>
            <button onClick={deletePage}>Delete</button>
            <button onClick={() => movePage(-1)}>Move up</button>
            <button onClick={() => movePage(1)}>Move down</button>
          </div>
        </>
      );
    return (
      <ValidationPanel
        items={validations}
        completeness={reportInstance?.dataSnapshot.dataCompleteness}
        onSelect={(id, targetPageId) => {
          if (targetPageId) setPageId(targetPageId);
          setSelectedIds([id]);
          setLeftTab("elements");
        }}
        onViewReconciliation={setReconciliationPath}
      />
    );
  };

  return (
    <div className="app-shell redesigned-app" onClick={() => setContextMenu(undefined)}>
      <GlobalNavigation destination={destination === "editor" ? documentMode === "master-template" ? "templates" : "reports" : destination} onNavigate={navigate} />
      {openError && <div className="application-error" role="alert">{openError}<button onClick={() => setOpenError("")}>Dismiss</button></div>}
      {destination !== "editor" && <ApplicationHub destination={destination} templates={templateLibrary} onNavigate={navigate} onCreate={() => { navigate("editor"); startCreateReport(); }} onOpenReport={openReportFromLibrary} onOpenTemplate={openMasterFromHub} onCreateVersion={async record => { if(templateDirty || ["dirty","saving","error","conflict"].includes(reportSaveStatusRef.current)) { setOpenError("Save your current document before creating a version."); return; } await createDraftFromVersion(record); navigate("editor"); }} onRename={renameTemplateVersion} onDeleteDraft={setDraftToDelete} loadingDocument={documentLoading} />}
      <div className="editor-surface" hidden={destination !== "editor"}>
      <header className="document-header">
        <button onClick={() => navigate(reportInstance ? "reports" : "templates")}>← {reportInstance ? "Reports" : "Templates"}</button>
        <div className="document-identity"><strong>{reportInstance ? template.name : activeTemplateRecord?.label || template.name}</strong><span>{reportInstance ? `Report · ${reportInstance.generationRequest.period} · ${reportInstance.status}` : `Template · v${activeTemplateRecord?.version ?? template.version} · ${activeTemplateRecord?.status ?? "local recovery"}`}</span></div>
        <div className={`document-save-state state-${saveLabel.toLowerCase().replace(/[^a-z]/g, "")}`} role="status" title={reportSaveError || librarySaveError}><strong>{saveLabel}</strong>{reportInstance && reportLastSavedAt && reportSaveStatus === "saved" && <small>{new Date(reportLastSavedAt).toLocaleTimeString()}</small>}{templateRecovered && templateDirty && <small>Recovered locally · save draft to keep</small>}{(reportSaveError || librarySaveError) && <small>{reportSaveError || librarySaveError}</small>}{reportSaveStatus === "error" && <button onClick={() => runReportSaveRef.current()}>Retry save</button>}</div>
        <div className="document-actions">{reportInstance ? <><button disabled={reportInstance.status === "published"} onClick={() => setShowNarratives(true)}>Narratives</button><button onClick={async () => { try { const response = await fetch(`/api/templates/${encodeURIComponent(reportInstance.templateId)}/versions/${encodeURIComponent(reportInstance.templateVersion)}/archive-older`, { method: "POST" }); const body = await response.json(); if (!response.ok) throw new Error(body.error || "Cleanup failed."); setTemplateLibrary(await templateStore.list()); notify(`${body.archived} older templates archived. They remain available in History.`); } catch (e) { setOpenError((e as Error).message); } }}>Archive older templates</button><button disabled={reportInstance.status === "published" || narrativeDirty || ["dirty","saving","error","conflict"].includes(reportSaveStatus)} onClick={() => setShowPublishReport(true)}>{reportInstance.status === "published" ? "Published report" : "Publish Report"}</button><a href={`/?marketAssets=1&report=${encodeURIComponent(reportInstance.id)}`}>Export Market Assets</a></> : <><button disabled={activeTemplateRecord?.status !== "draft" || templateSaving} onClick={saveMasterTemplate}>Save Draft</button><button disabled={!activeTemplateRecord} onClick={() => saveAsNewTemplateVersion()}>Save as New Version</button><button disabled={activeTemplateRecord?.status !== "draft"} onClick={() => setShowPublishReview(true)}>Publish Template</button></>}
        <button onClick={() => setLeftTab("validate")}>Review / Validate</button><button className="primary-button" disabled={exportingPdf || documentLoading} onClick={downloadPdf}>{exportingPdf ? "Rendering…" : "Export PDF"}</button></div>
      </header>
      <header className="topbar editing-toolbar">
        <div className="toolbar-group">
          <button
            className="icon-button"
            disabled={!past.length || !documentMutable}
            title="Undo · Ctrl+Z"
            aria-label="Undo"
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="icon-button"
            disabled={!future.length || !documentMutable}
            title="Redo · Ctrl+Shift+Z"
            aria-label="Redo"
            onClick={redo}
          >
            ↷
          </button>
        </div>
        <div className="toolbar-group zoom-control">
          <button
            title="Zoom out"
            aria-label="Zoom out"
            onClick={() => { setFitMode(undefined); setZoom(Math.max(0.1, zoom - 0.1)); }}
          >
            −
          </button>
          <select
            aria-label="Zoom"
            value={Math.round(zoom * 100)}
            onChange={(e) => { setFitMode(undefined); setZoom(Number(e.target.value) / 100); }}
          >
            {[...new Set([Math.round(zoom * 100), 25, 50, 75, 100, 125, 150])].sort((a,b)=>a-b).map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
          <button
            title="Zoom in"
            aria-label="Zoom in"
            onClick={() => { setFitMode(undefined); setZoom(Math.min(2, zoom + 0.1)); }}
          >
            +
          </button>
          <button title="Fit the entire selected page" onClick={() => setFitMode("page")}>Fit</button><button onClick={() => setFitMode("width")}>Fit Width</button>
        </div>
        <details className="view-options"><summary>View options</summary><div className="view-options-menu">        <div className="toolbar-group segmented compact">
          <button
            className={settings.unit === "px" ? "active" : ""}
            onClick={() => setSettings({ unit: "px" })}
          >
            px
          </button>
          <button
            className={settings.unit === "in" ? "active" : ""}
            onClick={() => setSettings({ unit: "in" })}
          >
            in
          </button>
        </div>
        <div className="toolbar-group">
          <button
            className={settings.gridEnabled ? "active" : ""}
            title="Toggle grid"
            onClick={() => setSettings({ gridEnabled: !settings.gridEnabled })}
          >
            Grid
          </button>
          <button
            className={settings.rulersEnabled ? "active" : ""}
            title="Toggle rulers and custom guides"
            onClick={() =>
              setSettings({ rulersEnabled: !settings.rulersEnabled })
            }
          >
            Rulers
          </button>
          <button
            className={
              settings.snapToElements || settings.snapToGrid ? "active" : ""
            }
            title="Toggle snapping"
            onClick={() =>
              setSettings({
                snapToElements: !(
                  settings.snapToElements || settings.snapToGrid
                ),
                snapToGrid: false,
              })
            }
          >
            Snap
          </button>
        </div>
<button onClick={downloadTemplate}>Download JSON source</button></div></details>
        <div className="toolbar-spacer" />
        <button
          className="toolbar-button create-report-top"
          onClick={startCreateReport}
        >
          ＋ Create report
        </button>
        <div className="mode-toggle">
          <button
            className={mode === "design" ? "active" : ""}
            onClick={() => setMode("design")}
          >
            Design
          </button>
          <button
            className={mode === "data" ? "active" : ""}
            onClick={() => setMode("data")}
          >
            Data preview
          </button>
        </div>
        <button
          className="toolbar-button"
          onClick={() => setLeftTab("validate")}
        >
          <span
            className={`status-dot ${validations.some((item) => item.level === "error" || item.level === "blocking") ? "error" : validations.some((item) => item.level === "warning") ? "warning" : ""}`}
          />
          Validate
        </button>
        <button className="toolbar-button" aria-pressed={leftCollapsed} onClick={() => setLeftCollapsed(!leftCollapsed)}>Tools panel</button>
        <button className="toolbar-button" aria-pressed={inspectorCollapsed} onClick={() => setInspectorCollapsed(!inspectorCollapsed)}>Inspector</button>
        <button className="toolbar-button focus-toggle" aria-pressed={focusMode} onClick={() => setFocusMode(!focusMode)}>{focusMode ? "Exit Focus Mode" : "Focus Mode"}</button>
      </header>
      <div className={`workspace ${focusMode ? "focus-mode" : ""} ${leftCollapsed ? "left-collapsed" : ""} ${inspectorCollapsed ? "inspector-collapsed" : ""}`} style={{ "--left-width": `${panelWidth}px`, "--inspector-width": `${inspectorWidth}px` } as React.CSSProperties}>
        <nav className="rail" aria-label="Editor tools">
          {(
            [
              ["templates", "▤", "Templates"],
              ["pages", "▥", "Pages"],
              ["elements", "◇", "Elements"],
              ["text", "T", "Text"],
              ["images", "▧", "Images"],
              ["uploads", "↥", "Uploads"],
              ["fonts", "Aa", "Fonts"],
              ["data", "⛓", "Data"],
              ["validate", "✓", "QA"],
            ] as const
          ).map(([tab, icon, label]) => (
            <button
              key={tab}
              className={leftTab === tab ? "active" : ""}
              onClick={() => { setLeftTab(tab); setLeftCollapsed(false); }}
              title={label}
              aria-pressed={leftTab === tab}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <aside
          className={`left-panel ${leftTab === "pages" ? "pages-panel" : ""}`}
        >
          <button className="panel-close" aria-label="Collapse tools panel" onClick={() => setLeftCollapsed(true)}>‹</button>
          {sidebar()}
          <button className="reset-link" onClick={reset}>
            Restore sample document
          </button>
        </aside>
        <div role="separator" tabIndex={0} aria-label="Resize tools panel" aria-orientation="vertical" className="panel-resizer left-resizer" onPointerDown={e=>resizePanel(e,"left")} onKeyDown={e=>{if(e.key === "ArrowLeft" || e.key === "ArrowRight") setPanelWidth(w=>Math.max(220,Math.min(420,w+(e.key === "ArrowRight" ? 10:-10))));}} />
        <main
          ref={stageRef}
          className="stage"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(".canvas-element"))
              return;
            if (event.shiftKey) return;
            setSelectedIds([]);
            // Clicking outside the cropped image is a commit trigger for
            // crop mode (see CanvasElement's crop-mode effect: any exit that
            // isn't Escape commits the in-progress temporary crop).
            setCroppingId(undefined);
            setTableEditingId(undefined);
            setTableSelection(undefined);
          }}
        >
          <div className="stage-topline">
            <span>{page.name}</span>
            <span>
              {settings.unit === "in"
                ? `${(page.width / PX_PER_INCH).toFixed(1)} × ${(page.height / PX_PER_INCH).toFixed(1)} in`
                : `${page.width} × ${page.height} px`}
            </span>
          </div>
          <div
            className="canvas-wrap"
            style={{ width: page.width * zoom, height: page.height * zoom }}
          >
            <div
              className={`page-canvas ${settings.gridEnabled ? "show-grid" : ""}`}
              style={{
                width: page.width,
                height: page.height,
                backgroundColor: page.background,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
                backgroundSize: `${settings.gridSpacingPx}px ${settings.gridSpacingPx}px`,
                ["--grid-opacity" as string]: settings.gridOpacity,
              }}
            >
              {settings.rulersEnabled && (
                <>
                  <div
                    className="ruler ruler-x"
                    title="Double-click to add a vertical guide"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      const rect = (
                        event.currentTarget.parentElement as HTMLElement
                      ).getBoundingClientRect();
                      addGuide("x", (event.clientX - rect.left) / zoom);
                    }}
                  >
                    {Array.from(
                      {
                        length:
                          Math.ceil(
                            page.width /
                              (settings.unit === "in" ? PX_PER_INCH : 50),
                          ) + 1,
                      },
                      (_, index) => (
                        <i
                          key={index}
                          style={{
                            left:
                              index *
                              (settings.unit === "in" ? PX_PER_INCH : 50),
                          }}
                        >
                          <span>
                            {settings.unit === "in" ? index : index * 50}
                          </span>
                        </i>
                      ),
                    )}
                  </div>
                  <div
                    className="ruler ruler-y"
                    title="Double-click to add a horizontal guide"
                    onDoubleClick={(event) => {
                      event.stopPropagation();
                      const rect = (
                        event.currentTarget.parentElement as HTMLElement
                      ).getBoundingClientRect();
                      addGuide("y", (event.clientY - rect.top) / zoom);
                    }}
                  >
                    {Array.from(
                      {
                        length:
                          Math.ceil(
                            page.height /
                              (settings.unit === "in" ? PX_PER_INCH : 50),
                          ) + 1,
                      },
                      (_, index) => (
                        <i
                          key={index}
                          style={{
                            top:
                              index *
                              (settings.unit === "in" ? PX_PER_INCH : 50),
                          }}
                        >
                          <span>
                            {settings.unit === "in" ? index : index * 50}
                          </span>
                        </i>
                      ),
                    )}
                  </div>
                  <div className="ruler-corner">{settings.unit}</div>
                </>
              )}
              {settings.marginsEnabled && (
                <div
                  className="margin-guides"
                  style={{ inset: settings.marginPx }}
                />
              )}
              {(settings.customGuides ?? []).map((guide) => (
                <div
                  key={guide.id}
                  className={`custom-guide ${guide.axis}`}
                  style={
                    guide.axis === "x"
                      ? { left: guide.position }
                      : { top: guide.position }
                  }
                  onPointerDown={(event) => startGuideDrag(event, guide)}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    removeGuide(guide.id);
                  }}
                >
                  <span>
                    {formatUnit(guide.position, settings.unit)} {settings.unit}
                  </span>
                </div>
              ))}
              {page.elements.map((element) => (
                <CanvasElement
                  key={element.id}
                  element={element}
                  elements={page.elements}
                  pageSize={page}
                  settings={settings}
                  data={reportData}
                  manualOverrides={reportInstance?.manualOverrides}
                  onNarrativeFit={handleNarrativeFit}
                  mode={mode}
                  selected={selectedIds.includes(element.id)}
                  selectedIds={selectedIds}
                  cropping={croppingId === element.id}
                  tableEditing={tableEditingId === element.id}
                  tableSelection={
                    tableEditingId === element.id ? tableSelection : undefined
                  }
                  onEnterTableEdit={(id) => {
                    setTableEditingId(id);
                    setTableSelection(undefined);
                  }}
                  onTableSelect={setTableSelection}
                  onCommitCrop={() => setCroppingId(undefined)}
                  pages={template.pages}
                  onNavigatePage={(targetPageId) => {
                    setPageId(targetPageId);
                    setSelectedIds([]);
                    setTableEditingId(undefined);
                    setTableSelection(undefined);
                  }}
                  zoom={zoom}
                  onSelect={select}
                  onChange={updateElement}
                  readOnly={!documentMutable}
                  onInteractionStart={beginInteraction}
                  onInteractionEnd={endInteraction}
                  onGuides={setGuides}
                  onContextMenu={(event, id) => {
                    event.preventDefault();
                    event.stopPropagation();
                    setSelectedIds([id]);
                    setContextMenu({ x: event.clientX, y: event.clientY, id });
                  }}
                />
              ))}
              {guides.map((guide, index) => (
                <div
                  key={`${guide.axis}-${index}`}
                  className={`snap-guide ${guide.axis}`}
                  style={
                    guide.axis === "x"
                      ? { left: guide.position }
                      : { top: guide.position }
                  }
                >
                  <span>{guide.axis === "x" ? "CENTER X" : "CENTER Y"}</span>
                </div>
              ))}
            </div>
          </div>
        </main>
        <div role="separator" tabIndex={0} aria-label="Resize inspector" aria-orientation="vertical" className="panel-resizer right-resizer" onPointerDown={e=>resizePanel(e,"right")} onKeyDown={e=>{if(e.key === "ArrowLeft" || e.key === "ArrowRight") setInspectorWidth(w=>Math.max(240,Math.min(480,w+(e.key === "ArrowLeft" ? 10:-10))));}} />
        <Inspector
          element={selected}
          unit={settings.unit}
          selectionCount={selectedIds.length}
          pageElements={page.elements}
          data={reportData}
          report={normalizedReport}
          fontAssets={(template.assets ?? []).filter(
            (asset) => asset.type === "font" && asset.fontFamily,
          )}
          fontDiagnostics={fontDiagnostics}
          cropping={croppingId === selected?.id}
          tableEditing={tableEditingId === selected?.id}
          tableSelection={
            tableEditingId === selected?.id ? tableSelection : undefined
          }
          generated={Boolean(reportInstance)}
          manualOverrides={reportInstance?.manualOverrides}
          onTableValueOverride={reportInstance ? (cellKey, bindingPath, generatedValue, value) => {
            if (selected?.type !== "table" || (value !== null && !isPlainDisplayValue(value))) return;
            const elementId = selected.id;
            mutate((current) => current, true, (overrides) => value === null
              ? overrides.filter((item) => !(item.elementId === elementId && item.cellKey === cellKey))
              : upsertManualOverride(overrides, { elementId, cellKey, bindingPath, generatedValue, overrideValue: value }));
          } : undefined}
          readOnly={!documentMutable}
          onToggleTableEdit={() => {
            if (tableEditingId === selected?.id) {
              setTableEditingId(undefined);
              setTableSelection(undefined);
            } else if (selected?.type === "table") {
              setTableEditingId(selected.id);
              setTableSelection(undefined);
            }
          }}
          onTableSelectionChange={setTableSelection}
          onToggleCrop={() =>
            setCroppingId((current) =>
              current === selected?.id ? undefined : selected?.id,
            )
          }
          onReplaceImage={() => {
            if (selected?.type !== "image") return;
            setReplacingImageId(selected.id);
            setLeftTab("images");
          }}
          onChange={updateSelected}
          onAlign={align}
          onDistribute={distributeSelection}
          canUnion={unionAvailability.enabled}
          unionReason={unionAvailability.reason}
          onUnion={unionSelectedShapes}
        />
      </div>
      <footer className="statusbar">
        <span>
          {page.name} · {page.elements.length} elements ·{" "}
          {selectedIds.length ? `${selectedIds.length} selected` : "Ready"}
        </span>
        <span>
          {past.length} history steps ·{" "}
          {validations.filter((item) => item.level === "blocking").length}{" "}
          blockers ·{" "}
          {validations.filter((item) => item.level === "warning").length}{" "}
          warnings ·{" "}
          {generationProgress?.message
            ? `${generationProgress.message} · `
            : ""}
          {reportInstance ? (
            <>
              {reportInstance.manualOverrides.length} manual override{reportInstance.manualOverrides.length === 1 ? "" : "s"} · Report{" "}
              {reportSaveStatus}
              {reportLastSavedAt && reportSaveStatus === "saved"
                ? ` at ${new Date(reportLastSavedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`
                : ""}
              {reportSaveError ? ` · ${reportSaveError}` : ""}
            </>
          ) : null}
          {!reportInstance &&
          librarySaveState === "saved" &&
          documentMode === "master-template"
            ? "Saved to template library"
            : !reportInstance && librarySaveState === "conflict"
              ? `Template save conflict${librarySaveError ? ` · ${librarySaveError}` : ""}`
              : !reportInstance && librarySaveState === "error"
                ? "Template library save failed"
                : !reportInstance
                  ? "Saved locally for recovery"
                  : ""}
          {!reportInstance &&
          librarySaveState !== "conflict" &&
          librarySaveError
            ? ` · ${librarySaveError}`
            : ""}
        </span>
      </footer>
      {contextMenu && (
        <div
          className="context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          <button onClick={duplicateSelected}>
            Duplicate <kbd>Ctrl D</kbd>
          </button>
          <button onClick={copySelected}>
            Copy <kbd>Ctrl C</kbd>
          </button>
          <button onClick={paste}>
            Paste <kbd>Ctrl V</kbd>
          </button>
          <hr />
          <button onClick={() => updateSelected({ locked: !selected?.locked })}>
            {selected?.locked ? "Unlock" : "Lock"}
          </button>
          <button onClick={() => updateSelected({ hidden: !selected?.hidden })}>
            {selected?.hidden ? "Show" : "Hide"}
          </button>
          <hr />
          <button onClick={() => reorderLayer("front")}>Bring to front</button>
          <button onClick={() => reorderLayer("forward")}>Bring forward</button>
          <button onClick={() => reorderLayer("backward")}>
            Send backward
          </button>
          <button onClick={() => reorderLayer("back")}>Send to back</button>
          <hr />
          <button className="danger" onClick={deleteSelected}>
            Delete <kbd>Del</kbd>
          </button>
        </div>
      )}
      </div>
      {documentLoading && destination === "editor" && <div className="document-loading" role="status"><BrandLogo /><p>Loading Document…</p></div>}
      {showPublishReport && reportInstance && <ReviewDialog title="Publish Report" onClose={() => !publishing && setShowPublishReport(false)}><p>Finalize {reportInstance.generationRequest.market} · {reportInstance.generationRequest.period}. Your saved pages, narratives, source snapshot and manual overrides will be preserved. This edition will be read-only in the Reports library.</p><p>Review warnings before publishing. Publishing records your finalized edition locally; it does not upload it to a public website.</p><button disabled={publishing} onClick={() => setShowPublishReport(false)}>Keep editing</button><button className="primary-button" disabled={publishing} onClick={async () => { setPublishing(true); try { if (["dirty","saving","error","conflict"].includes(reportSaveStatusRef.current)) throw new Error("Wait for report changes to finish saving before publishing."); const saved = latestReportInstance.current ?? reportInstance; handleReportInstanceChange(await reportInstanceStore.publish(saved.id, saved.revision)); setShowPublishReport(false); } catch (e) { setOpenError((e as Error).message); } finally { setPublishing(false); } }}>{publishing ? "Publishing…" : "Confirm Publish Report"}</button></ReviewDialog>}
      {showPublishReview && <ReviewDialog title="Publish Template" onClose={() => !publishing && setShowPublishReview(false)}><h3>{activeTemplateRecord?.label || template.name}</h3><p>Version {activeTemplateRecord?.version} · Future reports only</p><p>Publishing makes this version read-only. Existing saved reports keep their pinned template and content.</p><p>{validations.filter(v=>v.level === "blocking" || v.level === "error").length} blocking issues · {validations.filter(v=>v.level === "warning").length} warnings in document checks. PDF export runs additional font and image checks.</p><ul>{validations.filter(v=>v.level !== "ok" && v.level !== "info").map((v,i)=><li key={i}>{v.message}</li>)}</ul><button disabled={publishing} onClick={() => setShowPublishReview(false)}>Keep editing</button><button className="primary-button" disabled={publishing} onClick={async () => { setPublishing(true); await publishMasterTemplate(); setPublishing(false); setShowPublishReview(false); }}>{publishing ? "Publishing…" : "Confirm Publish"}</button></ReviewDialog>}
      {showNarratives && reportInstance && <ReviewDialog title="Report Narratives" onClose={() => { if(narrativeDirty) { setOpenError("Save the narrative edit before returning to the report."); return; } setShowNarratives(false); }} wide><p>{template.name}</p><NarrativeWorkspace instance={reportInstance} onChange={handleReportInstanceChange} onDirtyChange={setNarrativeDirty} /><p role="status">{narrativeDirty ? "Unsaved narrative changes · choose Save Edit before returning" : "Narrative edits saved"}</p><button disabled={narrativeDirty} onClick={() => setShowNarratives(false)}>Return to report</button></ReviewDialog>}
      {toast && <div className="toast" role="status">{toast}</div>}
      {showWizard && (activeTemplateRecord ?? publishedTemplate) && (
        <CreateReportWizard
          onClose={() => setShowWizard(false)}
          onPrepare={handleGenerate}
          onReportChange={handleReportInstanceChange}
          onComplete={() => {
            setShowWizard(false);
            notify("Editable report opened");
          }}
          generationTemplate={(activeTemplateRecord ?? publishedTemplate)!}
        />
      )}
      {draftToDelete && (
        <div
          className="wizard-backdrop"
          role="presentation"
          onMouseDown={() => !deletingDraft && setDraftToDelete(undefined)}
        >
          <section
            className="confirmation-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={`Delete draft v${draftToDelete.version}`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <span className="destructive-icon" aria-hidden="true">
              !
            </span>
            <div>
              <h2>Delete draft v{draftToDelete.version}?</h2>
              <p>
                This permanently removes this unpublished template draft.
                Published templates, shared managed assets, and previously
                generated reports will not be affected.
              </p>
              {activeTemplateRecord?.id === draftToDelete.id &&
                activeTemplateRecord.version === draftToDelete.version && (
                  <p className="current-draft-warning">
                    This draft is currently open. The editor will safely open
                    another retained version after deletion.
                  </p>
                )}
            </div>
            <footer>
              <button
                disabled={deletingDraft}
                onClick={() => setDraftToDelete(undefined)}
              >
                Cancel
              </button>
              <button
                className="confirm-delete-draft"
                disabled={deletingDraft}
                onClick={confirmDeleteDraft}
              >
                {deletingDraft ? "Deleting…" : "Delete Draft"}
              </button>
            </footer>
          </section>
        </div>
      )}
      {pendingPdfExport && (
        <div className="wizard-backdrop" role="presentation">
          <section
            className="confirmation-dialog export-warning-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Export PDF with QA warnings"
          >
            <span className="warning-icon" aria-hidden="true">
              ⚠
            </span>
            <div>
              <h2>Export with QA warnings?</h2>
              <p>
                This report has {pendingPdfExport.warningCount} QA warning
                {pendingPdfExport.warningCount === 1 ? "" : "s"}. You can review
                them or export anyway.
              </p>
            </div>
            <footer>
              <button
                onClick={() => {
                  setPendingPdfExport(undefined);
                  setLeftTab("validate");
                }}
              >
                Review warnings
              </button>
              <button
                className="primary-button export-anyway-button"
                onClick={() => {
                  const pending = pendingPdfExport;
                  setPendingPdfExport(undefined);
                  void performPdfExport(
                    pending.template,
                    pending.warningCount,
                    pending.data,
                  );
                }}
              >
                Export anyway
              </button>
            </footer>
          </section>
        </div>
      )}
      {reconciliationRecord?.reconciliation && (
        <ReconciliationDrilldown
          record={reconciliationRecord}
          onClose={() => setReconciliationPath(undefined)}
        />
      )}
    </div>
  );
}

function PanelTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="panel-heading">
      <div>
        <strong>{title}</strong>
        {subtitle && <span>{subtitle}</span>}
      </div>
    </div>
  );
}
