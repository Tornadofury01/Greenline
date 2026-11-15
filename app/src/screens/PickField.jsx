// Screen 1, plat-book world: the 300 Ellis County study fields drawn like a county plat book (aerial photo printed
// on atlas paper, parcels ruled in ink and lettered with their number and acres). Picking a parcel inks it in and
// turns the side column (a bottom sheet on phones) to that field's plat page.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Layers, Mountain, Wheat, MapPin, ArrowRight, WifiOff, Lock, LocateFixed, LoaderCircle, TriangleAlert, RotateCw,
  Plus, Minus, Scan, X, ChevronUp, ChevronDown, Compass, ArrowLeft, BookMarked,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { Receipt } from '../components/Small.jsx';
import TextMorph from '../components/TextMorph.jsx';
import { slopeWord } from '../display.js';
import { fieldOutlines, outlineFor, mapLayers, insideStudyArea, nearestTo, fieldIndex } from '../data/loadField.js';
import { nearestTownTo } from '../data/geocode.js';
import MapSearch, { SearchPrivacy } from '../components/MapSearch.jsx';
import { cropThisYear } from '../si.js';

const FAR_KM = 25; // beyond this the nearest sampled field is probably not like the farmer's field
// GPS error code -> which message to show (1 denied, 2 unavailable, 3 timeout).
const GEO_ERROR = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

// The 300 Field Shift study fields: public USDA field outlines within ~4 km of 32.25 N, 96.75 W (Ellis County, TX).
const OUTLINES = fieldOutlines();
// Where each parcel's lettering sits: the average of its outer ring's corners.
const CENTER = new Map(OUTLINES.map((f) => {
  const r = f.rings[0];
  return [f.id, [r.reduce((s, p) => s + p[0], 0) / r.length, r.reduce((s, p) => s + p[1], 0) / r.length]];
}));
const FRAME = L.latLngBounds(mapLayers.frame);
const HULL_BOUNDS = L.latLngBounds(mapLayers.studyHull);
// Everything outside the study area fades to paper: a world-sized polygon with the study hull cut out.
const WORLD = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
// Public-domain, label-free imagery from the USGS National Map (cache stops at zoom 16; Leaflet stretches beyond).
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const CLOSE_DRAG_PX = 70;  // drag the sheet down this far to fold it away
const OUTLINE_ZOOM = 12;   // below this zoom the 300 parcels collapse into one "300 fields" stamp
const LETTER_ZOOM = 14.5;  // from this zoom each parcel is lettered with its number and acres
const TOWN_ZOOM = { 1: 9, 2: 10, 3: 10.5 };
const EASE = [0.16, 1, 0.3, 1];

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const letterIcon = (html, cls, dx = 0, dy = 0) => L.divIcon({
  className: 'plat-icon', iconSize: [0, 0],
  html: `<span class="plat-lettering ${cls}" style="margin-left:${dx}px;margin-top:${dy}px">${html}</span>`,
});
const TOWN_ICONS = new Map();
const townIcon = (tw, [dx, dy]) => {
  const k = `${tw.geoid}:${dx}:${dy}`;
  if (!TOWN_ICONS.has(k)) TOWN_ICONS.set(k, letterIcon(esc(tw.name), `plat-town tier-${tw.tier}`, dx, dy));
  return TOWN_ICONS.get(k);
};

// County boundary sample points, for placing the "Ellis County" lettering.
const COUNTY_POINTS = mapLayers.county.flatMap((ring) => ring.flatMap((pt, i) => {
  const nx = ring[(i + 1) % ring.length];
  return [0, 0.25, 0.5, 0.75].map((f) => [pt[0] + (nx[0] - pt[0]) * f, pt[1] + (nx[1] - pt[1]) * f]);
}));

