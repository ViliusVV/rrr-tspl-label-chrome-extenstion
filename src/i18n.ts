export type Lang = 'en' | 'lt';

export const SUPPORTED_LANGS: Lang[] = ['en', 'lt'];

type Dict = Record<string, string>;

const en: Dict = {
  app_title: 'Label printer',
  width_mm: 'Width (mm)',
  height_mm: 'Height (mm)',
  copies: 'Copies',
  auto_fit: 'Auto-fit label',
  advanced: 'Advanced',
  gap_mm: 'Gap (mm)',
  density: 'Density',
  speed: 'Speed',
  baud: 'Baud',
  threshold: 'Threshold',
  language: 'Language',
  change_port: 'Change port',
  connect_printer: 'Connect printer',
  print: 'Print',
  reset_view: 'Reset zoom and pan',
  reset_view_label: '100%',
  rotate_90: '⟳ Rotate 90°',
  rotate_90_title: 'Rotate 90°',
  label_preview_alt: 'Label preview',

  status_initialising: 'Initialising…',
  status_click_connect: 'Click "Connect printer" to choose a COM port.',
  status_connected: 'Printer connected. Ready.',
  status_no_port: 'No printer connected',
  status_capturing: 'Capturing SVG…',
  status_rasterising: 'Rasterising {svgW}x{svgH} → {dotsW}x{dotsH}…',
  status_sending: 'Sending {n} bytes to printer…',
  status_sent: 'Sent {n} bytes. Done.',
  status_init_failed: 'Init failed: {message}',
  status_connect_tab_failed: 'Could not open connect tab: {message}',
  error_no_active_tab: 'No active tab',

  preview_loading: 'Loading preview…',
  preview_info: 'Preview: {svgW}x{svgH} → {dotsW}x{dotsH} dots ({mode})',
  preview_mode_auto: 'auto-fit',
  preview_mode_manual: 'manual',
  preview_invalid_dim: 'Enter valid label width and height.',
  preview_rasterise_failed: 'Rasterise failed: {message}',

  connect_title: 'Connect your printer',
  connect_instructions:
    "Click below, then pick your printer's COM port from the system dialog. The tab will close itself after you connect.",
  pick_port: 'Pick port',
  connect_success: 'Connected. Closing tab…',
  connect_success_no_close: 'Connected. You can close this tab.',
  connect_cancelled: 'No port selected. Click "Pick port" to try again.',
};

const lt: Dict = {
  app_title: 'Etikečių spausdintuvas',
  width_mm: 'Plotis (mm)',
  height_mm: 'Aukštis (mm)',
  copies: 'Kopijos',
  auto_fit: 'Pritaikyti automatiškai',
  advanced: 'Išplėstiniai',
  gap_mm: 'Tarpas (mm)',
  density: 'Tankis',
  speed: 'Greitis',
  baud: 'Sparta',
  threshold: 'Slenkstis',
  language: 'Kalba',
  change_port: 'Keisti prievadą',
  connect_printer: 'Prijungti spausdintuvą',
  print: 'Spausdinti',
  reset_view: 'Atstatyti vaizdą',
  reset_view_label: '100%',
  rotate_90: '⟳ Pasukti 90°',
  rotate_90_title: 'Pasukti 90°',
  label_preview_alt: 'Etiketės peržiūra',

  status_initialising: 'Inicializuojama…',
  status_click_connect: 'Spauskite „Prijungti spausdintuvą“ ir pasirinkite COM prievadą.',
  status_connected: 'Spausdintuvas prijungtas. Pasirengę.',
  status_no_port: 'Spausdintuvas neprijungtas',
  status_capturing: 'Užfiksuojama SVG…',
  status_rasterising: 'Konvertuojama {svgW}x{svgH} → {dotsW}x{dotsH}…',
  status_sending: 'Siunčiama {n} baitų į spausdintuvą…',
  status_sent: 'Išsiųsta {n} baitų. Atlikta.',
  status_init_failed: 'Nepavyko inicializuoti: {message}',
  status_connect_tab_failed: 'Nepavyko atidaryti prijungimo skirtuko: {message}',
  error_no_active_tab: 'Nėra aktyvaus skirtuko',

  preview_loading: 'Įkeliama peržiūra…',
  preview_info: 'Peržiūra: {svgW}x{svgH} → {dotsW}x{dotsH} taškų ({mode})',
  preview_mode_auto: 'automatinis',
  preview_mode_manual: 'rankinis',
  preview_invalid_dim: 'Įveskite teisingą etiketės plotį ir aukštį.',
  preview_rasterise_failed: 'Konvertavimas nepavyko: {message}',

  connect_title: 'Prijunkite spausdintuvą',
  connect_instructions:
    'Spauskite mygtuką ir pasirinkite spausdintuvo COM prievadą iš sistemos lango. Skirtukas automatiškai užsidarys.',
  pick_port: 'Pasirinkti prievadą',
  connect_success: 'Prijungta. Užsidaroma…',
  connect_success_no_close: 'Prijungta. Galite uždaryti šį skirtuką.',
  connect_cancelled: 'Prievadas nepasirinktas. Spauskite „Pasirinkti prievadą“ ir bandykite vėl.',
};

const DICTS: Record<Lang, Dict> = { en, lt };

let currentLang: Lang = 'en';

export function setLang(lang: Lang): void {
  currentLang = SUPPORTED_LANGS.includes(lang) ? lang : 'en';
}

export function getLang(): Lang {
  return currentLang;
}

export function detectBrowserLang(): Lang {
  const ui = (chrome.i18n?.getUILanguage?.() ?? navigator.language ?? 'en').toLowerCase();
  return ui.startsWith('lt') ? 'lt' : 'en';
}

export function t(key: string, params?: Record<string, string | number>): string {
  let s = DICTS[currentLang][key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      s = s.split(`{${k}}`).join(String(v));
    }
  }
  return s;
}

export function applyI18nToDom(root: ParentNode = document): void {
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n!;
    el.textContent = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = el.dataset.i18nTitle!;
    el.title = t(key);
  }
  for (const el of root.querySelectorAll<HTMLElement>('[data-i18n-alt]')) {
    const key = el.dataset.i18nAlt!;
    el.setAttribute('alt', t(key));
  }
  if (document.documentElement.dataset.i18nTitle) {
    document.title = t(document.documentElement.dataset.i18nTitle);
  }
}
