/// <reference types="vite/client" />

interface Window {
  __onGCastApiAvailable?: (available: boolean) => void;
  cast?: any;
  chrome?: any;
}
