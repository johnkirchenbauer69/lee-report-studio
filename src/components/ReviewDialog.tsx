import { useEffect, useRef, type ReactNode } from "react";
export function ReviewDialog({ title, onClose, children, wide = false }: {title:string;onClose:()=>void;children:ReactNode;wide?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement;
    ref.current?.focus();
    return ()=>previous?.focus();
  },[]);
  return <div className="review-backdrop" onMouseDown={e=>e.stopPropagation()}><div ref={ref} tabIndex={-1} className={`review-dialog ${wide?'wide':''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={e=>{
    if(e.key==='Escape'){e.stopPropagation();onClose();}
    if(e.key==='Tab'){
      const controls=[...e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.offsetParent!==null);
      const first=controls[0],last=controls.at(-1);
      if(e.shiftKey && (document.activeElement===first || document.activeElement===ref.current)){e.preventDefault();last?.focus();}
      else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
    }
  }}><header><h2>{title}</h2><button aria-label={`Close ${title}`} onClick={onClose}>×</button></header>{children}</div></div>;
}
