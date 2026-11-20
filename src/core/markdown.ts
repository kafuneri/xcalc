function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderInline(escaped: string): string {
  const codeTokens: string[] = [];
  let out = escaped.replace(/`([^`]+)`/g, (_, code: string) => {
    const idx = codeTokens.length;
    codeTokens.push(`<code>${code}</code>`);
    return `\u0000CODE${idx}\u0000`;
  });

  // Bold (**text**) then italic (*text*)
  out = out.replace(/\*\*([^*]+?)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');

  out = out.replace(/\u0000CODE(\d+)\u0000/g, (_, idx) => codeTokens[Number(idx)] || '');
  return out;
}

/**
 * Render basic Markdown safely to HTML (escapes all raw HTML before formatting).
 */
export function renderSafeMarkdown(markdown: string): string {
  if (!markdown) return '';
  const lines = escapeHtml(markdown.replace(/\r\n/g, '\n')).split('\n');
  const html: string[] = [];
  const listStack: Array<{ tag: 'ul' | 'ol'; indent: number }> = [];

  const closeListsTo = (minIndent = -1) => {
    while (listStack.length > 0 && listStack[listStack.length - 1].indent > minIndent) {
      const top = listStack.pop()!;
      html.push(`</${top.tag}>`);
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      closeListsTo(-1);
      continue;
    }

    if (/^([-*_])\1{2,}$/.test(trimmed)) {
      closeListsTo(-1);
      html.push('<hr />');
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      closeListsTo(-1);
      const level = Math.min(4, Math.max(2, headingMatch[1].length));
      html.push(`<h${level}>${renderInline(headingMatch[2])}</h${level}>`);
      continue;
    }

    const quoteMatch = trimmed.match(/^&gt;\s?(.*)$/);
    if (quoteMatch) {
      closeListsTo(-1);
      html.push(`<blockquote>${renderInline(quoteMatch[1])}</blockquote>`);
      continue;
    }

    const ulMatch = line.match(/^(\s*)[*-]\s+(.+)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.+)$/);
    if (ulMatch || olMatch) {
      const indent = (ulMatch || olMatch)![1].length;
      const tag: 'ul' | 'ol' = ulMatch ? 'ul' : 'ol';
      const content = (ulMatch || olMatch)![2];

      while (
        listStack.length > 0 &&
        listStack[listStack.length - 1].indent > indent
      ) {
        html.push(`</${listStack.pop()!.tag}>`);
      }

      const top = listStack[listStack.length - 1];
      if (!top || top.indent < indent) {
        listStack.push({ tag, indent });
        html.push(`<${tag}>`);
      } else if (top.tag !== tag) {
        html.push(`</${listStack.pop()!.tag}>`);
        listStack.push({ tag, indent });
        html.push(`<${tag}>`);
      }

      html.push(`<li>${renderInline(content)}</li>`);
      continue;
    }

    closeListsTo(-1);

    // Group consecutive plain text lines into one paragraph
    const paraLines = [renderInline(trimmed)];
    while (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      const nextTrimmed = nextLine.trim();
      if (
        !nextTrimmed ||
        /^#{1,4}\s+/.test(nextTrimmed) ||
        /^([-*_])\1{2,}$/.test(nextTrimmed) ||
        /^&gt;\s?/.test(nextTrimmed) ||
        /^\s*[*-]\s+/.test(nextLine) ||
        /^\s*\d+\.\s+/.test(nextLine)
      ) {
        break;
      }
      paraLines.push(renderInline(nextTrimmed));
      i++;
    }
    html.push(`<p>${paraLines.join('<br />')}</p>`);
  }

  closeListsTo(-1);
  return html.join('\n');
}
