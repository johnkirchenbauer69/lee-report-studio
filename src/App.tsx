import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "./engine/editorMath";
import { CanvasElement } from "./components/CanvasElement";
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
import { prepareTemplateForPublication } from "./report-engine/generation/prepareTemplate";
import {
  generateReportInstance,
  type GenerationProgress,
} from "./report-engine/generation/generateReport";
import { buildPresentationModel } from "./report-engine/bindings/presentationModel";
import { q2SampleReport } from "./data-providers/sample/q2SampleReport";
import type {
  ReportGenerationRequest,
  ReportInstance,
} from "./report-engine/schema/generation";
import type { IndustrialMarketReport } from "./report-engine/schema/industrialMarketReport";
import { getByContextPath } from "./engine/bindings";
import {
  elementRect,
  getRotatedAabb,
  normalizeRotation,
} from "./engine/geometry";
import {
  fontFamilyToCss,
  groupFontAssets,
  installManagedFonts,
  type ManagedFontFaceDiagnostic,
} from "./services/fontRegistry";
import { normalizeReportTemplateFonts } from "./services/templateNormalization";
import { templateStore } from "./services/templateStore";
import type {
  StoredTemplateVersion,
  TemplateVersionSummary,
} from "./types/templateLibrary";
import "./styles/app.css";
import "./styles/advanced.css";

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
      elements: page.elements.map((element) => ({
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
      })),
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
type EditorDocumentMode = "master-template" | "report-instance";

