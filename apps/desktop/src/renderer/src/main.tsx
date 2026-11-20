import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './styles.css';

// Design preview at #/preview: isolated from the app, no query client, no IPC.
const Preview = lazy(() => import('./preview/PreviewApp'));
const preview = location.hash.startsWith('#/preview');

// TanStack Query here caches IPC calls to the main process (there is no web server).
// Invalidate the 'league' keys after anything that changes the save, e.g. simming.
const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: Infinity, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {preview ? (
      <Suspense fallback={null}>
        <Preview />
      </Suspense>
    ) : (
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    )}
  </StrictMode>,
);
