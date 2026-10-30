import React from 'react';
import { REPO_URL } from '../data/links';

export const Footer: React.FC = () => {
  return (
    <footer className="w-full border-t border-[#2a2a30] bg-[#121214] py-12 text-xs text-[#858585]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Col 1 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[#007acc] flex items-center justify-center text-white font-bold text-xs">
                OS
              </div>
              <span className="font-bold text-white text-sm">Vedara</span>
            </div>
            <p className="text-[11px] leading-relaxed text-[#858585]">
              Local AI coding with Ollama: a VS Code extension and an experimental desktop IDE. No telemetry; your code is
              sent only to the Ollama endpoint you configure.
            </p>
          </div>

          {/* Col 2 */}
          <div className="space-y-2">
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider">Ecosystem</h4>
            <ul className="space-y-1.5 text-[11px]">
              <li><a href="#download" className="hover:text-white transition-colors">VS Code Extension</a></li>
              <li><a href="#download" className="hover:text-white transition-colors">Desktop IDE (experimental)</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">SEARCH/REPLACE Diffs</a></li>
              <li><a href="#features" className="hover:text-white transition-colors">Shadow Git Checkpoints</a></li>
            </ul>
          </div>

          {/* Col 3 */}
          <div className="space-y-2">
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider">Models</h4>
            <p className="text-[11px] leading-relaxed">
              Vedara uses models you pull with Ollama. It does not host, re-package or sign model weights.
            </p>
          </div>

          {/* Col 4 */}
          <div className="space-y-2">
            <h4 className="text-white font-semibold text-xs uppercase tracking-wider">Privacy</h4>
            <p className="text-[11px] leading-relaxed">
              No accounts and no telemetry. Pulling a model downloads it from Ollama&apos;s registry; after that, inference
              runs on your machine.
            </p>
          </div>
        </div>

        <div className="pt-8 border-t border-[#2a2a30]/60 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-[11px]">
            &copy; {new Date().getFullYear()} Vedara Contributors. Open Source under Apache-2.0.
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <a href={`${REPO_URL}/blob/main/PRIVACY.md`} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              Privacy
            </a>
            <span>•</span>
            <a href={`${REPO_URL}/blob/main/SECURITY.md`} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              Security Policy
            </a>
            <span>•</span>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="hover:text-white transition-colors">
              GitHub
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
};