// Place town / county / study-area lettering so none overlaps another, the stamp, or anything floating over the map
// (every element marked data-map-ui). Biggest towns first; lettering that doesn't fit is skipped.
function usePlacedLabels(zoom, countyText, hullText) {
  const map = useMap();
  const [placed, setPlaced] = useState({ towns: new Map(), county: null, hull: false });
  useEffect(() => {
    const place = () => {
      const z = map.getZoom();
      const box = map.getContainer().getBoundingClientRect();
      const W = box.width; const H = box.height;
      const hit = (b, o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1];
      const boxes = [...document.querySelectorAll('[data-map-ui]')]
        .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height)
        .map((r) => [r.left - box.left - 6, r.top - box.top - 6, r.right - box.left + 6, r.bottom - box.top + 6]);
      const fits = (b) => b[0] >= 18 && b[1] >= 18 && b[2] <= W - 18 && b[3] <= H - 18 && !boxes.some((o) => hit(b, o));
      const c = map.latLngToContainerPoint(mapLayers.studyCenter);
      if (z < OUTLINE_ZOOM) boxes.push([c.x - 60, c.y - 45, c.x + 60, c.y + 45]);
      let hull = false;
      if (z >= OUTLINE_ZOOM) {
        const h = map.latLngToContainerPoint(mapLayers.studyLabel);
        const w = hullText.length * 8 + 16;
        const hb = [h.x - w / 2, h.y - 30, h.x + w / 2, h.y - 8];
        if (fits(hb)) { boxes.push(hb); hull = true; }
      }
      const towns = new Map();
      [...mapLayers.towns].sort((x, y) => x.tier - y.tier).forEach((tw) => {
        if (z < TOWN_ZOOM[tw.tier]) return;
        const pt = map.latLngToContainerPoint([tw.lat, tw.lon]);
        const w = tw.name.length * (tw.tier === 1 ? 12 : 11) + 8;
        for (const [dx, dy] of [[0, 0], [w / 2 + 6, 0], [-w / 2 - 6, 0], [0, -20], [0, 20]]) {
          const tb = [pt.x + dx - w / 2, pt.y + dy - 10, pt.x + dx + w / 2, pt.y + dy + 10];
          if (!fits(tb)) continue;
          boxes.push(tb);
          towns.set(tw.geoid, [Math.round(dx), dy]);
          break;
        }
      });
      let county = null;
      if (z < 13) {
        const w = countyText.length * 8 + 8;
        let best = Infinity;
        for (const ll of COUNTY_POINTS) {
          const pt = map.latLngToContainerPoint(ll);
          const cb = [pt.x - w / 2, pt.y - 11, pt.x + w / 2, pt.y + 11];
          const d = (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2;
          if (d < best && fits(cb)) { best = d; county = ll; }
        }
      }
      setPlaced({ towns, county, hull });
    };
    place();
    map.on('zoomend moveend resize', place);
    return () => { map.off('zoomend moveend resize', place); };
  }, [map, zoom, countyText, hullText]);
  return placed;
}

function MapContext({ zoom, t, onCluster }) {
  const placed = usePlacedLabels(zoom, t('pick.countyLabel'), t('pick.hullLabel'));
  const icons = useMemo(() => ({
    county: letterIcon(esc(t('pick.countyLabel')), 'plat-county-label'),
    hull: letterIcon(esc(t('pick.hullLabel')), 'plat-hull-label'),
    stamp: L.divIcon({ className: 'plat-icon', iconSize: [0, 0], html: `<span class="plat-stamp"><b>${OUTLINES.length}</b><small>${esc(t('pick.clusterUnit'))}</small></span>` }),
  }), [t]);
  return (
    <>
      <Polygon positions={[WORLD, mapLayers.studyHull]} className="plat-mask" interactive={false} />
      {mapLayers.county.map((ring, i) => <Polyline key={i} positions={[...ring, ring[0]]} className="plat-county" interactive={false} />)}
      <Polygon positions={mapLayers.studyHull} className="plat-hull" interactive={false} />
      {mapLayers.towns.map((tw) => placed.towns.has(tw.geoid) && (
        <Marker key={tw.geoid} position={[tw.lat, tw.lon]} icon={townIcon(tw, placed.towns.get(tw.geoid))} interactive={false} keyboard={false} />
      ))}
      {placed.county && <Marker position={placed.county} icon={icons.county} interactive={false} keyboard={false} />}
      {placed.hull && <Marker position={mapLayers.studyLabel} icon={icons.hull} interactive={false} keyboard={false} />}
      {zoom < OUTLINE_ZOOM && (
        <Marker position={mapLayers.studyCenter} icon={icons.stamp} title={t('pick.clusterTap')} alt={t('pick.clusterTap')}
          eventHandlers={{ click: onCluster }} />
      )}
    </>
  );
}

function ZoomWatch({ onZoom }) {
  const map = useMapEvents({ zoomend: () => onZoom(map.getZoom()) });
  useEffect(() => { onZoom(map.getZoom()); }, [map, onZoom]);
  return null;
}

// The parcels. A tap inside one loads exactly that field and does not reach the map's own tap handler.
// The selected parcel gets pathLength=1 so CSS can draw its outline in like a pen (.plat-parcel.is-selected).
function Parcels({ selectedId, onPick, all }) {
  return OUTLINES.filter((f) => all || f.id === selectedId).map((f) => {
    const on = f.id === selectedId;
    return (
      // className must be a direct prop (react-leaflet's setStyle ignores it); the key re-creates the shape on select.
      <Polygon key={`${f.id}${on ? '-on' : ''}`} positions={f.rings}
        className={on ? 'plat-parcel is-selected' : 'plat-parcel'}
        bubblingMouseEvents={false}
        eventHandlers={{
          click: () => onPick(f.id),
          add: on ? (e) => e.target.getElement?.()?.setAttribute('pathLength', '1') : undefined,
        }} />
    );
  });
}

