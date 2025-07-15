import { useMemo } from 'react';

interface MessageTextProps {
  content: string;
  className?: string;
}

export default function MessageText({ content, className = '' }: MessageTextProps) {
  const formattedContent = useMemo(() => {
    const escapeHtml = (text: string) => {
      const div = document.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    };

    // Code block formatting
    let formatted = content.replace(
      /```(\w+)?\n([\s\S]*?)```/g,
      (_match, lang: string, code: string) => {
        return `<div class="bg-base-300 border border-base-content/20 rounded-lg p-3 my-2 overflow-x-auto">
        <div class="text-xs text-base-content/60 mb-2">${lang || 'code'}</div>
        <pre class="text-accent text-sm"><code>${escapeHtml(code.trim())}</code></pre>
      </div>`;
      }
    );

    // Inline code formatting
    formatted = formatted.replace(
      /`([^`]+)`/g,
      '<code class="bg-base-300 px-2 py-1 rounded text-accent text-sm">$1</code>'
    );

    // Newline formatting
    formatted = formatted.replace(/\n/g, '<br>');

    return formatted;
  }, [content]);

  return (
    <div
      className={`text-sm leading-relaxed text-base-content ${className}`}
      dangerouslySetInnerHTML={{ __html: formattedContent }}
    />
  );
}