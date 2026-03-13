import { memo, useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import { codeToHtml, type BundledLanguage } from 'shiki';

interface ChatMarkdownProps {
  content: string;
  isStreaming?: boolean;
  className?: string;
}

// Map common language aliases
const languageMap: Record<string, BundledLanguage> = {
  js: 'javascript',
  ts: 'typescript',
  py: 'python',
  rb: 'ruby',
  sh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  '': 'plaintext',
};

function normalizeLanguage(lang: string | undefined): BundledLanguage {
  if (!lang) return 'plaintext';
  const mapped = languageMap[lang.toLowerCase()];
  return (mapped || lang.toLowerCase()) as BundledLanguage;
}

// Code block with syntax highlighting
const CodeBlock = memo(function CodeBlock({ 
  code, 
  language 
}: { 
  code: string; 
  language?: string;
}) {
  const [html, setHtml] = useState<string>('');
  const [copied, setCopied] = useState(false);
  
  useEffect(() => {
    let cancelled = false;
    
    const highlight = async () => {
      try {
        const result = await codeToHtml(code, {
          lang: normalizeLanguage(language),
          theme: 'github-dark-default',
        });
        if (!cancelled) setHtml(result);
      } catch {
        // Fallback to plain text on error
        if (!cancelled) {
          setHtml(`<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`);
        }
      }
    };
    
    highlight();
    return () => { cancelled = true; };
  }, [code, language]);
  
  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);
  
  return (
    <div className="relative group my-3">
      {/* Language badge + copy button */}
      <div className="absolute top-0 right-0 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {language && (
          <span className="px-2 py-0.5 text-[10px] uppercase text-zinc-500 bg-zinc-800/80 rounded">
            {language}
          </span>
        )}
        <button
          onClick={handleCopy}
          className="p-1.5 text-zinc-500 hover:text-zinc-300 bg-zinc-800/80 rounded hover:bg-zinc-700/80 transition-colors"
          title="Copy code"
        >
          {copied ? (
            <Check className="w-3.5 h-3.5 text-emerald-400" />
          ) : (
            <Copy className="w-3.5 h-3.5" />
          )}
        </button>
      </div>
      
      {/* Highlighted code */}
      <div 
        className="rounded-lg overflow-hidden bg-zinc-900 border border-zinc-800 text-sm [&_pre]:p-4 [&_pre]:overflow-x-auto [&_code]:font-mono"
        dangerouslySetInnerHTML={{ __html: html || `<pre><code>${escapeHtml(code)}</code></pre>` }}
      />
    </div>
  );
});

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Inline code
const InlineCode = memo(function InlineCode({ children }: { children: React.ReactNode }) {
  return (
    <code className="px-1.5 py-0.5 bg-zinc-800 text-zinc-200 rounded text-[0.9em] font-mono">
      {children}
    </code>
  );
});

export const ChatMarkdown = memo(function ChatMarkdown({ 
  content, 
  isStreaming,
  className = ''
}: ChatMarkdownProps) {
  return (
    <div className={`prose prose-invert prose-sm max-w-none ${className}`}>
      <ReactMarkdown 
        remarkPlugins={[remarkGfm]}
        components={{
          // Code blocks
          pre: ({ children }) => <>{children}</>,
          code: ({ children, className, ...props }) => {
            const match = /language-(\w+)/.exec(className || '');
            const isBlock = match || (typeof children === 'string' && children.includes('\n'));
            
            if (isBlock) {
              const code = String(children).replace(/\n$/, '');
              return <CodeBlock code={code} language={match?.[1]} />;
            }
            
            return <InlineCode {...props}>{children}</InlineCode>;
          },
          
          // Links
          a: ({ children, href, ...props }) => (
            <a 
              href={href} 
              target="_blank" 
              rel="noreferrer" 
              className="text-indigo-400 hover:text-indigo-300 underline decoration-indigo-400/30 hover:decoration-indigo-400/60 transition-colors"
              {...props}
            >
              {children}
            </a>
          ),
          
          // Tables
          table: ({ children }) => (
            <div className="overflow-x-auto my-4">
              <table className="min-w-full divide-y divide-zinc-700 border border-zinc-700 rounded-lg overflow-hidden">
                {children}
              </table>
            </div>
          ),
          thead: ({ children }) => (
            <thead className="bg-zinc-800/50">{children}</thead>
          ),
          th: ({ children }) => (
            <th className="px-3 py-2 text-left text-xs font-medium text-zinc-400 uppercase tracking-wider">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="px-3 py-2 text-sm text-zinc-300 border-t border-zinc-800">
              {children}
            </td>
          ),
          
          // Lists
          ul: ({ children }) => (
            <ul className="list-disc list-inside space-y-1 my-2 text-zinc-300">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal list-inside space-y-1 my-2 text-zinc-300">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-zinc-300">{children}</li>
          ),
          
          // Headings
          h1: ({ children }) => (
            <h1 className="text-xl font-semibold text-zinc-100 mt-6 mb-3">{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 className="text-lg font-semibold text-zinc-100 mt-5 mb-2">{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-medium text-zinc-200 mt-4 mb-2">{children}</h3>
          ),
          
          // Paragraphs
          p: ({ children }) => (
            <p className="text-zinc-300 leading-relaxed my-2">{children}</p>
          ),
          
          // Blockquotes
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-zinc-600 pl-4 my-3 text-zinc-400 italic">
              {children}
            </blockquote>
          ),
          
          // Horizontal rule
          hr: () => <hr className="border-zinc-700 my-6" />,
          
          // Strong/emphasis
          strong: ({ children }) => (
            <strong className="font-semibold text-zinc-100">{children}</strong>
          ),
          em: ({ children }) => (
            <em className="italic text-zinc-300">{children}</em>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
      
      {/* Streaming cursor */}
      {isStreaming && (
        <span className="inline-block w-2 h-4 bg-indigo-400 animate-pulse ml-0.5 align-text-bottom" />
      )}
    </div>
  );
});
