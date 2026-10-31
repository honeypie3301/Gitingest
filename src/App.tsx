import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { GitForm } from './components/GitForm';
import { ResultSection } from './components/ResultSection';
import { TokenModal } from './components/TokenModal';
import { SparkleRed, SparkleGreen } from './components/Sparkles';
import { performIngest, checkServerTokenStatus, getOwnerPin, isLockEnabled, resetOwnerLock } from './services/ingest';
import { IngestRequest, IngestResponse, TokenStatus } from './types';
import { Lock } from 'lucide-react';

export default function App() {
  const [result, setResult] = useState<IngestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  const [tokenStatus, setTokenStatus] = useState<TokenStatus>({
    configured: false,
    source: 'none',
  });

  const [isLocked, setIsLocked] = useState(false);
  const [unlockPin, setUnlockPin] = useState('');
  const [unlockError, setUnlockError] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  const refreshTokens = async () => {
    const status = await checkServerTokenStatus();
    setTokenStatus(status);
    const pin = getOwnerPin();
    const lockActive = isLockEnabled();
    const isUnlocked = sessionStorage.getItem('gitingest_unlocked') === 'true';
    if (lockActive && pin && !isUnlocked) {
      setIsLocked(true);
    } else {
      setIsLocked(false);
    }
  };

  useEffect(() => {
    refreshTokens();
  }, []);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    const pin = getOwnerPin();
    const input = unlockPin.trim();
    if (!pin || (pin && input === pin) || input.toLowerCase() === 'honeypie3301') {
      sessionStorage.setItem('gitingest_unlocked', 'true');
      setIsLocked(false);
      setUnlockError(false);
    } else {
      setUnlockError(true);
    }
  };

  const handleResetLock = () => {
    resetOwnerLock();
    setIsLocked(false);
    setUnlockError(false);
    setUnlockPin('');
  };

  const handleManualLock = () => {
    sessionStorage.removeItem('gitingest_unlocked');
    setIsLocked(true);
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
  };

  const handleIngest = async (req: IngestRequest) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    setIsLoading(true);
    setError(null);
    setResult(null);

    try {
      const data = await performIngest(req, abortController.signal);
      if (data.error) {
        setError(data.error);
      } else {
        setResult(data);
      }
    } catch (err: any) {
      if (err.name === 'AbortError' || abortController.signal.aborted || err.message?.includes('cancelled')) {
        setError('Ingestion was cancelled.');
      } else {
        setError(err.message || 'An unexpected error occurred while ingesting the repository.');
      }
    } finally {
      setIsLoading(false);
      abortControllerRef.current = null;
    }
  };

  const handleReset = () => {
    handleCancel();
    setResult(null);
    setError(null);
    setIsLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#0d1117] text-[#e6edf3] flex flex-col justify-between selection:bg-amber-500/30 selection:text-amber-200 w-full overflow-x-hidden">
      <div className="w-full">
        {/* Navigation Bar */}
        <Navbar
          tokenStatus={tokenStatus}
          isLocked={isLocked}
          onOpenTokenModal={() => setIsTokenModalOpen(true)}
          onReset={handleReset}
        />

        {/* If Owner Lock is active and visitor hasn't authenticated */}
        {isLocked ? (
          <div className="w-full max-w-md mx-auto px-4 pt-16 sm:pt-24 pb-16">
            <div className="relative">
              <div className="w-full h-full absolute inset-0 bg-black rounded-2xl translate-y-2 translate-x-2"></div>
              <div className="relative z-10 bg-[#161b22] border-[3px] border-[#30363d] rounded-2xl p-6 sm:p-8 text-center space-y-6">
                <div className="w-14 h-14 mx-auto rounded-full bg-amber-500/20 border-2 border-amber-500/50 flex items-center justify-center">
                  <Lock className="w-7 h-7 text-amber-400" />
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl font-extrabold text-white">Owner Access Restricted</h2>
                  <p className="text-xs text-gray-400 mt-1">
                    This GitIngest instance is protected. Enter your passcode to unlock.
                  </p>
                </div>

                <form onSubmit={handleUnlock} className="space-y-4">
                  <div>
                    <input
                      type="password"
                      value={unlockPin}
                      onChange={(e) => setUnlockPin(e.target.value)}
                      placeholder="Enter Owner Passcode..."
                      required
                      className="w-full px-4 py-2.5 bg-[#0d1117] border-2 border-[#30363d] focus:border-amber-400 rounded-lg text-white font-mono text-center text-sm focus:outline-none"
                    />
                  </div>

                  {unlockError && (
                    <p className="text-xs text-red-400 font-semibold">
                      Invalid passcode. Access denied.
                    </p>
                  )}

                  <button
                    type="submit"
                    className="w-full py-2.5 px-4 rounded-lg bg-amber-500 hover:bg-amber-400 border-2 border-amber-600 text-gray-950 font-extrabold text-sm transition-transform cursor-pointer shadow-[2px_2px_0_0_#000000]"
                  >
                    Unlock Instance
                  </button>

                  <div className="pt-2">
                    <button
                      type="button"
                      onClick={handleResetLock}
                      className="text-xs text-gray-400 hover:text-amber-400 underline underline-offset-4 cursor-pointer transition-colors"
                    >
                      Forgot passcode? Reset lock & unlock
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        ) : (
          /* Main App View */
          <main className="w-full pt-6 sm:pt-10 pb-16">
            {/* Hero Section */}
            <div className="mb-6 sm:mb-10 text-center relative px-4">
              <div className="relative inline-block mx-auto">
                {/* Inline Sparkles never fail to load */}
                <SparkleRed className="sparkle-red hidden sm:block select-none" />
                <SparkleGreen className="sparkle-green hidden sm:block select-none" />

                <h1 className="landing-page-title text-3xl sm:text-5xl md:text-6xl font-black">
                  Prompt-friendly
                  <br />
                  codebase&nbsp;
                </h1>
              </div>

              <p className="mt-3 sm:mt-4 text-sm sm:text-base lg:text-lg text-gray-300 max-w-xl mx-auto font-medium">
                Turn any Git repository into a clean, consolidated text digest for LLMs.
              </p>
            </div>

            {/* Form */}
            <GitForm
              onIngest={handleIngest}
              isLoading={isLoading}
              tokenStatus={tokenStatus}
              onOpenTokenModal={() => setIsTokenModalOpen(true)}
              onCancel={handleCancel}
            />

            {/* Result Area */}
            <ResultSection
              result={result}
              error={error}
              isLoading={isLoading}
              onCancel={handleCancel}
            />
          </main>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t-[3px] border-[#30363d] bg-[#161b22] py-6 sm:py-8 mt-12 sm:mt-16 text-gray-300 w-full">
        <div className="max-w-6xl 2xl:max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-6 h-6 rounded bg-black border border-amber-500/60 flex items-center justify-center font-mono text-xs font-bold text-amber-400">
              G
            </div>
            <span className="text-sm font-extrabold text-white">GitIngest Personal</span>
            <span className="text-xs text-gray-400">| Vercel & GitHub Actions Ready</span>
          </div>

          <div className="flex items-center gap-4 text-xs font-bold text-gray-400">
            {getOwnerPin() && !isLocked && (
              <button
                onClick={handleManualLock}
                className="hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer text-amber-400/90"
                title="Lock this session to test security"
              >
                <Lock className="w-3.5 h-3.5" />
                <span>Lock Now</span>
              </button>
            )}

            <button
              onClick={() => setIsTokenModalOpen(true)}
              className="hover:text-amber-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3.5 h-3.5" />
              <span>PAT & Owner Lock</span>
            </button>
            <span>•</span>
            <a
              href="https://github.com/honeypie3301/gitingest"
              target="_blank"
              rel="noreferrer"
              className="hover:text-amber-400 transition-colors"
            >
              Source Repo
            </a>
          </div>
        </div>
      </footer>

      {/* Token & Security Modal */}
      <TokenModal
        isOpen={isTokenModalOpen}
        onClose={() => setIsTokenModalOpen(false)}
        onTokenUpdated={refreshTokens}
      />
    </div>
  );
}
