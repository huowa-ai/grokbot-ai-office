function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function inline(text: string): string {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>',
    );
}

/** 最小 Markdown：标题、列表、代码块、段落。先转义再加标签，不放行原始 HTML。 */
export function renderMarkdown(source: string): string {
  const out: string[] = [];
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  let list = false;
  let para: string[] = [];
  const flush = () => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(' '))}</p>`);
      para = [];
    }
    if (list) {
      out.push('</ul>');
      list = false;
    }
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] as string;
    if (line.startsWith('```')) {
      flush();
      const code: string[] = [];
      for (i += 1; i < lines.length && !(lines[i] as string).startsWith('```'); i += 1) {
        code.push(lines[i] as string);
      }
      out.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      flush();
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${inline(heading[2] as string)}</h${level}>`);
      continue;
    }
    const item = /^\s*[-*]\s+(.*)$/.exec(line);
    if (item) {
      if (para.length > 0) flush();
      if (!list) {
        out.push('<ul>');
        list = true;
      }
      out.push(`<li>${inline(item[1] as string)}</li>`);
      continue;
    }
    if (line.trim() === '') {
      flush();
      continue;
    }
    if (list) flush();
    para.push(line);
  }
  flush();
  return out.join('\n');
}
