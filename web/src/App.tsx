import { useEffect, useState } from 'react';
import { api, type Config } from './api.js';
import { CalendarPage } from './components/CalendarPage.js';
import { MinePage } from './components/MinePage.js';
import { AdminPage } from './components/AdminPage.js';

export type Route = '/' | '/mine' | '/admin';

function currentRoute(): Route {
  const p = window.location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/owner' || p === '/admin') return '/admin'; // 예전 주소 /owner 도 관리자 화면으로
  return p === '/mine' ? p : '/';
}

export function navigate(to: Route) {
  window.history.pushState(null, '', to);
  window.dispatchEvent(new PopStateEvent('popstate'));
  window.scrollTo(0, 0);
}

export function App() {
  const [route, setRoute] = useState<Route>(currentRoute);
  const [config, setConfig] = useState<Config | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRoute(currentRoute());
    window.addEventListener('popstate', on);
    return () => window.removeEventListener('popstate', on);
  }, []);

  const load = () => {
    setError(null);
    api
      .config()
      .then((c) => {
        setConfig(c);
        document.title = c.title;
      })
      .catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  if (error) {
    return (
      <main className="page">
        <div className="notice notice--error" role="alert">
          <p>{error}</p>
          <button className="btn" onClick={load}>다시 시도</button>
        </div>
      </main>
    );
  }
  if (!config) return <main className="page" aria-busy="true" />;

  if (route === '/admin') return <AdminPage config={config} />;
  if (route === '/mine') return <MinePage config={config} />;
  return <CalendarPage config={config} />;
}
