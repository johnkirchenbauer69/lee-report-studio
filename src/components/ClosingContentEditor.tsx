import { useEffect, useState } from "react";
import {
  closingContentSchema,
  validateClosingContent,
  type ClosingContent,
} from "../report-engine/closing/closingContent";

const defaults: Record<string, unknown> = {
  groups: { id: "", heading: "New section", items: [] },
  items: { id: "", term: "", description: "New content", kind: "bullet" },
  departments: { id: "", heading: "New department", columns: 4 },
  contacts: {
    id: "",
    name: "New contact",
    title: "",
    email: "",
    department: "",
    displayOrder: 0,
    isActive: true,
  },
  statistics: { id: "", value: "", label: "", description: "" },
  openings: { id: "", year: 2026, market: "", displayOrder: 0 },
  paragraphs: "New paragraph",
};
const label = (key: string) =>
  key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());

/** Structured form, using the Inspector's normal onChange and draft-save lifecycle. */
export function ClosingContentEditor({
  content,
  onChange,
}: {
  content: ClosingContent;
  onChange: (content: ClosingContent) => void;
}) {
  const [draft, setDraft] = useState(content);
  const [error, setError] = useState("");
  useEffect(() => {
    setDraft(content);
    setError("");
  }, [content]);
  const field = (
    value: unknown,
    key: string,
    change: (value: unknown) => void,
  ): React.ReactNode => {
    if (Array.isArray(value))
      return (
        <fieldset>
          <legend>{label(key)}</legend>
          {value.map((entry, index) => (
            <fieldset
              key={typeof entry === "object" && entry?.id ? entry.id : index}
            >
              <legend>
                {label(key)} {index + 1}
              </legend>
              {field(entry, key.slice(0, -1), (next) =>
                change(value.map((v, i) => (i === index ? next : v))),
              )}
              {key === "items" && draft.kind === "sections" && (
                <label>
                  Move to section
                  <select
                    value={
                      draft.groups.find((group) =>
                        group.items.some((item) => item.id === entry.id),
                      )?.id ?? ""
                    }
                    onChange={(event) => {
                      const target = event.target.value;
                      if (
                        draft.groups.find((group) =>
                          group.items.some((item) => item.id === entry.id),
                        )?.id === target
                      )
                        return;
                      setDraft({
                        ...draft,
                        groups: draft.groups.map((group) => ({
                          ...group,
                          items:
                            group.id === target
                              ? [...group.items, entry]
                              : group.items.filter(
                                  (item) => item.id !== entry.id,
                                ),
                        })),
                      });
                    }}
                  >
                    {draft.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.heading}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <div className="closing-record-actions">
                <button
                  type="button"
                  onClick={() => change(value.filter((_, i) => i !== index))}
                >
                  Remove
                </button>
                {[
                  [-1, "Move up"],
                  [1, "Move down"],
                ].map(([offset, text]) => (
                  <button
                    type="button"
                    key={text}
                    disabled={
                      index + Number(offset) < 0 ||
                      index + Number(offset) >= value.length
                    }
                    onClick={() => {
                      const next = [...value];
                      const target = index + Number(offset);
                      [next[index], next[target]] = [next[target], next[index]];
                      change(
                        next.map((v, i) =>
                          typeof v === "object" && v && "displayOrder" in v
                            ? { ...v, displayOrder: i }
                            : v,
                        ),
                      );
                    }}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => {
              const entry = structuredClone(defaults[key]);
              if (typeof entry === "object" && entry) {
                Object.assign(entry, { id: crypto.randomUUID() });
                if ("displayOrder" in entry)
                  Object.assign(entry, { displayOrder: value.length });
                if (key === "contacts" && draft.kind === "contacts")
                  Object.assign(entry, {
                    department: draft.departments[0]?.id ?? "",
                  });
              }
              change([...value, entry]);
            }}
          >
            Add {label(key)}
          </button>
        </fieldset>
      );
    if (value && typeof value === "object")
      return Object.entries(value)
        .filter(([k]) => !["id", "source", "kind", "variant"].includes(k))
        .map(([k, v]) => (
          <div key={k}>
            {field(v, k, (next) => change({ ...value, [k]: next }))}
          </div>
        ));
    if (key === "department" && draft.kind === "contacts")
      return (
        <label>
          {label(key)}
          <select
            value={String(value)}
            onChange={(e) => change(e.target.value)}
          >
            {draft.departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.heading}
              </option>
            ))}
          </select>
        </label>
      );
    if (typeof value === "boolean")
      return (
        <label>
          {label(key)}
          <input
            type="checkbox"
            checked={value}
            onChange={(e) => change(e.target.checked)}
          />
        </label>
      );
    if (typeof value === "number")
      return (
        <label>
          {label(key)}
          <input
            type="number"
            value={value}
            onChange={(e) => change(Number(e.target.value))}
          />
        </label>
      );
    return (
      <label>
        {label(key)}
        <textarea
          value={String(value ?? "")}
          onChange={(e) => change(e.target.value)}
        />
      </label>
    );
  };
  return (
    <div className="closing-editor">
      <p>{content.source}</p>
      <p>
        Apply changes, then Save Draft. Overflow blocks PDF export; shorten
        content or split it into an additional template page.
      </p>
      {field(draft, "content", (next) => setDraft(next as ClosingContent))}
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        onClick={() => {
          const parsed = closingContentSchema.safeParse(draft);
          const errors = parsed.success
            ? validateClosingContent(parsed.data)
            : parsed.error.issues.map(
                (issue) => `${issue.path.join(".")}: ${issue.message}`,
              );
          if (errors.length) {
            setError(errors.join(" "));
            return;
          }
          setError("");
          onChange(parsed.success ? parsed.data : draft);
        }}
      >
        Apply content changes
      </button>
    </div>
  );
}
