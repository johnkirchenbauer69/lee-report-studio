import { useLayoutEffect, useRef, useState } from "react";
import { ordered, type ClosingContent as Content } from "../report-engine/closing/closingContent";
import "../styles/closing-pages.css";

/** Native DOM text in both the template canvas and the existing Chromium renderer. */
export function ClosingContent({ content }: { content: Content }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setOverflow(node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    document.fonts.ready.then(measure);
    return () => observer.disconnect();
  }, [content]);
  return <div ref={ref} className={`closing-content closing-${content.kind} ${content.kind === "sections" ? `closing-${content.variant}` : ""}`} data-closing-overflow={overflow}>
    {content.kind === "sections" ? content.groups.map(group => <section key={group.id}>
      <h2>{group.heading}</h2>
      {group.items.map(item => <div key={item.id} className={`closing-item closing-${item.kind}`}>
        {item.term && <strong>{item.term}: </strong>}{item.description}
      </div>)}
    </section>) : content.kind === "contacts" ? <div className="closing-directory">
      {content.departments.map(department => <section key={department.id} style={{ gridColumn: `span ${department.columns}` }}>
        <h2>{department.heading}</h2>
        <div className="closing-contact-grid" style={{ gridTemplateColumns: `repeat(${department.columns}, minmax(0, 1fr))` }}>
          {ordered(content.contacts.filter(contact => contact.isActive && contact.department === department.id)).map(contact => <div className="closing-contact" key={contact.id}>
            <strong>{contact.name}</strong><div>{contact.title}</div>
            {contact.email && <a href={`mailto:${contact.email}`} onPointerDown={e => e.stopPropagation()}>{contact.email}</a>}
          </div>)}
        </div>
      </section>)}
    </div> : <>
      <img className="closing-corporate-logo" src={content.logoAsset} alt="Lee & Associates" />
      <img className="closing-office-map" src={content.mapAsset} alt="North American Lee & Associates offices from the supplied reference" />
      <div className="closing-company-copy">
        <h1>{content.heading}</h1><h2>{content.subheading}</h2>
        {content.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
        <p className="closing-company-emphasis">{content.emphasis}</p>
      </div>
      <div className="closing-statistics">{content.statistics.map(stat => <div key={stat.id}>
        <div className="closing-stat-value">{stat.value}</div><strong>{stat.label}</strong><div className="closing-stat-description">{stat.description}</div>
      </div>)}</div>
      <section className="closing-growth"><h2>{content.growthHeading}</h2><p>{content.growthCaption}</p>
        <div className="closing-timeline">{ordered(content.openings).map(opening => <div key={opening.id}>{opening.year} - {opening.market}</div>)}</div>
      </section>
    </>}
  </div>;
}
