import { useEffect, useRef } from "react";
import * as monaco from "monaco-editor";

// Dispose the view before its models; Monaco 0.56 rejects the reverse order.
export function DiffView({
  original,
  modified,
  language,
}: {
  original: string;
  modified: string;
  language: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!host.current) return;
    const before = monaco.editor.createModel(original, language);
    const after = monaco.editor.createModel(modified, language);
    const editor = monaco.editor.createDiffEditor(host.current, {
      theme: "vs-dark",
      readOnly: true,
      renderSideBySide: window.innerWidth > 900,
      automaticLayout: true,
      minimap: { enabled: false },
    });
    editor.setModel({ original: before, modified: after });
    return () => {
      editor.setModel(null);
      editor.dispose();
      before.dispose();
      after.dispose();
    };
  }, [original, modified, language]);
  return <div ref={host} style={{ height: 450 }} aria-label="File diff" />;
}