export default function App() {
  const [template, setTemplate] = useState<ReportTemplate>(() => {
    const saved = localPersistence.load();
    return hydrate(
      saved?.version === sampleTemplate.version ? saved : sampleTemplate,
    );
  });
  const latestTemplate = useRef(template);
  const [pageId, setPageId] = useState(
    () => template.pages[1]?.id ?? template.pages[0].id,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [mode, setMode] = useState<PreviewMode>("design");
  const [zoom, setZoom] = useState(0.72);
  const [leftTab, setLeftTab] = useState<LeftTab>("elements");
  const [guides, setGuides] = useState<SnapGuide[]>([]);
  const [past, setPast] = useState<ReportTemplate[]>([]);
  const [future, setFuture] = useState<ReportTemplate[]>([]);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>();
  const [toast, setToast] = useState("");
  const [croppingId, setCroppingId] = useState<string>();
  const [tableEditingId, setTableEditingId] = useState<string>();
  const [tableSelection, setTableSelection] = useState<TableSelection>();
  const [draggedPageId, setDraggedPageId] = useState<string>();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [reportData, setReportData] = useState(() => sampleData);
  const [normalizedReport, setNormalizedReport] =
    useState<IndustrialMarketReport>(() => q2SampleReport);
  const [reportInstance, setReportInstance] = useState<ReportInstance>();
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
    "loading" | "saved" | "local" | "error"
  >("loading");
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
  const interactionStart = useRef<ReportTemplate | undefined>(undefined);
  const clipboard = useRef<ReportElement[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);
  const managedServerAssets = useRef<Asset[]>([]);

  const page =
    template.pages.find((item) => item.id === pageId) ?? template.pages[0];
  const selectedElements = page.elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const selected = selectedElements[0];
  const reconciliationRecord = normalizedReport.provenance.find(
    (record) => record.fieldPath === reconciliationPath,
  );
  const settings = { ...defaultSettings, ...template.settings };
  const validations = useMemo(
    () => [
      ...(reportInstance?.readiness.issues.map((issue) => ({
        level: issue.level,
        category: "data" as const,
        message: issue.message,
        path: issue.path,
      })) ?? []),
      ...validatePage(page, reportData),
      ...preflightIssues
        .filter((issue) => issue.pageId === page.id)
        .map((issue) => ({
          level: issue.level,
          category: "export" as const,
          message: issue.message,
          elementId: issue.elementId,
        })),
    ],
    [page, reportData, preflightIssues, reportInstance],
  );

  const mutate = useCallback(
    (updater: (current: ReportTemplate) => ReportTemplate, record = true) => {
      if (
        record &&
        documentMode === "master-template" &&
        activeTemplateRecord &&
        activeTemplateRecord.status !== "draft"
      ) {
        setToast(
          "Published templates are read-only. Create a draft version to edit.",
        );
        window.setTimeout(() => setToast(""), 1800);
        return;
      }
      setTemplate((current) => {
        if (record) {
          setPast((items) => [...items.slice(-49), clone(current)]);
          setFuture([]);
          setLibrarySaveState("local");
        }
        const next = updater(current);
        latestTemplate.current = next;
        return next;
      });
    },
    [activeTemplateRecord, documentMode],
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
  const openTemplateRecord = useCallback((record: StoredTemplateVersion) => {
    const browserAssets = (record.template.assets ?? []).filter(
      (asset) => asset.storage !== "backend",
    );
    const assets = [...browserAssets, ...managedServerAssets.current];
    const next = hydrate(
      normalizeReportTemplateFonts({ ...record.template, assets }, assets),
    );
    setActiveTemplateRecord(record);
    setTemplate(next);
    latestTemplate.current = next;
    setDocumentMode("master-template");
    setReportInstance(undefined);
    setReportData(sampleData);
    setNormalizedReport(q2SampleReport);
    setPageId(next.pages[1]?.id ?? next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    setLibrarySaveState("saved");
  }, []);
  useEffect(() => {
    latestTemplate.current = template;
    const timer = window.setTimeout(() => localPersistence.save(template), 250);
    return () => window.clearTimeout(timer);
  }, [template]);
  useEffect(() => {
    installManagedFonts(template.assets ?? [])
      .then(setFontDiagnostics)
      .catch((error) => {
        setFontDiagnostics([]);
        console.warn("Saved managed fonts could not be restored.", error);
      });
  }, [template.assets]);
  useEffect(() => {
    Promise.all([
      refreshTemplateLibrary(),
      assetStorage.list().catch(() => [] as Asset[]),
    ])
      .then(async ([records, serverAssets]) => {
        managedServerAssets.current = serverAssets;
        const preferred =
          records.find((record) => record.status === "draft") ?? records[0];
        if (!preferred) return;
        openTemplateRecord(
          await templateStore.get(preferred.id, preferred.version),
        );
      })
      .catch((error) => {
        setLibrarySaveState("local");
        console.warn(
          "Template library unavailable; local recovery remains active.",
          error,
        );
      });
  }, [openTemplateRecord, refreshTemplateLibrary]);

  const updatePage = useCallback(
    (updater: (current: ReportPage) => ReportPage, record = true) =>
      mutate(
        (current) => ({
          ...current,
          pages: current.pages.map((item) =>
            item.id === page.id ? updater(item) : item,
          ),
        }),
        record,
      ),
    [mutate, page.id],
  );
  const updateElement = useCallback(
    (id: string, patch: Partial<ReportElement>, record = false) =>
      updatePage((current) => {
        const source = current.elements.find((element) => element.id === id),
          dx = source && patch.x != null ? patch.x - source.x : 0,
          dy = source && patch.y != null ? patch.y - source.y : 0;
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
              return { ...element, ...patch } as ReportElement;
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
    [updatePage],
  );
  const updateSelected = (patch: Partial<ReportElement>) => {
    if (
      Object.prototype.hasOwnProperty.call(patch, "text") &&
      selected?.binding &&
      reportInstance
    ) {
      const generatedValue = getByContextPath(
        reportData,
        selected.binding.path,
        selected.bindingContext,
      );
      setReportInstance((instance) =>
        instance
          ? {
              ...instance,
              manualOverrides: [
                ...instance.manualOverrides,
                {
                  elementId: selected.id,
                  bindingPath: selected.binding?.path,
                  generatedValue,
                  overrideValue: (patch as { text?: string }).text,
                  createdAt: new Date().toISOString(),
                },
              ],
            }
          : instance,
      );
    }
    updatePage((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id)
          ? ({
              ...element,
              ...patch,
              style: patch.style
                ? { ...element.style, ...patch.style }
                : element.style,
            } as ReportElement)
          : element,
      ),
    }));
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
      interactionStart.current = clone(latestTemplate.current);
  };
  const endInteraction = () => {
    const start = interactionStart.current;
    interactionStart.current = undefined;
    if (
      start &&
      JSON.stringify(start) !== JSON.stringify(latestTemplate.current)
    ) {
      setPast((items) => [...items.slice(-49), start]);
      setFuture([]);
    }
  };
  const undo = useCallback(() => {
    const previous = past.at(-1);
    if (!previous) return;
    setFuture([clone(latestTemplate.current), ...future.slice(0, 49)]);
    setPast(past.slice(0, -1));
    latestTemplate.current = clone(previous);
    setTemplate(clone(previous));
  }, [future, past]);
  const redo = useCallback(() => {
    const next = future[0];
    if (!next) return;
    setPast([...past.slice(-49), clone(latestTemplate.current)]);
    setFuture(future.slice(1));
    latestTemplate.current = clone(next);
    setTemplate(clone(next));
  }, [future, past]);

  const select = (id: string, additive: boolean) => {
    if (croppingId && croppingId !== id) setCroppingId(undefined);
    if (tableEditingId && tableEditingId !== id) {
      setTableEditingId(undefined);
      setTableSelection(undefined);
    }
    setSelectedIds((current) =>
      additive
        ? current.includes(id)
          ? current.filter((item) => item !== id)
          : [...current, id]
        : [id],
    );
  };
  const addText = (variant: "heading" | "subheading" | "body" = "body") => {
    const id = uid("text"),
      sizes = { heading: 32, subheading: 22, body: 14 };
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
          fontWeight:
            variant === "heading" ? 700 : variant === "subheading" ? 600 : 400,
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
        opacity: 1,
      },
    };
    updatePage((current) => ({
      ...current,
      elements: [...current.elements, element],
    }));
    setSelectedIds([id]);
  };
  const addImageAsset = (asset: Asset) => {
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
        style: { opacity: 1, borderRadius: 8 },
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
    const groupId = uid("group");
    updatePage((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id) ? { ...element, groupId } : element,
      ),
    }));
    notify("Elements grouped");
  };
  const ungroup = () =>
    updatePage((current) => ({
      ...current,
      elements: current.elements.map((element) =>
        selectedIds.includes(element.id)
          ? { ...element, groupId: undefined }
          : element,
      ),
    }));

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
    try {
      const normalized = normalizeReportTemplateFonts(
        latestTemplate.current,
        latestTemplate.current.assets ?? [],
      );
      const saved = await templateStore.saveDraft(
        activeTemplateRecord,
        normalized,
      );
      openTemplateRecord(saved);
      await refreshTemplateLibrary();
      setLibrarySaveState("saved");
      notify(`Template v${saved.version} saved to library`);
    } catch (error) {
      setLibrarySaveState("error");
      notify(error instanceof Error ? error.message : "Template save failed");
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
      openTemplateRecord(created);
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
      openTemplateRecord(published);
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
    if (!publishedTemplate) {
      setLeftTab("templates");
      notify("Publish a master template before generating a report.");
      return;
    }
    setShowWizard(true);
  };
  const downloadPdf = async () => {
    if (reportInstance && !reportInstance.readiness.canPublish) {
      setLeftTab("validate");
      notify("Published export is blocked by report readiness issues.");
      return;
    }
    setExportingPdf(true);
    try {
      const publicationTemplate = prepareTemplateForPublication(template);
      const issues = await runExportPreflight(publicationTemplate);
      setPreflightIssues(issues);
      const errors = issues.filter((issue) => issue.level === "error");
      if (errors.length) {
        const failure = classifyExportError(
          "preflight",
          new Error(errors.map((issue) => issue.message).join(" ")),
        );
        console.error("PDF export blocked by preflight errors.", failure);
        notify(describeExportFailure(failure));
        return;
      }
      const fileName = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      let chromiumFailure: ReturnType<typeof classifyExportError> | undefined;
      try {
        await exportChromiumPdf(publicationTemplate, reportData, fileName);
      } catch (chromiumError) {
        chromiumFailure = classifyExportError("chromium", chromiumError);
        console.warn(
          "Chromium renderer unavailable; using deterministic fallback.",
          chromiumFailure,
        );
        try {
          await exportReportPdf(publicationTemplate, reportData, fileName);
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
        `${template.pages.filter((item) => !item.hidden).length}-page PDF exported${issues.length ? ` · ${issues.length} preflight warning${issues.length === 1 ? "" : "s"}` : ""}`,
      );
    } catch (error) {
      console.error("PDF export failed unexpectedly.", error);
      notify("The PDF could not be generated.");
    } finally {
      setExportingPdf(false);
    }
  };
  const handleGenerate = async (request: ReportGenerationRequest) => {
    const sourceTemplate = await templateStore.get(
      request.templateId,
      request.templateVersion,
    );
    if (sourceTemplate.status !== "published")
      throw new Error(
        "Report generation requires a published template version.",
      );
    const instance = await generateReportInstance(
      sourceTemplate.template,
      request,
      setGenerationProgress,
    );
    const next = hydrate({
      ...sourceTemplate.template,
      name: `${request.period} ${request.market} Industrial Market Report`,
      pages: instance.pages,
    });
    setTemplate(next);
    latestTemplate.current = next;
    setReportData(buildPresentationModel(instance.dataSnapshot));
    setNormalizedReport(instance.dataSnapshot);
    setReportInstance(instance);
    setDocumentMode("report-instance");
    setPageId(next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    setMode("data");
    setShowWizard(false);
    notify("Editable report generated");
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
    setTemplate(next);
    latestTemplate.current = next;
    setReportData(sampleData);
    setNormalizedReport(q2SampleReport);
    setReportInstance(undefined);
    setDocumentMode("master-template");
    setPageId(next.pages[1]?.id ?? next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    notify(activeTemplateRecord ? "Saved master restored" : "Demo restored");
  };
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    if (
      documentMode === "master-template" &&
      activeTemplateRecord?.status !== "draft"
    ) {
      notify("Create a draft version before changing managed assets.");
      return;
    }
    try {
      notify("Uploading assets…");
      const { assets, summary } = await assetStorage.upload(Array.from(files));
      const allAssets = [...(latestTemplate.current.assets ?? []), ...assets];
      managedServerAssets.current = allAssets.filter(
        (asset) => asset.storage === "backend",
      );
      setFontDiagnostics(await installManagedFonts(allAssets));
      mutate((current) =>
        normalizeReportTemplateFonts(
          { ...current, assets: allAssets },
          allAssets,
        ),
      );
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
    if (
      documentMode === "master-template" &&
      activeTemplateRecord?.status !== "draft"
    ) {
      notify("Create a draft version before changing managed assets.");
      return;
    }
    await assetStorage.remove(asset.id);
    managedServerAssets.current = managedServerAssets.current.filter(
      (item) => item.id !== asset.id,
    );
    mutate((current) => ({
      ...current,
      assets: (current.assets ?? []).filter((item) => item.id !== asset.id),
    }));
    notify(`${asset.name} removed`);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (event.key === "Escape" && tableEditingId) {
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
    deleteSelected,
    duplicateSelected,
    paste,
    redo,
    selectedIds,
    tableEditingId,
    undo,
    updatePage,
  ]);

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
                <em>{element.name}</em>
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
      const fontAssets = (template.assets ?? []).filter(
        (asset) => asset.type === "font" && asset.fontFamily,
      );
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
                    <span>Managed · checksum verified</span>
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
            title={leftTab === "uploads" ? "Uploads" : "Images"}
            subtitle="Images, logos & fonts"
          />
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
                <button key={asset.id} onClick={() => addImageAsset(asset)}>
                  <img src={asset.source} alt="" />
                  <span>{asset.name}</span>
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
    if (leftTab === "pages" || leftTab === "templates")
      return (
        <>
          {leftTab === "templates" && (
            <>
              <PanelTitle
                title="Template Library"
                subtitle="Durable server-side master versions"
              />
              <div className="master-mode-card">
                <strong>
                  {documentMode === "master-template"
                    ? "MASTER TEMPLATE MODE"
                    : "REPORT INSTANCE MODE"}
                </strong>
                <span>
                  {activeTemplateRecord
                    ? `${activeTemplateRecord.name} · v${activeTemplateRecord.version} · ${activeTemplateRecord.status}`
                    : "Loading template library…"}
                </span>
                <small>
                  {documentMode === "master-template"
                    ? "Published changes affect future reports only."
                    : "Edits are isolated to this generated report."}
                </small>
              </div>
              <div className="template-version-list">
                {templateLibrary.map((record) => (
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
                      <strong>{record.name}</strong>
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
              <div className="panel-actions template-actions">
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
                  onClick={publishMasterTemplate}
                >
                  Publish Template
                </button>
              </div>
            </>
          )}
          <PanelTitle
            title="Pages"
            subtitle={`${template.pages.length} page definitions · expands to 44 pages for the full Chicago scope`}
          />
          <button className="create-report-button" onClick={startCreateReport}>
            ＋ Create report from data
          </button>
          <div className="page-list">
            {template.pages.map((item, index) => (
              <button
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
                <span>{item.name}</span>
              </button>
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
        onSelect={(id) => {
          setSelectedIds([id]);
          setLeftTab("elements");
        }}
        onViewReconciliation={setReconciliationPath}
      />
    );
  };

  return (
    <div className="app-shell" onClick={() => setContextMenu(undefined)}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">
            <span>LEE</span>
          </div>
          <div>
            <strong>{template.name}</strong>
            <span>
              {documentMode === "master-template"
                ? `Master Template · v${activeTemplateRecord?.version ?? template.version} · ${activeTemplateRecord?.status ?? "local recovery"}`
                : `Report Instance · pinned to v${reportInstance?.templateVersion ?? template.version}`}
            </span>
          </div>
        </div>
        <div className="toolbar-group">
          <button
            className="icon-button"
            disabled={!past.length}
            title="Undo · Ctrl+Z"
            onClick={undo}
          >
            ↶
          </button>
          <button
            className="icon-button"
            disabled={!future.length}
            title="Redo · Ctrl+Shift+Z"
            onClick={redo}
          >
            ↷
          </button>
        </div>
        <div className="toolbar-group zoom-control">
          <button
            title="Zoom out"
            onClick={() => setZoom(Math.max(0.25, zoom - 0.1))}
          >
            −
          </button>
          <select
            aria-label="Zoom"
            value={Math.round(zoom * 100)}
            onChange={(e) => setZoom(Number(e.target.value) / 100)}
          >
            {[25, 50, 75, 100, 125, 150].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </select>
          <button
            title="Zoom in"
            onClick={() => setZoom(Math.min(1.5, zoom + 0.1))}
          >
            +
          </button>
          <button onClick={() => setZoom(0.72)}>Fit</button>
        </div>
        <div className="toolbar-group segmented compact">
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
        <div className="toolbar-spacer" />
        <button
          className="toolbar-button create-report-top"
          onClick={startCreateReport}
        >
          ＋ Create report
        </button>
        {documentMode === "master-template" && (
          <div className="toolbar-group template-save-actions">
            <button
              disabled={activeTemplateRecord?.status !== "draft"}
              onClick={saveMasterTemplate}
            >
              Save
            </button>
            <button
              disabled={!activeTemplateRecord}
              onClick={() => saveAsNewTemplateVersion()}
            >
              Save as version
            </button>
            <button
              disabled={activeTemplateRecord?.status !== "draft"}
              onClick={publishMasterTemplate}
            >
              Publish
            </button>
          </div>
        )}
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
        <button className="toolbar-button" onClick={downloadTemplate}>
          JSON
        </button>
        <button
          className="primary-button"
          disabled={exportingPdf}
          onClick={downloadPdf}
        >
          {exportingPdf ? "Rendering…" : "Export PDF"}
        </button>
      </header>
      <div className="workspace">
        <nav className="rail">
          {(
            [
              ["templates", "▤", "Templates"],
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
              onClick={() => setLeftTab(tab)}
              title={label}
            >
              <span>{icon}</span>
              {label}
            </button>
          ))}
        </nav>
        <aside className="left-panel">
          {sidebar()}
          <button className="reset-link" onClick={reset}>
            Restore sample document
          </button>
        </aside>
        <main
          className="stage"
          onClick={(event) => {
            if ((event.target as HTMLElement).closest(".canvas-element"))
              return;
            setSelectedIds([]);
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
                  mode={mode}
                  selected={selectedIds.includes(element.id)}
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
                  zoom={zoom}
                  onSelect={select}
                  onChange={updateElement}
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
        <Inspector
          element={selected}
          unit={settings.unit}
          selectionCount={selectedIds.length}
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
          onChange={updateSelected}
          onAlign={align}
          onDistribute={distributeSelection}
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
          {reportInstance
            ? `${reportInstance.manualOverrides.length} manual overrides · `
            : ""}
          {librarySaveState === "saved" && documentMode === "master-template"
            ? "Saved to template library"
            : librarySaveState === "error"
              ? "Template library save failed"
              : "Saved locally for recovery"}
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
      {toast && <div className="toast">✓ {toast}</div>}
      {showWizard && publishedTemplate && (
        <CreateReportWizard
          onClose={() => setShowWizard(false)}
          onGenerate={handleGenerate}
          publishedTemplate={publishedTemplate}
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
