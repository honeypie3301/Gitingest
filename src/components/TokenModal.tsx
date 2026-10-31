import React, { useState, useEffect } from 'react';
import { Key, CheckCircle, AlertCircle, X, Shield, ExternalLink, RefreshCw, Lock, Unlock, UserCheck } from 'lucide-react';
import { verifyGitHubToken } from '../services/githubApi';
import { getSavedToken, setSavedToken, getAutoInjectToken, setAutoInjectToken, getOwnerPin, setOwnerPin, isLockEnabled, setLockEnabled } from '../services/ingest';
import { GitHubUser } from '../types';

interface TokenModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTokenUpdated: () => void;
}

export const TokenModal: React.FC<TokenModalProps> = ({ isOpen, onClose, onTokenUpdated }) => {
  const [tokenInput, setTokenInput] = useState('');
  const [autoInject, setAutoInject] = useState(true);
  const [pinInput, setPinInput] = useState('');
  const [lockActive, setLockActive] = useState(true);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedUser, setVerifiedUser] = useState<GitHubUser | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'token' | 'owner_lock'>('token');

  useEffect(() => {
    if (isOpen) {
      const current = getSavedToken();
      setTokenInput(current);
      setAutoInject(getAutoInjectToken());
      setPinInput(getOwnerPin());
      setLockActive(isLockEnabled());
      if (current) {
        verify(current);
      }
    }
  }, [isOpen]);

  const verify = async (token: string) => {
    if (!token.trim()) {
      setVerifiedUser(null);
      setVerifyError(null);
      return;
    }
    setIsVerifying(true);
    setVerifyError(null);
    try {
      const user = await verifyGitHubToken(token);
      if (user) {
        setVerifiedUser(user);
        setVerifyError(null);
      } else {
        setVerifiedUser(null);
        setVerifyError('Invalid token or expired. Make sure it has "repo" scope for private repositories.');
      }
    } catch {
      setVerifyError('Failed to verify token with GitHub.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSave = () => {
    setSavedToken(tokenInput.trim());
    setAutoInjectToken(autoInject);
    setOwnerPin(pinInput.trim());
    setLockEnabled(lockActive);
    onTokenUpdated();
    onClose();
  };

  const handleClear = () => {
    setSavedToken('');
    setTokenInput('');
    setVerifiedUser(null);
    setVerifyError(null);
    onTokenUpdated();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs">
      <div className="relative w-full max-w-lg">
        {/* Dark Brutalist Shadow Box */}
        <div className="absolute inset-0 bg-black rounded-xl translate-x-2 translate-y-2"></div>
        <div className="relative bg-[#161b22] border-[3px] border-[#30363d] rounded-xl p-6 sm:p-8 z-10 text-gray-100">
          {/* Header */}
          <div className="flex items-center justify-between pb-4 border-b-2 border-[#30363d] mb-5">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-amber-500/20 border-2 border-amber-500/60 rounded-lg">
                <Key className="w-6 h-6 text-amber-400" />
              </div>
              <div>
                <h3 className="text-xl font-extrabold text-white">Access & Security Settings</h3>
                <p className="text-xs text-gray-400">PAT Persistence & Owner Protection</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-[#21262d] border-2 border-[#30363d] transition-colors text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b-2 border-[#30363d] mb-5">
            <button
              onClick={() => setActiveTab('token')}
              className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-0.5 ${
                activeTab === 'token'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              Personal Access Token
            </button>
            <button
              onClick={() => setActiveTab('owner_lock')}
              className={`pb-2.5 px-3 text-xs font-bold uppercase tracking-wider transition-colors border-b-2 -mb-0.5 flex items-center gap-1.5 ${
                activeTab === 'owner_lock'
                  ? 'border-amber-400 text-amber-400'
                  : 'border-transparent text-gray-400 hover:text-gray-200'
              }`}
            >
              <Shield className="w-3.5 h-3.5" />
              <span>Owner Lock (Block Others)</span>
            </button>
          </div>

          {activeTab === 'token' ? (
            <div className="space-y-4">
              {/* Security Explanation */}
              <div className="text-xs leading-relaxed bg-[#0d1117] p-3.5 rounded-lg border-2 border-[#30363d] text-gray-300">
                <div className="flex items-start gap-2">
                  <Shield className="w-4 h-4 text-emerald-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">Is it permanently saved & secure?</span>{' '}
                    <p className="mt-1">
                      Yes! When saved here, it is permanently stored in your browser&apos;s isolated <code className="text-amber-400 bg-amber-950/40 px-1 py-0.5 rounded">localStorage</code>. It is never logged or transmitted to third parties, only sent directly to GitHub to fetch your repositories.
                    </p>
                    <p className="mt-1 text-gray-400">
                      For server deployments, you can also set <code className="text-amber-400">GITHUB_TOKEN</code> in your environment variables for 100% server-side isolation.
                    </p>
                  </div>
                </div>
              </div>

              {/* Token Input */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  Personal Access Token (classic or fine-grained)
                </label>
                <input
                  type="password"
                  value={tokenInput}
                  onChange={(e) => {
                    setTokenInput(e.target.value);
                    if (e.target.value.length > 20) {
                      verify(e.target.value);
                    }
                  }}
                  placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-4 py-2.5 bg-[#0d1117] border-2 border-[#30363d] rounded-lg font-mono text-sm focus:outline-none focus:border-amber-400 text-white placeholder-gray-500"
                />
              </div>

              {/* Status */}
              {isVerifying && (
                <div className="flex items-center gap-2 text-xs text-amber-400 font-medium">
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  <span>Validating token with GitHub API...</span>
                </div>
              )}

              {verifiedUser && (
                <div className="flex items-center gap-3 p-3 bg-emerald-950/40 border-2 border-emerald-600/60 rounded-lg text-emerald-200 text-xs">
                  <img
                    src={verifiedUser.avatar_url}
                    alt={verifiedUser.login}
                    className="w-8 h-8 rounded-full border border-emerald-500"
                  />
                  <div>
                    <div className="flex items-center gap-1 font-bold text-emerald-300">
                      <CheckCircle className="w-4 h-4 text-emerald-400" />
                      <span>Authenticated as @{verifiedUser.login}</span>
                    </div>
                    <span className="text-emerald-400">Private repository access active</span>
                  </div>
                </div>
              )}

              {verifyError && (
                <div className="flex items-start gap-2 p-3 bg-red-950/40 border-2 border-red-700/60 rounded-lg text-red-200 text-xs">
                  <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span>{verifyError}</span>
                </div>
              )}

              {/* Auto-inject */}
              <div className="flex items-center justify-between pt-1">
                <label className="flex items-center gap-2 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={autoInject}
                    onChange={(e) => setAutoInject(e.target.checked)}
                    className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                  />
                  <span className="text-xs font-semibold text-gray-200">
                    Auto-inject token for all private repos
                  </span>
                </label>

                <a
                  href="https://github.com/settings/tokens/new?description=GitIngest-Personal&scopes=repo"
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-amber-400 hover:text-amber-300 underline flex items-center gap-1 font-medium"
                >
                  <span>New token</span>
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          ) : (
            /* Owner Lock Tab */
            <div className="space-y-4">
              <div className="text-xs leading-relaxed bg-[#0d1117] p-3.5 rounded-lg border-2 border-[#30363d] text-gray-300">
                <div className="flex items-start gap-2">
                  <Lock className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                  <div>
                    <span className="font-bold text-white">Block anyone who isn&apos;t you:</span>
                    <p className="mt-1">
                      Enforce passcode protection across all devices. Any device or visitor must enter the owner passcode to access the instance.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-between p-3.5 bg-[#0d1117] border-2 border-[#30363d] rounded-lg">
                <div>
                  <span className="text-xs font-bold text-white block">Enforce Passcode Lock (All Devices)</span>
                  <span className="text-[11px] text-gray-400">Lock out unauthorized visitors and other devices</span>
                </div>
                <input
                  type="checkbox"
                  checked={lockActive}
                  onChange={(e) => setLockActive(e.target.checked)}
                  className="w-4 h-4 accent-amber-500 rounded cursor-pointer"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  Custom Owner PIN / Passphrase (Optional)
                </label>
                <input
                  type="password"
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value)}
                  placeholder="Enter custom PIN (default: honeypie3301)"
                  className="w-full px-4 py-2.5 bg-[#0d1117] border-2 border-[#30363d] rounded-lg font-mono text-sm focus:outline-none focus:border-amber-400 text-white placeholder-gray-500"
                />
                <p className="text-[11px] text-gray-400 mt-1.5">
                  Master fallback passcode is <code className="text-amber-400 font-mono">honeypie3301</code>. You can set an additional custom PIN here.
                </p>
              </div>

              {lockActive ? (
                <div className="p-3 bg-amber-950/40 border-2 border-amber-600/60 rounded-lg text-amber-200 text-xs flex items-center gap-2">
                  <Lock className="w-4 h-4 text-amber-400 shrink-0" />
                  <span>Owner Lock is active. Testing from another device or incognito will require the passcode.</span>
                </div>
              ) : (
                <div className="p-3 bg-gray-800/60 border-2 border-gray-700 rounded-lg text-gray-300 text-xs flex items-center gap-2">
                  <Unlock className="w-4 h-4 text-gray-400 shrink-0" />
                  <span>Owner Lock is disabled (open public access).</span>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center justify-between gap-4 pt-5 mt-6 border-t-2 border-[#30363d]">
            {tokenInput ? (
              <button
                type="button"
                onClick={handleClear}
                className="px-4 py-2 border-2 border-red-900/60 rounded-lg text-xs font-bold bg-red-950/40 text-red-300 hover:bg-red-900/60 transition-colors"
              >
                Clear Token
              </button>
            ) : (
              <div></div>
            )}

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 border-2 border-[#30363d] rounded-lg text-xs font-bold bg-[#21262d] text-gray-300 hover:bg-[#30363d] transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                className="px-5 py-2 border-2 border-amber-500 rounded-lg text-xs font-bold bg-amber-500 text-gray-950 hover:bg-amber-400 transition-colors brutal-shadow-sm font-mono"
              >
                Save Settings
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
