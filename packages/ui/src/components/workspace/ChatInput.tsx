/**
 * ChatInput - Auto-growing textarea with file upload support
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, Paperclip, X, Image, FileText, File, Loader2 } from 'lucide-react';

export interface UploadedFile {
  id: string;
  name: string;
  type: string;
  size: number;
  preview?: string;  // Data URL for images
  status: 'uploading' | 'ready' | 'error';
  error?: string;
}

interface ChatInputProps {
  onSend: (message: string, files?: UploadedFile[]) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  showPrompt?: boolean;
  promptIcon?: string;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getFileIcon(type: string) {
  if (type.startsWith('image/')) return Image;
  if (type.includes('pdf') || type.includes('document') || type.includes('text')) return FileText;
  return File;
}

export function ChatInput({
  onSend,
  placeholder = 'Send message...',
  disabled = false,
  className = '',
  showPrompt = true,
  promptIcon = '❯',
}: ChatInputProps) {
  const [input, setInput] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    
    // Reset height to auto to get the correct scrollHeight
    textarea.style.height = 'auto';
    // Set to scrollHeight, but cap at max height
    const maxHeight = 200;
    const newHeight = Math.min(textarea.scrollHeight, maxHeight);
    textarea.style.height = `${newHeight}px`;
  }, [input]);

  const handleSubmit = useCallback(() => {
    if ((!input.trim() && files.length === 0) || disabled) return;
    
    const readyFiles = files.filter(f => f.status === 'ready');
    onSend(input.trim(), readyFiles.length > 0 ? readyFiles : undefined);
    setInput('');
    setFiles([]);
  }, [input, files, disabled, onSend]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const processFile = async (file: File): Promise<UploadedFile> => {
    const id = `file-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const uploadedFile: UploadedFile = {
      id,
      name: file.name,
      type: file.type,
      size: file.size,
      status: 'uploading',
    };

    // For images, create preview
    if (file.type.startsWith('image/')) {
      return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => {
          resolve({
            ...uploadedFile,
            preview: e.target?.result as string,
            status: 'ready',
          });
        };
        reader.onerror = () => {
          resolve({
            ...uploadedFile,
            status: 'error',
            error: 'Failed to read file',
          });
        };
        reader.readAsDataURL(file);
      });
    }

    // For other files, just mark as ready (actual upload would happen on send)
    return {
      ...uploadedFile,
      status: 'ready',
    };
  };

  const handleFiles = async (fileList: FileList | File[]) => {
    const filesArray = Array.from(fileList);
    
    // Add files with uploading status
    const pendingFiles = filesArray.map(f => ({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      type: f.type,
      size: f.size,
      status: 'uploading' as const,
    }));
    
    setFiles(prev => [...prev, ...pendingFiles]);

    // Process files
    for (let i = 0; i < filesArray.length; i++) {
      const processed = await processFile(filesArray[i]);
      setFiles(prev => prev.map(f => 
        f.id === pendingFiles[i].id ? { ...processed, id: f.id } : f
      ));
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const removeFile = (fileId: string) => {
    setFiles(prev => prev.filter(f => f.id !== fileId));
  };

  const hasContent = input.trim().length > 0 || files.length > 0;
  const isUploading = files.some(f => f.status === 'uploading');

  return (
    <div 
      className={`flex flex-col gap-2 ${className}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* File previews */}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {files.map(file => {
            const FileIcon = getFileIcon(file.type);
            return (
              <div 
                key={file.id}
                className={`
                  relative flex items-center gap-2 px-2 py-1.5 rounded-lg border
                  ${file.status === 'error' 
                    ? 'bg-red-500/10 border-red-500/30' 
                    : 'bg-zinc-800/50 border-zinc-700'
                  }
                `}
              >
                {file.preview ? (
                  <img 
                    src={file.preview} 
                    alt={file.name}
                    className="w-8 h-8 object-cover rounded"
                  />
                ) : (
                  <FileIcon className="w-5 h-5 text-zinc-400" />
                )}
                <div className="flex flex-col min-w-0">
                  <span className="text-xs text-zinc-300 truncate max-w-[120px]">
                    {file.name}
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    {file.status === 'uploading' ? 'Processing...' : formatFileSize(file.size)}
                  </span>
                </div>
                {file.status === 'uploading' ? (
                  <Loader2 className="w-3 h-3 text-violet-400 animate-spin" />
                ) : (
                  <button 
                    onClick={() => removeFile(file.id)}
                    className="p-0.5 hover:bg-zinc-700 rounded"
                  >
                    <X className="w-3 h-3 text-zinc-500 hover:text-zinc-300" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Input area */}
      <div
        className={`
          flex items-center gap-2 bg-zinc-900 rounded-lg px-3 py-2 transition-colors
          ${isDragging ? 'ring-2 ring-violet-500/50 bg-violet-500/5' : ''}
          ${disabled ? 'opacity-50' : ''}
        `}
      >
        {showPrompt && (
          <span className="text-violet-400 text-sm">{promptIcon}</span>
        )}
        
        <textarea
          ref={textareaRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={isDragging ? 'Drop files here...' : placeholder}
          disabled={disabled}
          rows={1}
          className="flex-1 bg-transparent text-sm text-zinc-200 placeholder:text-zinc-600 focus:outline-none resize-none min-h-[24px] max-h-[200px] py-0.5"
          style={{ height: 'auto' }}
        />

        <div className="flex items-center gap-1">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            onChange={(e) => e.target.files && handleFiles(e.target.files)}
            className="hidden"
          />
          
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={disabled}
            className="p-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-30"
            title="Attach files"
          >
            <Paperclip className="w-4 h-4" />
          </button>

          <button 
            onClick={handleSubmit} 
            disabled={!hasContent || disabled || isUploading}
            className="p-1 text-zinc-500 hover:text-violet-400 disabled:opacity-30"
            title="Send message"
          >
            {isUploading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Drag hint */}
      {isDragging && (
        <div className="absolute inset-0 flex items-center justify-center bg-violet-500/10 rounded-lg border-2 border-dashed border-violet-500/50 pointer-events-none">
          <span className="text-sm text-violet-400">Drop files to attach</span>
        </div>
      )}
    </div>
  );
}

export default ChatInput;
