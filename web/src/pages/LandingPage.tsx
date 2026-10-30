import React from 'react';
import { Download, Zap, GitBranch, Layers, Search, Box, FlaskConical, Code2 } from 'lucide-react';
import { REPO_URL } from '../data/links';

interface LandingPageProps {
  navigate: (path: string) => void;
}

const FEATURES = [
  {
    icon: <Zap className="w-5 h-5 text-[#dcdcaa]" />,
    title: 'Inline autocomplete',
    body: 'Fill-in-the-middle ghost text from a small local model (default qwen2.5-coder:1.5b). Latency depends on your hardware; measure it with npm run benchmark:ollama.',
  },
  {
    icon: <Layers className="w-5 h-5 text-[#4ec9b0]" />,
    title: 'SEARCH/REPLACE edits',
    body: 'The model returns small SEARCH/REPLACE blocks instead of rewriting whole files. Blocks are matched exactly, by line hint, or ignoring whitespace, and you review each change before it is applied.',
  },
  {
    icon: <GitBranch className="w-5 h-5 text-[#ce9178]" />,
    title: 'Shadow Git checkpoints (desktop)',
    body: 'Before an AI edit, the desktop IDE snapshots your files into refs/ai-checkpoints/ without touching your branch or history, so you can restore a file or a whole change set.',
  },
  {
    icon: <Search className="w-5 h-5 text-[#9cdcfe]" />,
    title: '@codebase search (desktop)',
    body: 'Typing @codebase in chat pulls matching snippets from a local BM25 keyword index of your workspace into the prompt.',
  },
];

export const LandingPage: React.FC<LandingPageProps> = ({ navigate }) => {
  return (
    <div className="flex flex-col items-center w-full">
      {/* Hero */}
      <section className="w-full max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-16 text-center flex flex-col items-center">
        <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight text-white leading-tight">
          Local AI coding with Ollama.
        </h1>
        <p className="mt-6 text-base sm:text-lg text-[#858585] max-w-2xl leading-relaxed">
          Vedara is a VS Code extension, and an experimental desktop IDE, for autocomplete, chat and reviewed
          SEARCH/REPLACE edits using models running on your own machine through Ollama. No accounts, no telemetry.
        </p>

        <div className="mt-8 flex flex-col sm:flex-row items-center gap-4">
          <a
            href="#download"
            className="w-full sm:w-auto px-6 py-3 text-sm font-semibold bg-[#007acc] hover:bg-[#0062a3] text-white rounded-xl flex items-center justify-center gap-2"
          >
            <Download className="w-4 h-4" />
            <span>Get Started</span>
          </a>
          <button
            onClick={() => navigate('/models')}
            className="w-full sm:w-auto px-6 py-3 text-sm font-semibold bg-[#1a1a1e] hover:bg-[#25252a] text-white border border-[#2a2a30] rounded-xl flex items-center justify-center gap-2"
          >
            <Box className="w-4 h-4 text-[#4ec9b0]" />
            <span>Recommended Models</span>
          </button>
        </div>

        <p className="mt-8 text-xs text-[#858585] max-w-2xl">
          What stays local: your code and prompts go only to the Ollama endpoint you configure (localhost by default).
          What doesn&apos;t: <code>ollama pull</code> downloads model weights from Ollama&apos;s registry, and links to
          documentation open in your browser.
        </p>
      </section>

      {/* Features */}
      <section id="features" className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-16 space-y-10">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight text-center">What works today</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-[#1a1a1e] p-6 rounded-2xl border border-[#2a2a30] space-y-3">
              <div className="w-10 h-10 rounded-xl bg-[#121214] border border-[#2a2a30] flex items-center justify-center">{f.icon}</div>
              <h3 className="text-base font-bold text-white">{f.title}</h3>
              <p className="text-xs text-[#858585] leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
        <div className="bg-[#161619] p-5 rounded-2xl border border-[#2a2a30] flex items-start gap-3 text-xs text-[#858585]">
          <FlaskConical className="w-5 h-5 text-amber-400 shrink-0" />
          <p className="leading-relaxed">
            <span className="text-white font-semibold">Experimental / roadmap:</span> vector search and re-ranking, LSP
            integration, MCP tool calling, the plugin API and the policy/audit features exist in the codebase but are
            incomplete or not exposed in the UI yet. The project README lists exactly what is and isn&apos;t wired up.
          </p>
        </div>
      </section>

      {/* Get started */}
      <section id="download" className="w-full bg-[#161619] border-y border-[#2a2a30] py-16">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 space-y-8">
          <h2 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight text-center">Get started</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-[#1a1a1e] p-6 rounded-2xl border border-[#2a2a30] space-y-3">
              <div className="flex items-center gap-2">
                <Code2 className="w-5 h-5 text-[#007acc]" />
                <h3 className="text-base font-bold text-white">VS Code extension</h3>
              </div>
              <p className="text-xs text-[#858585] leading-relaxed">
                Autocomplete, a chat sidebar and previewed SEARCH/REPLACE edits inside VS Code. Build it from{' '}
                <code>extensions/vscode</code> in the repository and install the generated <code>.vsix</code>.
              </p>
              <a href={`${REPO_URL}/tree/main/extensions/vscode`} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-[#4ec9b0] hover:underline">
                Extension README →
              </a>
            </div>
            <div className="bg-[#1a1a1e] p-6 rounded-2xl border border-[#2a2a30] space-y-3">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-amber-400" />
                <h3 className="text-base font-bold text-white">Desktop IDE (experimental)</h3>
              </div>
              <p className="text-xs text-[#858585] leading-relaxed">
                A Tauri app with a Monaco editor, terminal, chat, diff review and Git checkpoints. It&apos;s early and
                not part of the first release, so there are no installers yet: run it from source with{' '}
                <code>npm run tauri dev</code>.
              </p>
              <a href={`${REPO_URL}#desktop-ide-experimental`} target="_blank" rel="noreferrer" className="inline-block text-xs font-semibold text-[#4ec9b0] hover:underline">
                Run from source →
              </a>
            </div>
          </div>
          <div className="bg-[#121214] p-4 rounded-xl border border-[#2a2a30] font-mono text-xs text-[#cccccc] space-y-1">
            <div className="text-[#858585]"># Both need Ollama running locally with these models pulled:</div>
            <div>ollama pull qwen2.5-coder:1.5b   <span className="text-[#858585]"># autocomplete</span></div>
            <div>ollama pull qwen2.5-coder:7b     <span className="text-[#858585]"># chat and edits</span></div>
          </div>
        </div>
      </section>
    </div>
  );
};
