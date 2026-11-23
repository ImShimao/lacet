// Le relais de Lacet sur Cloudflare (`cloudflare/worker.js`) : les archives de
// rues, rangées dans R2, et le vent, demandé à MET Norway. `VITE_RELAY_URL`
// le remplace, pour essayer un autre déploiement sans toucher au code.
export const RELAY_URL = import.meta.env?.VITE_RELAY_URL || 'https://lacet.gibiinovincenzo679.workers.dev'