// Plat lettering inside each parcel in view: its number, and its acres beneath.
function ParcelLetters({ zoom, t }) {
  const map = useMap();
  const [view, setView] = useState(null);
  useEffect(() => {
    const update = () => setView(map.getBounds().pad(0.05));
    update();
    map.on('moveend zoomend', update);
    return () => { map.off('moveend zoomend', update); };
  }, [map]);
  const icons = useMemo(() => new Map(OUTLINES.map((f) => [f.id, L.divIcon({
    className: 'plat-icon', iconSize: [0, 0],
    html: `<span class="plat-lettering plat-parcel-label"><span>${esc(f.id)}</span><small>${esc(t('pick.acresShort', { acres: Math.round(f.acres) }))}</small></span>`,
  })])), [t]);
  if (zoom < LETTER_ZOOM || !view) return null;
  return OUTLINES.filter((f) => view.contains(CENTER.get(f.id))).map((f) => (
    <Marker key={f.id} position={CENTER.get(f.id)} icon={icons.get(f.id)} interactive={false} keyboard={false} />
  ));
}

function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
}

export function Fact({ icon: Icon, tone, label, value, detail, term }) {
  return (
    <div className="fact">
      <span className={`fact-icon ${tone || ''}`}><Icon size={20} aria-hidden="true" /></span>
      <div className="fact-body">
        <span className="fact-label">{label}{term && <GlossaryIcon term={term} />}</span>
        <span className="fact-value">{value}</span>
        {detail && <span className="fact-detail">{detail}</span>}
      </div>
    </div>
  );
}

// Plain-language field summary (used on the Expert handoff). Science details sit in the small grey lines.
export function FieldFacts({ field }) {
  const { t } = useApp();
  const { soil, terrain } = field;
  const recent = field.cropHistory.slice(-3).reverse();
  return (
    <div className="facts">
      <Fact icon={MapPin} label={t('pick.location')}
        value={t('pick.countyValue', { county: field.field.county, state: field.field.state })}
        detail={t('pick.cellDetail')} />
      <Fact icon={Layers} tone="soil" label={t('pick.soil')} term="hydrologicGroup"
        value={soil.texture
          ? t('pick.soilValue', { texture: t(`soil.texture.${soil.texture}`), drainage: soil.drainageClass ? t(`soil.drainage.${soil.drainageClass}`) : t('common.unknown') })
          : t('common.unknown')}
        detail={t('pick.soilDetail', { series: soil.seriesName ?? '–', om: soil.organicMatterPct ?? '–', group: soil.hydrologicGroup ?? '–' })} />
      <Fact icon={Mountain} label={t('pick.slope')} term="slope"
        value={t(`pick.slopeWord.${slopeWord(terrain.slopePct)}`)}
        detail={t('pick.slopeDetail', { pct: terrain.slopePct })} />
      <Fact icon={Wheat} tone="green" label={t('pick.recentCrops')}
        value={recent.map((h) => (h.crop === 'other' ? t(`si.cls.${h.cdlClass || 'other'}`) : t(`crops.${h.crop}`))).join(', ')}
        detail={recent.map((h) => h.year).join(', ')} />
    </div>
  );
}

// ---------- The plat page (side column / bottom sheet) ----------

// One ruled row of the field record: a tracked label and its value.
function RecordRow({ label, children, sub }) {
  return (
    <div>
      <dt className="plat-label pt-0.5 text-[12px] text-ink-soft">{label}</dt>
      <dd className="m-0 min-w-0 text-[16px] leading-snug text-ink">
        {children}
        {sub && <div className="mt-1 text-[14px] text-ink-soft">{sub}</div>}
      </dd>
    </div>
  );
}

// The crop on the field in the latest year, and how we know: USDA crop map, a model guess, or "not sure".
function CropRow({ field }) {
  const { t } = useApp();
  const c = cropThisYear(field);
  if (!c) return null;
  const crop = c.cropId ? t(`crops.${c.cropId}`) : t(`si.cls.${c.cls}`);
  const kind = c.notSure ? 'notSure' : c.source === 'usda' ? 'usda' : 'model';
  return (
    <RecordRow label={t('pick.cropLabel')}
      sub={<span className={`inline-block border px-1.5 py-0.5 text-[12px] font-medium ${c.notSure ? 'border-dashed border-caution text-caution' : 'border-rule-strong text-ink-soft'}`}>{t(`pick.cropSrc.${kind}`, { pct: c.pct ?? '–' })}</span>}>
      <Receipt src={['USDA Cropland Data Layer']}>{t('pick.cropThisYear', { crop, year: c.year })}</Receipt>
    </RecordRow>
  );
}

