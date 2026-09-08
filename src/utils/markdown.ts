/**
 * Quiet Markdown Renderer for Chat Messages
 * Formats prose, tables, lists, and tabular monospace numbers with zero visual clutter.
 */

/**
 * C-05 · ESCAPE FIRST. Everything this returns is rendered with
 * dangerouslySetInnerHTML, and the input is user text, model text and alert
 * text from the database (order_leg.note is user-writable through the API).
 * Typing `<img src=x onerror=…>` in the ask box used to execute. The only
 * markup that survives is what the regexes below add, and they add only
 * their own tags.
 *
 * A caller that WANTS a bold word writes `**word**`; raw `<b>` is escaped,
 * like every other tag.
 */
export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function formatChatContent(raw: string): string {
  if (!raw) return "";

  let text = escapeHtml(raw.trim());

  // Normalize line endings
  text = text.replace(/\r\n/g, "\n");

  // Parse markdown tables if any exist
  const tableRegex = /(?:(?:^|\n)\|[^\n]+\|\r?\n\|[-:\s|]+\|\r?\n(?:\|[^\n]+\|\r?\n?)+)/g;
  text = text.replace(tableRegex, (match) => {
    const lines = match.trim().split("\n").map((l) => l.trim());
    if (lines.length < 3) return match;

    const parseRow = (rowStr: string) => {
      return rowStr
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => cell.trim());
    };

    const headers = parseRow(lines[0]);
    const bodyRows = lines.slice(2).map(parseRow);

    const thead = `<thead><tr>${headers
      .map((h) => `<th>${wrapNumbers(formatInline(h))}</th>`)
      .join("")}</tr></thead>`;
    const tbody = `<tbody>${bodyRows
      .map(
        (row) =>
          `<tr>${row
            .map((c) => `<td>${wrapNumbers(formatInline(c))}</td>`)
            .join("")}</tr>`
      )
      .join("")}</tbody>`;

    return `<div class="table-wrap"><table class="quiet-table">${thead}${tbody}</table></div>`;
  });

  // Split by double newlines for paragraphs or handle line-by-line
  const blocks = text.split(/\n{2,}/);
  const formattedBlocks = blocks.map((block) => {
    const trimmed = block.trim();

    // Already a table
    if (trimmed.startsWith("<div class=\"table-wrap\">")) {
      return trimmed;
    }

    // Unordered list
    if (/^(?:[-*•]\s+.+(?:\n|$))+/.test(trimmed)) {
      const items = trimmed
        .split("\n")
        .map((line) => line.replace(/^[-*•]\s+/, "").trim())
        .filter(Boolean)
        .map((item) => `<li>${wrapNumbers(formatInline(item))}</li>`)
        .join("");
      return `<ul class="quiet-list">${items}</ul>`;
    }

    // Ordered list
    if (/^(?:\d+\.\s+.+(?:\n|$))+/.test(trimmed)) {
      const items = trimmed
        .split("\n")
        .map((line) => line.replace(/^\d+\.\s+/, "").trim())
        .filter(Boolean)
        .map((item) => `<li>${wrapNumbers(formatInline(item))}</li>`)
        .join("");
      return `<ol class="quiet-list">${items}</ol>`;
    }

    // Regular paragraph
    const inlineFormatted = formatInline(trimmed).replace(/\n/g, "<br>");
    return `<p>${wrapNumbers(inlineFormatted)}</p>`;
  });

  return formattedBlocks.join("");
}

function formatInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
    .replace(/__(.+?)__/g, "<b>$1</b>")
    .replace(/\*(.+?)\*/g, "<i>$1</i>")
    .replace(/_([^_]+)_/g, "<i>$1</i>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

/**
 * Wraps digits and financial numbers in a monospace span for clean tabular alignment,
 * without touching already tagged HTML numbers.
 */
function wrapNumbers(text: string): string {
  // If the text has HTML tags, we should avoid matching inside tags like <span class="...">
  return text.replace(/(<[^>]+>)|((?:\+|-)?\b\d{1,3}(?:,\d{3})*(?:\.\d+)?%?\b(?:\s*(?:fils|fil|KD|shares|minutes|min|seconds|sec|trades|observations|snaps|x|×))?)/gi, (match, tag, num) => {
    if (tag) return tag;
    if (num) {
      return `<span class="mono-num">${num}</span>`;
    }
    return match;
  });
}
