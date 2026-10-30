import React from 'react';
import { Download, Box, Github } from 'lucide-react';
import { REPO_URL } from '../data/links';

interface NavbarProps {
  currentPath: string;
  navigate: (path: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ currentPath, navigate }) => {
  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#2a2a30] bg-[#121214]/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        {/* Brand */}
        <div 
          onClick={() => navigate('/')} 
          className="flex items-center gap-3 cursor-pointer group"
        >
          <div className="w-8 h-8 rounded-lg bg-black border border-white/15 flex items-center justify-center group-hover:scale-105 group-hover:border-white/30 transition-all p-1">
            <svg viewBox="20 20 60 60" className="w-5 h-5" aria-hidden="true">
              <path d="M29 30 L50 54 L71 30" fill="none" stroke="#f8fafc" strokeWidth="12" strokeLinecap="round" strokeLinejoin="round" />
              <rect x="37" y="67" width="26" height="9" rx="2.5" fill="#F59E0B" />
            </svg>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-lg text-white tracking-tight">Vedara</span>
          </div>
        </div>

        {/* Links */}
        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#858585]">
          <button 
            onClick={() => navigate('/')} 
            className={`hover:text-white transition-colors ${currentPath === '/' ? 'text-white font-semibold' : ''}`}
          >
            Features
          </button>
          <button 
            onClick={() => navigate('/models')} 
            className={`flex items-center gap-1.5 hover:text-white transition-colors ${currentPath.startsWith('/models') ? 'text-white font-semibold' : ''}`}
          >
            <Box className="w-4 h-4 text-[#4ec9b0]" />
            <span>Models</span>
          </button>
        </nav>

        {/* Action CTAs */}
        <div className="flex items-center gap-3">
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            className="p-2 text-[#858585] hover:text-white transition-colors rounded-lg hover:bg-[#1a1a1e]"
            title="GitHub Repository"
          >
            <Github className="w-5 h-5" />
          </a>

          <button
            onClick={() => navigate('/models')}
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#1a1a1e] border border-[#2a2a30] hover:border-[#007acc] text-white rounded-lg transition-colors"
          >
            <Box className="w-3.5 h-3.5 text-[#4ec9b0]" />
            <span>Models</span>
          </button>

          <a
            href="#download"
            onClick={(e) => {
              if (currentPath !== '/') {
                e.preventDefault();
                navigate('/');
                setTimeout(() => {
                  document.getElementById('download')?.scrollIntoView({ behavior: 'smooth' });
                }, 100);
              }
            }}
            className="flex items-center gap-2 px-3.5 py-1.5 text-xs font-semibold bg-[#007acc] hover:bg-[#0062a3] text-white rounded-lg shadow-md shadow-blue-500/20 transition-all hover:shadow-blue-500/30"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Get Started</span>
          </a>
        </div>
      </div>
    </header>
  );
};
