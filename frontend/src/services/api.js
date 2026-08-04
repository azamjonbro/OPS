// Dynamic API Base URL for Localhost & Vercel Production Deployments
export const getApiBase = () => {
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  // If running on localhost
  if (typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return 'http://localhost:4000';
  }
  // Default production API host for deployed frontend
  return 'https://ops.techinfo.uz';
};

export const API_BASE = getApiBase();
