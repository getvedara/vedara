import React, { useState, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { Footer } from './components/Footer';
import { LandingPage } from './pages/LandingPage';
import { ModelHubPage } from './pages/ModelHubPage';
import { ModelDetailPage } from './pages/ModelDetailPage';

export const App: React.FC = () => {
  const [currentPath, setCurrentPath] = useState<string>('/');

  useEffect(() => {
    const handlePopState = () => {
      setCurrentPath(window.location.pathname || '/');
    };

    // Initial path
    handlePopState();
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigate = (path: string) => {
    window.history.pushState({}, '', path);
    setCurrentPath(path);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Simple client-side routing
  let pageContent: React.ReactNode;
  if (currentPath === '/') {
    pageContent = <LandingPage navigate={navigate} />;
  } else if (currentPath === '/models' || currentPath === '/models/') {
    pageContent = <ModelHubPage navigate={navigate} />;
  } else if (currentPath.startsWith('/models/')) {
    const modelId = decodeURIComponent(currentPath.replace('/models/', ''));
    pageContent = <ModelDetailPage modelId={modelId} navigate={navigate} />;
  } else {
    pageContent = <LandingPage navigate={navigate} />;
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#121214] text-[#cccccc]">
      <Navbar currentPath={currentPath} navigate={navigate} />
      <main className="flex-1 w-full flex flex-col">
        {pageContent}
      </main>
      <Footer />
    </div>
  );
};
export default App;