// A note on the plat page. Warnings get the caution ink and a ruled box; plain notes are just text.
function Note({ warn, icon: Icon = TriangleAlert, children, role }) {
  if (!warn) return <p className="text-[15px] leading-relaxed text-ink-soft" role={role}>{children}</p>;
  return (
    <p role={role} className="flex gap-2.5 border border-caution/60 bg-caution-soft px-3 py-2.5 text-[14px] leading-snug text-caution">
      <Icon size={18} className="mt-px flex-none" aria-hidden="true" /><span>{children}</span>
    </p>
  );
}

function Privacy() {
  const { t } = useApp();
  return (
    <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-soft">
      <Lock size={14} className="mt-0.5 flex-none" aria-hidden="true" /><span>{t('pick.privacy')}</span>
    </p>
  );
}

// The plat book's parcel index: every field by number with its acres, in two ruled columns. Also the keyboard
// route to every field (the map parcels are pointer targets only). Desktop column only; phones use the map.
function ParcelIndex({ t, onPick }) {
  const [biggest, setBiggest] = useState(false);
  const list = useMemo(() => (biggest ? [...OUTLINES].sort((a, b) => b.acres - a.acres) : OUTLINES), [biggest]);
  return (
    <section aria-labelledby="parcel-index-title" className="hidden min-h-0 flex-1 flex-col lg:flex">
      <div className="flex items-end justify-between border-b border-ink pb-2">
        <h2 id="parcel-index-title" className="m-0 font-display text-[22px] font-normal leading-none text-ink">{t('pick.indexTitle')}</h2>
        <div role="group" aria-label={t('pick.indexSort')} className="flex">
          {[false, true].map((b) => (
            <button key={String(b)} type="button" aria-pressed={biggest === b} onClick={() => setBiggest(b)}
              className={`plat-label min-h-9 border-0 bg-transparent px-2 text-[12px] ${biggest === b ? 'text-ink underline decoration-forest decoration-2 underline-offset-[5px]' : 'text-ink-soft hover:text-ink'}`}>
              {t(b ? 'pick.indexBySize' : 'pick.indexByNumber')}
            </button>
          ))}
        </div>
      </div>
      <ul className="m-0 grid min-h-[180px] flex-1 list-none grid-cols-2 content-start gap-x-6 overflow-y-auto p-0 pr-1">
        {list.map((f) => (
          <li key={f.id} className="border-b border-rule">
            <button type="button" onClick={() => onPick(f.id)}
              className="group flex min-h-10 w-full items-baseline justify-between gap-2 border-0 bg-transparent px-1 text-left text-[14px] text-ink hover:bg-highlight-soft focus-visible:bg-highlight-soft">
              <span className="font-semibold">{f.id}</span>
              <span className="text-ink-soft">{t('pick.acresShort', { acres: Math.round(f.acres) })}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function NorthArrow({ t }) {
  return (
    <p role="note" aria-label={t('pick.dallasAlt', { km: mapLayers.dallas.km })} data-map-ui
      className="flex items-center gap-2 border border-ink bg-paper-raised py-1.5 pl-2 pr-3 text-ink">
      <svg width="18" height="26" viewBox="0 0 18 26" aria-hidden="true">
        <path d="M9 1 L16 22 L9 17 L2 22 Z" fill="var(--color-paper-raised)" stroke="var(--color-ink)" strokeWidth="1.2" strokeLinejoin="round" />
        <path d="M9 1 L9 17 L2 22 Z" fill="var(--color-ink)" />
      </svg>
      <span className="flex flex-col leading-none">
        <span className="plat-label text-[12px]">{t('pick.dallasName')}</span>
        <span className="mt-1 text-[12px] text-ink-soft">{t('pick.dallasKm', { km: mapLayers.dallas.km })}</span>
      </span>
    </p>
  );
}

function MapKey({ t, onClose }) {
  const reduce = useReducedMotion();
  const rows = [
    ['legendHull', <svg key="h" width="28" height="14" aria-hidden="true"><rect x="1" y="1" width="26" height="12" fill="none" stroke="var(--color-ink)" strokeWidth="1.5" /></svg>],
    ['legendField', <svg key="f" width="28" height="14" aria-hidden="true"><path d="M2 12 L6 2 L26 3 L24 12 Z" fill="none" stroke="var(--color-ink)" strokeWidth="1" /></svg>],
    ['legendSelected', <svg key="s" width="28" height="14" aria-hidden="true"><path d="M2 12 L6 2 L26 3 L24 12 Z" fill="var(--color-highlight)" fillOpacity="0.7" stroke="var(--color-ink)" strokeWidth="2" /></svg>],
    ['legendCounty', <svg key="c" width="28" height="14" aria-hidden="true"><path d="M1 7 H27" stroke="var(--color-survey)" strokeWidth="1.5" strokeDasharray="7 3 2 3" /></svg>],
  ];
  return (
    <motion.div id="map-key" role="region" aria-label={t('pick.legendTitle')} data-map-ui
      initial={reduce ? false : { opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 8 }}
      transition={{ duration: 0.22, ease: EASE }}
      className="w-[min(300px,calc(100vw-120px))] border border-ink bg-paper-raised shadow-[0_10px_28px_-14px_rgb(30_26_18/0.45)]">
      <div className="flex items-center justify-between border-b border-ink py-1 pl-3">
        <strong className="plat-label text-[12px]">{t('pick.legendTitle')}</strong>
        <button type="button" className="plat-tool bg-transparent" aria-label={t('common.close')} onClick={onClose}><X size={18} aria-hidden="true" /></button>
      </div>
      <ul className="m-0 list-none px-3 py-1">
        {rows.map(([k, swatch]) => (
          <li key={k} className="flex items-center gap-3 border-b border-rule py-2.5 text-[14px] leading-snug text-ink last:border-b-0">
            <span className="flex-none">{swatch}</span>{t(`pick.${k}`)}
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

export default function PickField() {
  const { t, field, pickField, pickFieldById, clearField, pickNearest, retryLoad, loadError, loading, setScreen } = useApp();
  const online = useOnline();
  const reduce = useReducedMotion();
  const [map, setMap] = useState(null);
  // How the current field was picked ('tap' | 'gps' | 'outline' | 'search'). No coordinates are kept here.
  const [via, setVia] = useState('outline');
  const [geo, setGeo] = useState(null); // null | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef(null);
  const sheetRef = useRef(null);
  const topRef = useRef(null);
  const lookup = useRef(0);
  const [overviewReset, setOverviewReset] = useState(0);
  const [zoom, setZoom] = useState(11);
  const [legend, setLegend] = useState(false);
  // A tap outside the study area: { id, nearestKm, notCropland } of the nearest field (never the point itself).
  const [outside, setOutside] = useState(null);

  const tapPick = async (lat, lon) => {
    const request = ++lookup.current;
    setGeo(null); setOpen(true);
    if (insideStudyArea(lat, lon)) { setOutside(null); setVia('tap'); pickField(lat, lon); return; }
    const info = await nearestTo(lat, lon);
    if (request === lookup.current) setOutside(info);
  };
  const outlinePick = (id) => { lookup.current++; setVia('outline'); setGeo(null); setOutside(null); setOpen(true); pickFieldById(id); };
  const openNearest = () => { setVia(outside?.source === 'search' ? 'search' : 'tap'); pickNearest(outside); setOutside(null); };
  // A search result: fly there, then the same nearest-field logic as a map tap. The point is only passed through.
  const searchPick = async ({ lat, lon }) => {
    const request = ++lookup.current;
    setGeo(null); setOpen(true);
    map?.flyTo([lat, lon], 14, { duration: 0.8 });
    const info = await nearestTo(lat, lon);
    if (request !== lookup.current || !info) return;
    if (insideStudyArea(lat, lon)) { setOutside(null); setVia('search'); pickNearest(info); return; }
    const f = fieldIndex().find((x) => x.id === info.id);
    setOutside({ ...info, source: 'search', town: f ? nearestTownTo(f.lat, f.lon) : mapLayers.nearestTown });
  };
  const resetSelection = () => {
    lookup.current++;
    clearField();
    setVia('outline'); setGeo(null); setOutside(null); setLegend(false); setOpen(true);
    setOverviewReset((count) => count + 1);
  };

  const isWide = () => window.matchMedia('(min-width: 1024px)').matches;
  // Padding that keeps a framed box clear of the search box, tools and (on phones) the sheet.
  const framePadding = (sheetClosed = false) => {
    const mapTop = map?.getContainer().getBoundingClientRect().top || 0;
    const top = Math.max(96, (topRef.current?.getBoundingClientRect().bottom || 0) - mapTop + 16);
    if (isWide()) return { paddingTopLeft: [40, top], paddingBottomRight: [84, 40] };
    const sheet = sheetClosed || !open ? 64 : (sheetRef.current?.offsetHeight || 0) + 16;
    return { paddingTopLeft: [24, top + 52], paddingBottomRight: [72, sheet] };
  };
  const showStudy = () => {
    if (!isWide()) { setOpen(false); setOutside(null); }
    map?.flyToBounds(FRAME, { ...framePadding(!isWide()), duration: 0.8 });
  };

  // Privacy: the GPS point exists only inside this callback. It goes to pickField() to find the nearest sampled
  // field and is never put in state, storage, a URL or a request. Low accuracy is enough (nearest of 300 fields).
  function locateMe() {
    const request = ++lookup.current;
    setOpen(true); setOutside(null);
    if (!navigator.geolocation || !window.isSecureContext) { setGeo('unsupported'); return; }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (request !== lookup.current) return;
        setVia('gps'); setGeo(null); pickField(pos.coords.latitude, pos.coords.longitude);
      },
      (err) => { if (request === lookup.current) setGeo(GEO_ERROR[err.code] || 'unavailable'); },
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
  }

  const id = field?.field?.id;
  const outline = useMemo(() => (id ? outlineFor(id) : null), [id]);

  useEffect(() => {
    if (!map) return undefined;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);

  // Opening view: the study area and its nearest towns.
  useEffect(() => {
    if (map && !field) map.fitBounds(FRAME, { ...framePadding(), reset: true });
  }, [map, overviewReset]); // eslint-disable-line react-hooks/exhaustive-deps

  // A field loads: one parcel owns the view.
  useEffect(() => {
    if (!map || !field) return;
    const bounds = outline ? L.latLngBounds(outline.rings[0]) : L.latLng(field.field.lat, field.field.lon).toBounds(400);
    map.flyToBounds(bounds, { ...framePadding(), maxZoom: 16, duration: 0.8 });
  }, [map, field, outline]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDragStart = (e) => { dragStart.current = e.clientY; e.currentTarget.setPointerCapture?.(e.pointerId); };
  const onDragMove = (e) => { if (dragStart.current != null) setDrag(Math.max(0, e.clientY - dragStart.current)); };
  const onDragEnd = () => {
    if (dragStart.current == null) return;
    if (drag > CLOSE_DRAG_PX) setOpen(false);
    dragStart.current = null;
    setDrag(0);
  };

  const acres = outline ? Math.round(outline.acres) : null;
  const soil = field?.soil;
  const busy = loading || geo === 'locating';
  const title = outside ? t(outside.source === 'search' ? 'pick.searchOutTitle' : 'pick.outsideTitle')
    : field ? t('pick.fieldName', { id }) : t('pick.title');
  const pageKey = outside ? 'outside' : field ? `field-${id}` : 'empty';

  return (
    <div className="plat-map fixed inset-x-0 bottom-[calc(var(--plat-nav)+env(safe-area-inset-bottom))] top-[var(--plat-header)] bg-paper lg:bottom-0 lg:grid lg:grid-cols-[minmax(0,1fr)_440px]">
      <section className="relative h-full overflow-hidden" aria-label={t('pick.mapLabel')}>
        <MapContainer ref={setMap} bounds={FRAME} boundsOptions={{ padding: [24, 24] }} minZoom={9} maxZoom={18}
          zoomControl={false} attributionControl={false} scrollWheelZoom zoomSnap={0.5} zoomDelta={1}
          wheelPxPerZoomLevel={100} className="absolute inset-0 h-full w-full">
          <TileLayer url={USGS_IMAGERY} maxNativeZoom={16} maxZoom={18} className="plat-imagery" />
          <ZoomWatch onZoom={setZoom} />
          <ClickToPick onPick={tapPick} />
          <MapContext zoom={zoom} t={t} onCluster={() => map?.flyToBounds(HULL_BOUNDS, { ...framePadding(), duration: 0.8 })} />
          <Parcels selectedId={id} onPick={outlinePick} all={zoom >= OUTLINE_ZOOM} />
          <ParcelLetters zoom={zoom} t={t} />
        </MapContainer>
        <div className="plat-neatline" aria-hidden="true" />

        {/* Search, top-left inside the neatline */}
        <div ref={topRef} data-map-ui className="absolute left-5 right-5 top-5 z-[500] sm:right-auto sm:w-[380px]">
          <MapSearch online={online} onChoose={searchPick} key={overviewReset} />
          <SearchPrivacy />
        </div>

        {/* North arrow to Dallas: top-right on desktop, under the search box on phones */}
        {zoom < 13 && (
          <div className="absolute left-5 top-[104px] z-[450] lg:left-auto lg:right-5 lg:top-5">
            <NorthArrow t={t} />
          </div>
        )}

        {/* Tools: right side under the search on phones, bottom-right on desktop */}
        <div className="absolute right-5 top-[104px] z-[500] flex items-start gap-2 lg:bottom-6 lg:top-auto lg:items-end">
          <AnimatePresence>{legend && <MapKey t={t} onClose={() => setLegend(false)} />}</AnimatePresence>
          <div role="group" aria-label={t('pick.mapTools')} data-map-ui
            className="flex flex-col divide-y divide-rule border border-ink bg-paper-raised shadow-[0_6px_18px_-10px_rgb(30_26_18/0.4)]">
            <button type="button" className="plat-tool" aria-label={t('pick.zoomIn')} title={t('pick.zoomIn')} onClick={() => map?.zoomIn()}><Plus size={20} aria-hidden="true" /></button>
            <button type="button" className="plat-tool" aria-label={t('pick.zoomOut')} title={t('pick.zoomOut')} onClick={() => map?.zoomOut()}><Minus size={20} aria-hidden="true" /></button>
            <button type="button" className="plat-tool" aria-label={t('pick.showAll')} title={t('pick.showAll')} onClick={showStudy}><Scan size={19} aria-hidden="true" /></button>
            <button type="button" className="plat-tool hidden lg:grid" aria-label={t('pick.useLocation')} title={t('pick.useLocation')} disabled={busy} onClick={locateMe}>
              {geo === 'locating' ? <LoaderCircle size={19} className="plat-spin" aria-hidden="true" /> : <LocateFixed size={19} aria-hidden="true" />}
            </button>
            <button type="button" className="plat-tool" aria-label={t('pick.legendTitle')} title={t('pick.legendTitle')}
              aria-expanded={legend} aria-controls="map-key" onClick={() => setLegend(!legend)}>
              <BookMarked size={19} aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Imagery credit, in the sheet margin like an atlas plate credit */}
        <p data-map-ui className="absolute bottom-5 left-5 z-[450] hidden items-center gap-1.5 bg-paper/85 px-1.5 py-0.5 text-[12px] text-ink-soft lg:flex">
          {online ? t('pick.imagery') : <><WifiOff size={12} aria-hidden="true" />{t('pick.offline')}</>}
        </p>

        {/* Phones: the folded sheet leaves a tab to bring it back */}
        {!open && (
          <button type="button" onClick={() => setOpen(true)} data-map-ui
            className="absolute bottom-4 left-1/2 z-[600] flex min-h-12 -translate-x-1/2 items-center gap-2 border border-ink bg-paper-raised px-4 text-[15px] font-semibold text-ink shadow-[0_8px_22px_-12px_rgb(30_26_18/0.5)] lg:hidden">
            <ChevronUp size={18} aria-hidden="true" />{field ? t('pick.fieldName', { id }) : t('pick.title')}
          </button>
        )}
      </section>

      {/* The plat page: right column on desktop, bottom sheet on phones */}
      <aside ref={sheetRef} aria-label={t('pick.summaryTitle')} aria-live="polite"
        style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}
        className={`${open ? 'flex' : 'hidden'} absolute inset-x-0 bottom-0 z-[700] max-h-[50%] flex-col overflow-y-auto border-t-[3px] border-double border-ink/80 bg-paper shadow-[0_-16px_40px_-20px_rgb(30_26_18/0.45)] transition-transform duration-300
          lg:static lg:flex lg:h-full lg:max-h-none lg:border-l-[3px] lg:border-t-0 lg:shadow-none lg:overflow-hidden`}>
        <div className="flex h-7 flex-none cursor-grab touch-none items-center justify-center lg:hidden" aria-hidden="true"
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          <span className="h-1 w-10 bg-rule-strong" />
        </div>

        <div className="flex items-start gap-2 px-5 pt-1 lg:px-8 lg:pt-10">
          <div className="min-w-0 flex-1">
            <TextMorph as="h1" text={title}
              className="m-0 font-display text-[clamp(2.1rem,7vw,3.4rem)] font-normal leading-[0.98] tracking-[-0.015em] text-ink" />
            {field && !outside && (
              <p className="mt-2.5 text-[15px] text-ink-soft">
                {t(acres != null ? 'pick.fieldSub' : 'pick.countyValue', { county: field.field.county, state: field.field.state })}
              </p>
            )}
          </div>
          <div className="-mr-2 flex flex-none">
            <button type="button" className="plat-tool bg-transparent lg:hidden" aria-label={t('pick.closeSheet')} title={t('pick.closeSheet')} onClick={() => setOpen(false)}>
              <ChevronDown size={20} aria-hidden="true" />
            </button>
            {(field || outside || geo || loading || loadError) && (
              <button type="button" className="plat-tool bg-transparent" aria-label={t('pick.resetSelection')} title={t('pick.resetSelection')} onClick={resetSelection}>
                <X size={20} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={pageKey}
            initial={reduce ? false : { opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, filter: 'blur(3px)' }}
            transition={{ duration: 0.32, ease: EASE }}
            className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-6 pt-4 lg:gap-5 lg:overflow-y-auto lg:overflow-x-hidden lg:px-8 lg:pb-8 lg:pt-7">

            {geo === 'locating' && <Note><LoaderCircle size={16} className="plat-spin mr-2 inline align-[-3px]" aria-hidden="true" />{t('pick.locating')}</Note>}
            {geo && geo !== 'locating' && <Note warn role="alert">{t(`pick.geo.${geo}`)}</Note>}
            {loadError && !loading && <Note warn role="alert">{t(loadError.reason === 'missing' ? 'pick.loadMissing' : 'pick.loadError')}</Note>}
            {loadError?.id && !loading && (
              <button type="button" className="plat-btn w-full" onClick={retryLoad}><RotateCw size={18} aria-hidden="true" />{t('pick.retry')}</button>
            )}

            {outside?.source === 'search' && (
              <>
                <Note>{t('pick.searchOutText', { mi: Math.max(1, Math.round(outside.nearestKm * 0.621371)), town: outside.town })}</Note>
                <div className="mt-auto flex flex-col gap-2">
                  <button type="button" className="plat-btn plat-btn-primary w-full" disabled={loading} onClick={openNearest}>
                    {loading ? t('pick.loading') : t('pick.searchOpen')}{!loading && <ArrowRight size={18} aria-hidden="true" />}
                  </button>
                  <button type="button" className="plat-btn w-full" onClick={showStudy}><ArrowLeft size={18} aria-hidden="true" />{t('pick.searchBack')}</button>
                </div>
              </>
            )}

            {outside && outside.source !== 'search' && (
              <>
                <Note>{t('pick.outsideText', { n: OUTLINES.length, town: mapLayers.nearestTown })}</Note>
                {outside.notCropland && <Note warn>{t('pick.outsideNotCropland')}</Note>}
                <div className="mt-auto flex flex-col gap-2">
                  <button type="button" className="plat-btn plat-btn-primary w-full" onClick={showStudy}><Compass size={18} aria-hidden="true" />{t('pick.outsideShow')}</button>
                  <button type="button" className="plat-btn w-full" disabled={loading} onClick={openNearest}>{t('pick.outsideNearest', { km: outside.nearestKm })}</button>
                </div>
              </>
            )}

            {!field && !outside && (
              <>
                <Note>{t(loading ? 'pick.loading' : 'pick.emptySummary')}</Note>
                <dl className="plat-record m-0">
                  <RecordRow label={t('pick.indexLabel')} sub={t('pick.scopeSub')}>
                    {t('pick.scopeTitle', { n: OUTLINES.length })}
                  </RecordRow>
                </dl>
                <button type="button" className="plat-btn w-full" disabled={busy} onClick={locateMe}>
                  {geo === 'locating' ? <LoaderCircle size={18} className="plat-spin" aria-hidden="true" /> : <LocateFixed size={18} aria-hidden="true" />}
                  {t('pick.useLocation')}
                </button>
                <ParcelIndex t={t} onPick={outlinePick} />
                <Privacy />
              </>
            )}

            {field && !outside && (
              <>
                {field.nearestKm > 0 && via !== 'outline' && (
                  <Note>{t(via === 'gps' ? 'pick.nearestGps' : via === 'search' ? 'pick.nearestSearch' : 'pick.nearest', { km: field.nearestKm, id })}</Note>
                )}
                {field.notCropland && field.nearestKm <= FAR_KM && (
                  <Note warn>{t(via === 'gps' ? 'pick.notCroplandGps' : via === 'search' ? 'pick.notCroplandSearch' : 'pick.notCropland')}</Note>
                )}
                {field.nearestKm > FAR_KM && <Note warn>{t('pick.farAway', { km: field.nearestKm })}</Note>}
                {field.fallbackReason && <Note warn>{t('pick.fallback')}</Note>}
                <dl className="plat-record m-0">
                  {acres != null && <RecordRow label={t('pick.acresLabel')}>{t('pick.acresValue', { acres })}</RecordRow>}
                  <CropRow field={field} />
                  <RecordRow label={t('pick.soil')} sub={<>{t(`pick.slopeWord.${slopeWord(field.terrain.slopePct)}`)} · {t('pick.slopeDetail', { pct: field.terrain.slopePct })}</>}>
                    <Receipt src={['USDA SSURGO', 'SRTM']}>
                      {soil.texture ? t('pick.soilShort', { texture: t(`soil.texture.${soil.texture}`), series: soil.seriesName ?? '–' }) : t('common.unknown')}
                    </Receipt>
                  </RecordRow>
                </dl>
                <div className="mt-auto pt-1"><Privacy /></div>
                <div className="sticky bottom-0 z-10 -mx-5 -mb-6 border-t border-rule bg-paper px-5 pb-4 pt-3 lg:static lg:m-0 lg:border-0 lg:p-0">
                  <button type="button" className="plat-btn plat-btn-primary min-h-14 w-full text-[16px]" disabled={loading} onClick={() => setScreen('farm')}>
                    {loading ? t('pick.loading') : t('pick.continue')}{!loading && <ArrowRight size={20} aria-hidden="true" />}
                  </button>
                </div>
              </>
            )}

            <p className="flex items-center gap-1.5 text-[12px] text-ink-soft lg:hidden">
              {online ? t('pick.imagery') : <><WifiOff size={12} aria-hidden="true" />{t('pick.offline')}</>}
            </p>
          </motion.div>
        </AnimatePresence>
      </aside>
    </div>
  );
}
