import React, { useState } from 'react';
import { Copy, Check, Download, FolderTree, FileText, BarChart3, Hash, Cpu, XCircle } from 'lucide-react';
import { IngestResponse } from '../types';

interface ResultSectionProps {
  result: IngestResponse | null;
  error: string | null;
  isLoading: boolean;
  onCancel?: () => void;
}

export const ResultSection: React.FC<ResultSectionProps> = ({ result, error, isLoading, onCancel }) => {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  const handleCopy = (text: string, sectionName: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSection(sectionName);
    setTimeout(() => {
      setCopiedSection((curr) => (curr === sectionName ? null : curr));
    }, 2000);
  };

  const handleDownload = () => {
    if (!result) return;
    const fullText = `${result.summary}\n\n${result.tree}\n\n${result.content}`;
    const filename = `${(result.repo_name || 'repository').replace(/\//g, '_')}_digest.txt`;
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-6xl 2xl:max-w-7xl mx-auto mt-8 px-2 sm:px-4">
        <div className="relative">
          <div className="w-full h-full absolute inset-0 bg-black rounded-xl translate-y-2 translate-x-2"></div>
          <div className="bg-[#161b22] rounded-xl border-[3px] border-[#30363d] p-8 sm:p-12 relative z-20 flex flex-col items-center justify-center space-y-4">
            <div className="w-14 h-14 border-4 border-[#30363d] border-t-4 border-t-amber-400 rounded-full animate-spin"></div>
            <p className="text-xl font-extrabold text-white text-center">Ingesting repository...</p>
            <p className="text-sm text-gray-400 text-center max-w-md">
              Downloading repository archive, analyzing directory tree, filtering patterns, and consolidating codebase digest.
            </p>
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="mt-2 px-5 py-2.5 rounded-xl bg-red-600/90 hover:bg-red-500 border-2 border-red-700 text-white font-extrabold text-xs sm:text-sm flex items-center gap-2 cursor-pointer transition-transform active:translate-y-0.5 shadow-[2px_2px_0_0_#000000]"
              >
                <XCircle className="w-4 h-4" />
                <span>Cancel Ingestion</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="w-full max-w-6xl 2xl:max-w-7xl mx-auto mt-8 px-2 sm:px-4">
        <div className="relative">
          <div className="w-full h-full absolute inset-0 bg-black rounded-xl translate-y-2 translate-x-2"></div>
          <div className="bg-red-950/40 rounded-xl border-[3px] border-red-700/60 p-6 relative z-20">
            <h4 className="text-base font-bold text-red-300 mb-1">Ingestion Notice</h4>
            <p className="text-sm text-red-200 leading-relaxed font-medium">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  if (!result) return null;

  const fullDigest = `${result.summary}\n\n${result.tree}\n\n${result.content}`;

  return (
    <div className="w-full max-w-6xl 2xl:max-w-7xl mx-auto mt-8 px-2 sm:px-4 space-y-6">
      {/* Quick Metrics Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-[#161b22] border-2 border-[#30363d] rounded-xl p-3 flex items-center gap-2.5 shadow-[2px_2px_0_0_#000000]">
          <BarChart3 className="w-5 h-5 text-amber-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold text-gray-400">Files Analyzed</div>
            <div className="text-base font-extrabold text-white truncate">{result.files_analyzed ?? '0'}</div>
          </div>
        </div>

        <div className="bg-[#161b22] border-2 border-[#30363d] rounded-xl p-3 flex items-center gap-2.5 shadow-[2px_2px_0_0_#000000]">
          <Cpu className="w-5 h-5 text-emerald-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold text-gray-400">Tokens Estimate</div>
            <div className="text-base font-extrabold text-white truncate">{result.estimated_tokens ?? '0'}</div>
          </div>
        </div>

        <div className="bg-[#161b22] border-2 border-[#30363d] rounded-xl p-3 flex items-center gap-2.5 shadow-[2px_2px_0_0_#000000]">
          <Hash className="w-5 h-5 text-sky-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold text-gray-400">Characters</div>
            <div className="text-base font-extrabold text-white truncate">
              {result.total_chars ? result.total_chars.toLocaleString() : '0'}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => handleCopy(fullDigest, 'all')}
            className="flex-1 h-full py-2.5 px-3 bg-amber-500 hover:bg-amber-400 border-2 border-amber-600 text-gray-950 font-extrabold rounded-xl text-xs sm:text-sm transition-transform active:translate-y-0.5 shadow-[2px_2px_0_0_#000000] flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {copiedSection === 'all' ? (
              <>
                <Check className="w-4 h-4 text-emerald-950" />
                <span>Copied!</span>
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" />
                <span>Copy Digest</span>
              </>
            )}
          </button>

          <button
            onClick={handleDownload}
            className="h-full py-2.5 px-3 bg-[#21262d] hover:bg-[#30363d] border-2 border-[#30363d] text-white font-bold rounded-xl text-xs sm:text-sm transition-transform active:translate-y-0.5 shadow-[2px_2px_0_0_#000000] flex items-center justify-center gap-1.5 cursor-pointer"
            title="Download full digest as .txt file"
          >
            <Download className="w-4 h-4" />
            <span className="hidden sm:inline">Download</span>
          </button>
        </div>
      </div>

      {/* Main Container */}
      <div className="relative">
        <div className="w-full h-full absolute inset-0 bg-black rounded-2xl translate-y-2 translate-x-2"></div>
        <div className="bg-[#161b22] rounded-2xl border-[3px] border-[#30363d] p-4 sm:p-6 lg:p-8 relative z-20 space-y-6 text-gray-100">
          
          {/* Top Row: Summary & Tree */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
            {/* Summary column */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                  <span>Summary</span>
                </h3>
                <span className="text-xs text-gray-400 font-mono">Overview</span>
              </div>
              <div className="relative flex-1 min-h-[180px]">
                <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0"></div>
                <textarea
                  value={result.summary}
                  readOnly
                  className="w-full h-full min-h-[180px] p-4 bg-[#0d1117] border-[3px] border-[#30363d] rounded font-mono text-xs sm:text-sm resize-none focus:outline-none relative z-10 text-amber-300"
                />
              </div>
            </div>

            {/* Directory Structure Column */}
            <div className="lg:col-span-7 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                  <FolderTree className="w-5 h-5 text-amber-400" />
                  <span>Directory Structure</span>
                </h3>
                <button
                  onClick={() => handleCopy(result.tree, 'tree')}
                  className="px-3 py-1 bg-[#21262d] hover:bg-[#30363d] border-[2px] border-[#30363d] text-amber-400 font-bold rounded text-xs transition-transform shadow-[1px_1px_0_0_#000000] flex items-center gap-1.5 cursor-pointer"
                >
                  {copiedSection === 'tree' ? (
                    <>
                      <Check className="w-3.5 h-3.5" />
                      <span>Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Tree</span>
                    </>
                  )}
                </button>
              </div>

              <div className="relative flex-1 min-h-[220px]">
                <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0"></div>
                <div className="w-full h-full min-h-[220px] max-h-[360px] p-4 bg-[#0d1117] border-[3px] border-[#30363d] rounded font-mono text-xs sm:text-sm overflow-auto relative z-10 text-emerald-400 whitespace-pre">
                  {result.tree}
                </div>
              </div>
            </div>
          </div>

          {/* Files Content Section */}
          <div className="pt-2 flex flex-col">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base sm:text-lg font-extrabold text-white flex items-center gap-2">
                <FileText className="w-5 h-5 text-amber-400" />
                <span>Files Content</span>
              </h3>
              <button
                onClick={() => handleCopy(result.content, 'content')}
                className="px-3 py-1 bg-[#21262d] hover:bg-[#30363d] border-[2px] border-[#30363d] text-amber-400 font-bold rounded text-xs transition-transform shadow-[1px_1px_0_0_#000000] flex items-center gap-1.5 cursor-pointer"
              >
                {copiedSection === 'content' ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy Content</span>
                  </>
                )}
              </button>
            </div>

            <div className="relative">
              <div className="w-full h-full rounded bg-black translate-y-1 translate-x-1 absolute inset-0"></div>
              <textarea
                value={result.content}
                readOnly
                className="w-full h-[55vh] min-h-[350px] p-4 bg-[#0d1117] border-[3px] border-[#30363d] rounded font-mono text-xs sm:text-sm resize-none focus:outline-none relative z-10 text-gray-200 leading-relaxed"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
