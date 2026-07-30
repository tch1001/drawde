import { useMemo } from 'react';
import { marked } from 'marked';
import katex from 'katex';
import DOMPurify from 'dompurify';
import 'katex/dist/katex.min.css';

/**
 * Renders model output: markdown + LaTeX.
 *
 * Security: this is untrusted text (the model is influenced by PDF content we
 * did not write), so it is sanitised with DOMPurify before it ever reaches
 * innerHTML. KaTeX runs BEFORE sanitising, on the raw source, so a `$...$` span
 * becomes ordinary markup that the sanitiser can vet like anything else — and
 * KaTeX itself runs in throwOnError:false mode so malformed math degrades to
 * visible red text instead of throwing mid-render.
 */

marked.setOptions({ gfm: true, breaks: true });

/** Swap $$...$$ and $...$ for rendered KaTeX before markdown sees them. */
function renderMath(src: string): string {
  const render = (tex: string, display: boolean) => {
    try {
      return katex.renderToString(tex, {
        displayMode: display,
        throwOnError: false,
        output: 'html',
      });
    } catch {
      return escapeHtml(display ? `$$${tex}$$` : `$${tex}$`);
    }
  };

  // display math first, so $$...$$ isn't eaten by the inline rule
  let out = src.replace(/\$\$([\s\S]+?)\$\$/g, (_, tex) => render(tex, true));
  // inline: skip escaped \$ and avoid spanning newlines (that's usually prose)
  out = out.replace(/(^|[^\\$])\$([^$\n]+?)\$/g, (_, pre, tex) => pre + render(tex, false));
  // \( ... \) and \[ ... \], which models emit at least as often as $
  out = out.replace(/\\\[([\s\S]+?)\\\]/g, (_, tex) => render(tex, true));
  out = out.replace(/\\\(([\s\S]+?)\\\)/g, (_, tex) => render(tex, false));
  return out;
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    const withMath = renderMath(text);
    const raw = marked.parse(withMath, { async: false }) as string;
    return DOMPurify.sanitize(raw, {
      // KaTeX emits MathML alongside HTML; allow it, but nothing scriptable.
      USE_PROFILES: { html: true, mathMl: true, svg: true },
      ADD_ATTR: ['aria-hidden'],
      FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'form', 'input'],
      FORBID_ATTR: ['onerror', 'onload', 'onclick', 'formaction', 'srcdoc'],
    });
  }, [text]);

  return <div className="dd-md" dangerouslySetInnerHTML={{ __html: html }} />;
}
