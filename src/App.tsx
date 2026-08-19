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
} from "./types/report";
import type { SnapGuide } from "./engine/editorMath";
import {
  distribute,
  formatUnit,
  PX_PER_INCH,
  scaleGroupedElements,
} from "./engine/editorMath";
import { CanvasElement } from "./components/CanvasElement";
import { Inspector } from "./components/Inspector";
import { DataBrowser } from "./components/DataBrowser";
import { ValidationPanel } from "./components/ValidationPanel";
import { CreateReportWizard } from "./components/CreateReportWizard";
import { validatePage } from "./engine/validation";
import { localPersistence } from "./services/persistence";
import { assetStorage } from "./services/assetStorage";
import { exportReportPdf } from "./services/pdfExport";
import { exportChromiumPdf } from "./renderers/pdf/ChromiumPdfClient";
import {
  runExportPreflight,
  type ExportPreflightIssue,
} from "./report-engine/validation/exportPreflight";
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
  return {
    ...clone(input),
    assets: input.assets ?? [],
    settings: { ...defaultSettings, ...input.settings },
    pages: input.pages.map((page) => ({
      ...page,
      elements: page.elements.map((element) => ({
        ...element,
        style: { ...element.style },
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
  | "data"
  | "pages"
  | "validate";
type ContextMenuState = { x: number; y: number; id: string } | undefined;

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
  const [draggedPageId, setDraggedPageId] = useState<string>();
  const [exportingPdf, setExportingPdf] = useState(false);
  const [showWizard, setShowWizard] = useState(false);
  const [reportData, setReportData] = useState(() => sampleData);
  const [normalizedReport, setNormalizedReport] =
    useState<IndustrialMarketReport>(() => q2SampleReport);
  const [reportInstance, setReportInstance] = useState<ReportInstance>();
  const [generationProgress, setGenerationProgress] =
    useState<GenerationProgress>();
  const [preflightIssues, setPreflightIssues] = useState<
    ExportPreflightIssue[]
  >([]);
  const interactionStart = useRef<ReportTemplate | undefined>(undefined);
  const clipboard = useRef<ReportElement[]>([]);
  const uploadRef = useRef<HTMLInputElement>(null);

  const page =
    template.pages.find((item) => item.id === pageId) ?? template.pages[0];
  const selectedElements = page.elements.filter((element) =>
    selectedIds.includes(element.id),
  );
  const selected = selectedElements[0];
  const settings = { ...defaultSettings, ...template.settings };
  const validations = useMemo(
    () => [
      ...(reportInstance?.readiness.issues.map((issue) => ({
        level: issue.level,
        category: "data" as const,
        message: issue.message,
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
      setTemplate((current) => {
        if (record) {
          setPast((items) => [...items.slice(-49), clone(current)]);
          setFuture([]);
        }
        const next = updater(current);
        latestTemplate.current = next;
        return next;
      });
    },
    [],
  );
  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 1800);
  };
  useEffect(() => {
    latestTemplate.current = template;
    const timer = window.setTimeout(() => localPersistence.save(template), 250);
    return () => window.clearTimeout(timer);
  }, [template]);
  useEffect(() => {
    (template.assets ?? [])
      .filter((asset) => asset.type === "font" && asset.fontFamily)
      .forEach(async (asset) => {
        try {
          const face = new FontFace(asset.fontFamily!, `url(${asset.source})`);
          await face.load();
          document.fonts.add(face);
        } catch (error) {
          console.warn("A saved font could not be restored.", error);
        }
      });
  }, []);
  useEffect(() => {
    assetStorage
      .list()
      .then((serverAssets) => {
        if (!serverAssets.length) return;
        mutate((current) => {
          const browserAssets = (current.assets ?? []).filter(
            (asset) => asset.storage !== "backend",
          );
          return { ...current, assets: [...browserAssets, ...serverAssets] };
        }, false);
      })
      .catch(() => undefined);
  }, [mutate]);

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
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setFuture((next) => [
        clone(latestTemplate.current),
        ...next.slice(0, 49),
      ]);
      latestTemplate.current = clone(previous);
      setTemplate(clone(previous));
      return items.slice(0, -1);
    });
  }, []);
  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setPast((previous) => [
        ...previous.slice(-49),
        clone(latestTemplate.current),
      ]);
      latestTemplate.current = clone(next);
      setTemplate(clone(next));
      return items.slice(1);
    });
  }, []);

  const select = (id: string, additive: boolean) => {
    if (croppingId && croppingId !== id) setCroppingId(undefined);
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
          fontFamily: "Inter",
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
      const minX =
          chosen.length === 1 ? 0 : Math.min(...chosen.map((e) => e.x)),
        maxX =
          chosen.length === 1
            ? page.width
            : Math.max(...chosen.map((e) => e.x + e.width));
      const minY =
          chosen.length === 1 ? 0 : Math.min(...chosen.map((e) => e.y)),
        maxY =
          chosen.length === 1
            ? page.height
            : Math.max(...chosen.map((e) => e.y + e.height));
      return {
        ...current,
        elements: current.elements.map((element) => {
          if (!selectedIds.includes(element.id)) return element;
          if (value === "left") return { ...element, x: minX };
          if (value === "right") return { ...element, x: maxX - element.width };
          if (value === "center")
            return { ...element, x: (minX + maxX - element.width) / 2 };
          if (value === "top") return { ...element, y: minY };
          if (value === "bottom")
            return { ...element, y: maxY - element.height };
          return { ...element, y: (minY + maxY - element.height) / 2 };
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
  const downloadPdf = async () => {
    if (reportInstance && !reportInstance.readiness.canExportDraft) {
      setLeftTab("validate");
      notify("Draft export is blocked by report validation errors.");
      return;
    }
    setExportingPdf(true);
    try {
      const issues = await runExportPreflight(template);
      setPreflightIssues(issues);
      const errors = issues.filter((issue) => issue.level === "error");
      if (errors.length)
        throw new Error(errors.map((issue) => issue.message).join("\n"));
      const fileName = `${template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`;
      try {
        await exportChromiumPdf(template, reportData, fileName);
      } catch (chromiumError) {
        console.warn(
          "Chromium renderer unavailable; using deterministic fallback.",
          chromiumError,
        );
        await exportReportPdf(template, reportData, fileName);
      }
      notify(
        `${template.pages.filter((item) => !item.hidden).length}-page PDF exported${issues.length ? ` · ${issues.length} preflight warning${issues.length === 1 ? "" : "s"}` : ""}`,
      );
    } catch (error) {
      console.error(error);
      notify("The PDF could not be generated.");
    } finally {
      setExportingPdf(false);
    }
  };
  const handleGenerate = async (request: ReportGenerationRequest) => {
    const instance = await generateReportInstance(
      sampleTemplate,
      request,
      setGenerationProgress,
    );
    const next = hydrate({
      ...sampleTemplate,
      name: `${request.period} ${request.market} Industrial Market Report`,
      pages: instance.pages,
    });
    setTemplate(next);
    latestTemplate.current = next;
    setReportData(buildPresentationModel(instance.dataSnapshot));
    setNormalizedReport(instance.dataSnapshot);
    setReportInstance(instance);
    setPageId(next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    setMode("data");
    setShowWizard(false);
    notify("Editable report generated");
  };
  const reset = () => {
    const next = hydrate(sampleTemplate);
    localPersistence.clear();
    setTemplate(next);
    latestTemplate.current = next;
    setReportData(sampleData);
    setNormalizedReport(q2SampleReport);
    setReportInstance(undefined);
    setPageId(next.pages[1]?.id ?? next.pages[0].id);
    setSelectedIds([]);
    setPast([]);
    setFuture([]);
    notify("Demo restored");
  };
  const handleFiles = async (files: FileList | null) => {
    if (!files) return;
    try {
      notify("Uploading assets…");
      const assets = await assetStorage.upload(Array.from(files));
      for (const asset of assets) {
        if (asset.type === "font" && asset.fontFamily) {
          try {
            const face = new FontFace(asset.fontFamily, `url(${asset.source})`);
            await face.load();
            document.fonts.add(face);
          } catch (error) {
            console.warn("This font could not be loaded.", error);
          }
        }
      }
      mutate((current) => ({
        ...current,
        assets: [...(current.assets ?? []), ...assets],
      }));
      notify(
        `${assets.length} asset${assets.length === 1 ? "" : "s"} stored ${assets.every((asset) => asset.storage === "backend") ? "on the server" : "in this browser"}`,
      );
    } catch (error) {
      console.error(error);
      notify("These files could not be uploaded.");
    } finally {
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (
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
            <small>PNG, JPG, WebP, SVG, WOFF, TTF or OTF</small>
          </button>
          <input
            hidden
            multiple
            ref={uploadRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,.woff,.woff2,.ttf,.otf"
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
    if (leftTab === "data") return <DataBrowser onBind={bind} />;
    if (leftTab === "pages" || leftTab === "templates")
      return (
        <>
          <PanelTitle
            title="Pages"
            subtitle={`${template.pages.length} pages · Drag to reorder`}
          />
          <button
            className="create-report-button"
            onClick={() => setShowWizard(true)}
          >
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
            <strong contentEditable suppressContentEditableWarning>
              {template.name}
            </strong>
            <span>Report Studio · Autosaved</span>
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
          onClick={() => setShowWizard(true)}
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
        <main className="stage" onClick={() => setSelectedIds([])}>
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
          fontFamilies={(template.assets ?? [])
            .filter((asset) => asset.type === "font" && asset.fontFamily)
            .map((asset) => asset.fontFamily!)}
          cropping={croppingId === selected?.id}
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
          Saved locally
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
      {showWizard && (
        <CreateReportWizard
          onClose={() => setShowWizard(false)}
          onGenerate={handleGenerate}
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
      <button aria-label={`${title} options`}>•••</button>
    </div>
  );
}
