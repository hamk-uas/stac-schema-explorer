function escapeHtml(text: string): string {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

/** Schema descriptions to safe HTML: `code` spans and bare http(s) URLs; everything else is escaped text. */
export function inlineMarkdown(text: string): string {
    return text
        .split(/(`[^`]+`)/)
        .map((part) => {
            if (/^`[^`]+`$/.test(part)) return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
            return escapeHtml(part).replace(/https?:\/\/[^\s<)"]+[^\s<)".,;:]/g, (url) => `<a href="${url}" target="_blank" rel="noopener">${url}</a>`);
        })
        .join('');
}
