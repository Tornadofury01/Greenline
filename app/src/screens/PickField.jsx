// Screen 1: a full-screen satellite map of the 300 Ellis County study fields. Tap an outline to load that field;
// a card slides up over the map with the field at a glance.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, Polyline, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Layers, Mountain, Wheat, MapPin, ArrowRight, WifiOff, Lock, LocateFixed, LoaderCircle, TriangleAlert, RotateCw,
  Plus, Minus, Scan, X, ChevronUp, Sprout, Info, Compass, ArrowLeft, Navigation2,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { Receipt } from '../components/Small.jsx';
import { slopeWord } from '../display.js';
import { fieldOutlines, outlineFor, mapLayers, insideStudyArea, nearestTo, fieldIndex } from '../data/loadField.js';
import { nearestTownTo } from '../data/geocode.js';
import MapSearch, { SearchPrivacy } from '../components/MapSearch.jsx';
import { cropThisYear } from '../si.js';
// import FieldWalkMode from '../components/future/FieldWalkMode.jsx';  // FUTURE
// import MemoryPins from '../components/future/MemoryPins.jsx';        // FUTURE

const FAR_KM = 25; // beyond this the nearest sampled field is probably not like the farmer's field
// GPS error code -> which message to show (1 denied, 2 unavailable, 3 timeout).
const GEO_ERROR = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

// The 300 Field Shift study fields: public USDA field outlines within ~4 km of 32.25 N, 96.75 W (Ellis County, TX).
const OUTLINES = fieldOutlines();
// Opening view: the study area plus its nearest towns (built in pipeline/build_map_layers.mjs).
const FRAME = L.latLngBounds(mapLayers.frame);
const HULL_BOUNDS = L.latLngBounds(mapLayers.studyHull);
// Everything outside the study area is dimmed: a world-sized polygon with the study hull cut out as a hole.
const WORLD = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
// Public-domain imagery from the USGS National Map. Its tile cache stops at zoom 16; Leaflet stretches it beyond that.
// Label-free imagery: our own town labels are the only place names, so each name shows once.
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const CLOSE_DRAG_PX = 70; // drag the card down this far to close it
const OUTLINE_ZOOM = 12;  // below this zoom the 300 outlines collapse into one "300 fields" marker
const TOWN_ZOOM = { 1: 9, 2: 10, 3: 10.5 }; // bigger towns get their labels at lower zoom

// Text-only map labels (towns, "Our 300 fields"). Our font, a dark halo; never interactive.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const labelIcon = (html, cls, dx = 0, dy = 0) => L.divIcon({
  className: 'map-label-wrap', iconSize: [0, 0],
  html: `<span class="map-label ${cls}" style="margin-left:${dx}px;margin-top:${dy}px">${html}</span>`,
});
// One icon per town and offset, made once.
const TOWN_ICONS = new Map();
const townIcon = (tw, [dx, dy]) => {
  const k = `${tw.geoid}:${dx}:${dy}`;
  if (!TOWN_ICONS.has(k)) TOWN_ICONS.set(k, labelIcon(esc(tw.name), `tier-${tw.tier}`, dx, dy));
  return TOWN_ICONS.get(k);
};

// County boundary as sample points (each segment split in 4), for placing the "Ellis County" label.
const COUNTY_POINTS = mapLayers.county.flatMap((ring) => ring.flatMap((pt, i) => {
  const nx = ring[(i + 1) % ring.length];
  return [0, 0.25, 0.5, 0.75].map((f) => [pt[0] + (nx[0] - pt[0]) * f, pt[1] + (nx[1] - pt[1]) * f]);
}));

// Place the map's text labels so none overlap each other, the "300 fields" marker, or anything floating over the
// map (header, search box, notes, buttons, card). Biggest towns first; a label that doesn't fit is skipped.
// The "Ellis County" label goes on the free stretch of the boundary nearest the study area.
// Recomputed after every zoom or pan. Label boxes are estimated from the text length.
function usePlacedLabels(zoom, countyText, hullText) {
  const map = useMap();
  const [placed, setPlaced] = useState({ towns: new Map(), county: null, hull: false });
  useEffect(() => {
    const place = () => {
      const z = map.getZoom();
      const box = map.getContainer().getBoundingClientRect();
      const W = box.width; const H = box.height;
      const hit = (b, o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1];
      const boxes = [...document.querySelectorAll('.header-inner > *, .map-search, .map-search-note, .map-scope, .map-dallas, .map-attrib, .map-legend, .map-bottom > *')]
        .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height)
        .map((r) => [r.left - box.left - 4, r.top - box.top - 4, r.right - box.left + 4, r.bottom - box.top + 4]);
      const fits = (b) => b[0] >= 4 && b[1] >= 4 && b[2] <= W - 4 && b[3] <= H - 4 && !boxes.some((o) => hit(b, o));
      const c = map.latLngToContainerPoint(mapLayers.studyCenter);
      if (z < OUTLINE_ZOOM) boxes.push([c.x - 40, c.y - 40, c.x + 40, c.y + 40]);
      // "Our 300 fields" (zoomed in): above the hull's top point
      let hull = false;
      if (z >= OUTLINE_ZOOM) {
        const h = map.latLngToContainerPoint(mapLayers.studyLabel);
        const w = hullText.length * 7.5 + 24;
        const hb = [h.x - w / 2, h.y - 34, h.x + w / 2, h.y - 8];
        if (fits(hb)) { boxes.push(hb); hull = true; }
      }
      // town id -> label offset [dx, dy] in px. Centered on the town if it fits, else beside, above or below it.
      const towns = new Map();
      [...mapLayers.towns].sort((x, y) => x.tier - y.tier).forEach((tw) => {
        if (z < TOWN_ZOOM[tw.tier]) return;
        const pt = map.latLngToContainerPoint([tw.lat, tw.lon]);
        const w = tw.name.length * (tw.tier === 1 ? 9 : 8) + 8;
        const spots = [[0, 0], [w / 2 + 6, 0], [-w / 2 - 6, 0], [0, -20], [0, 20]];
        for (const [dx, dy] of spots) {
          const tb = [pt.x + dx - w / 2, pt.y + dy - 11, pt.x + dx + w / 2, pt.y + dy + 11];
          if (!fits(tb)) continue;
          boxes.push(tb);
          towns.set(tw.geoid, [Math.round(dx), dy]);
          break;
        }
      });
      let county = null;
      if (z < 13) {
        const w = countyText.length * 7.5 + 8;
        let best = Infinity;
        for (const ll of COUNTY_POINTS) {
          const pt = map.latLngToContainerPoint(ll);
          const cb = [pt.x - w / 2, pt.y - 10, pt.x + w / 2, pt.y + 10];
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
  const shown = placed.towns;
  const icons = useMemo(() => ({
    county: labelIcon(esc(t('pick.countyLabel')), 'map-label-county'),
    hull: labelIcon(esc(t('pick.hullLabel')), 'map-label-hull'),
    cluster: L.divIcon({ className: 'map-label-wrap', html: `<span class="map-cluster"><b>${OUTLINES.length}</b><small>${esc(t('pick.clusterUnit'))}</small></span>`, iconSize: [0, 0] }),
  }), [t]);
  return (
    <>
      <Polygon positions={[WORLD, mapLayers.studyHull]} className="map-mask" interactive={false} />
      {mapLayers.county.map((ring, i) => <Polyline key={i} positions={[...ring, ring[0]]} className="county-line" interactive={false} />)}
      <Polygon positions={mapLayers.studyHull} className="study-hull" interactive={false} />
      {mapLayers.towns.map((tw) => shown.has(tw.geoid) && (
        <Marker key={tw.geoid} position={[tw.lat, tw.lon]} icon={townIcon(tw, shown.get(tw.geoid))} interactive={false} keyboard={false} />
      ))}
      {placed.county && <Marker position={placed.county} icon={icons.county} interactive={false} keyboard={false} />}
      {placed.hull && <Marker position={mapLayers.studyLabel} icon={icons.hull} interactive={false} keyboard={false} />}
      {zoom < OUTLINE_ZOOM && (
        <Marker position={mapLayers.studyCenter} icon={icons.cluster} title={t('pick.clusterTap')} alt={t('pick.clusterTap')}
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

// All 300 outlines (only the selected one when zoomed out). Colors come from CSS (.field-outline in styles.css).
// A tap inside an outline loads exactly that field and does not reach the map's own tap handler.
function Outlines({ selectedId, onPick, all }) {
  return OUTLINES.filter((f) => all || f.id === selectedId).map((f) => (
    // className must be a direct prop: react-leaflet applies pathOptions with setStyle(), which ignores className.
    // The key changes with the selection so the shape is re-created with the new class.
    <Polygon key={`${f.id}${f.id === selectedId ? '-on' : ''}`} positions={f.rings}
      className={f.id === selectedId ? 'field-outline is-selected' : 'field-outline'}
      bubblingMouseEvents={false} eventHandlers={{ click: () => onPick(f.id) }} />
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

// One row of the card: round icon tile, a main line and a small line under it.
function SheetRow({ icon: Icon, children, sub }) {
  return (
    <div className="sheet-row">
      <span className="sheet-row-icon"><Icon size={20} aria-hidden="true" /></span>
      <div className="sheet-row-body">
        <div className="sheet-row-main">{children}</div>
        {sub && <div className="sheet-row-sub">{sub}</div>}
      </div>
    </div>
  );
}

// The crop on the field in the latest year, and how we know: USDA crop map, a model guess, or "not sure" (dashed).
function CropRow({ field }) {
  const { t } = useApp();
  const c = cropThisYear(field);
  if (!c) return null;
  const crop = c.cropId ? t(`crops.${c.cropId}`) : t(`si.cls.${c.cls}`);
  const kind = c.notSure ? 'notSure' : c.source === 'usda' ? 'usda' : 'model';
  return (
    <SheetRow icon={Sprout}
      sub={<span className={`pill ${c.notSure ? 'pill-unsure' : ''}`}>{t(`pick.cropSrc.${kind}`, { pct: c.pct ?? '–' })}</span>}>
      <Receipt src={['USDA Cropland Data Layer', 'Greenline SI models']}>{t('pick.cropThisYear', { crop, year: c.year })}</Receipt>
    </SheetRow>
  );
}

export default function PickField() {
  const { t, field, pickField, pickFieldById, pickDemo, pickNearest, retryLoad, loadError, loading, setScreen } = useApp();
  const online = useOnline();
  const [map, setMap] = useState(null);
  // How the current field was picked ('tap' | 'gps' | 'outline') and the state of the GPS button. No coordinates are kept here.
  const [via, setVia] = useState('outline');
  const [geo, setGeo] = useState(null); // null | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef(null);
  const bottomRef = useRef(null);
  const topRef = useRef(null);

  const [zoom, setZoom] = useState(11);
  const [legend, setLegend] = useState(false);
  // A tap outside the study area: { id, nearestKm, notCropland } of the nearest field (never the point itself).
  const [outside, setOutside] = useState(null);

  // Taps inside the study area keep the old behavior (nearest field + warnings). Outside it, first say where our
  // data is; the farmer can still open the nearest field from there.
  const tapPick = async (lat, lon) => {
    setGeo(null); setOpen(true);
    if (insideStudyArea(lat, lon)) { setOutside(null); setVia('tap'); pickField(lat, lon); return; }
    setOutside(await nearestTo(lat, lon));
  };
  const outlinePick = (id) => { setVia('outline'); setGeo(null); setOutside(null); setOpen(true); pickFieldById(id); };
  const openNearest = () => { setVia(outside?.source === 'search' ? 'search' : 'tap'); pickNearest(outside); setOutside(null); };
  // A search result: fly there, then the same nearest-field logic as a map tap. The point is only passed through.
  const searchPick = async ({ lat, lon }) => {
    setGeo(null); setOpen(true);
    map?.flyTo([lat, lon], 14, { duration: 0.8 });
    const info = await nearestTo(lat, lon);
    if (!info) return;
    if (insideStudyArea(lat, lon)) { setOutside(null); setVia('search'); pickNearest(info); return; }
    const f = fieldIndex().find((x) => x.id === info.id);
    setOutside({ ...info, source: 'search', town: f ? nearestTownTo(f.lat, f.lon) : mapLayers.nearestTown });
  };
  const openDemo = () => { setVia('outline'); setOutside(null); pickDemo(); };
  // Frame a box in the part of the map that isn't covered by the header, notes and the bottom card.
  // sheetClosed: the card is being folded away, so only the map buttons (46 px) sit above the nav.
  const framePadding = (sheetClosed = false) => {
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    const card = sheetClosed ? 46 + 8 : (bottomRef.current?.offsetHeight || 0);
    const top = (topRef.current?.getBoundingClientRect().bottom || 150) + 8;
    return { paddingTopLeft: [wide ? 440 : 16, top], paddingBottomRight: [16, wide ? 24 : card + 96] };
  };
  // "Show the study area": fold the card away so the whole area fits (the reopen pill brings it back).
  const showStudy = () => {
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    if (!wide) { setOpen(false); setOutside(null); }
    map?.flyToBounds(FRAME, { ...framePadding(!wide), duration: 0.8 });
  };

  // Privacy: the GPS point exists only inside this callback. It goes to pickField() to find the nearest sampled
  // field and is never put in state, storage, a URL or a request. Low accuracy is enough (nearest of 300 fields).
  function locateMe() {
    setOpen(true);
    if (!navigator.geolocation || !window.isSecureContext) { setGeo('unsupported'); return; }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setVia('gps'); setGeo(null); setOutside(null); pickField(pos.coords.latitude, pos.coords.longitude); },
      (err) => setGeo(GEO_ERROR[err.code] || 'unavailable'),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
  }

  const id = field?.field?.id;
  const outline = useMemo(() => (id ? outlineFor(id) : null), [id]);

  // Leaflet doesn't notice when its box changes size (rotation, window resize).
  useEffect(() => {
    if (!map) return undefined;
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);

  // Opening view (no field yet): the study area and its nearest towns, clear of the header and the card.
  useEffect(() => {
    if (map && !field) map.fitBounds(FRAME, framePadding());
  }, [map]); // eslint-disable-line react-hooks/exhaustive-deps

  // When a field loads, zoom to its outline, leaving room for the header and the card.
  useEffect(() => {
    if (!map || !field) return;
    const bounds = outline ? L.latLngBounds(outline.rings[0]) : L.latLng(field.field.lat, field.field.lon).toBounds(400);
    const wide = window.matchMedia('(min-width: 1024px)').matches;
    const below = wide ? 24 : (bottomRef.current?.offsetHeight || 0) + 96;
    map.flyToBounds(bounds, { paddingTopLeft: [wide ? 440 : 24, 176], paddingBottomRight: [24, below], maxZoom: 16, duration: 0.8 });
  }, [map, field, outline]);

  // The handle: tap to close, or drag the card down.
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

  return (
    <div className="map-screen">
      <section className="map-wrap" aria-label={t('pick.mapLabel')}>
        <MapContainer ref={setMap} bounds={FRAME} boundsOptions={{ padding: [24, 24] }} minZoom={9} maxZoom={18}
          zoomControl={false} attributionControl={false} scrollWheelZoom zoomSnap={0.5} zoomDelta={1}
          wheelPxPerZoomLevel={100} className="map">
          <TileLayer url={USGS_IMAGERY} maxNativeZoom={16} maxZoom={18} className="map-imagery" />
          <ZoomWatch onZoom={setZoom} />
          <ClickToPick onPick={tapPick} />
          <MapContext zoom={zoom} t={t} onCluster={() => map?.flyToBounds(HULL_BOUNDS, { ...framePadding(), duration: 0.8 })} />
          <Outlines selectedId={id} onPick={outlinePick} all={zoom >= OUTLINE_ZOOM} />
        </MapContainer>
      </section>

      <div className="map-top" ref={topRef}>
      <MapSearch online={online} onChoose={searchPick} />
      <SearchPrivacy />
      {/* Reserved for the map view chips (built later). Nothing else may sit here. */}
      <div className="map-chips" aria-hidden="true" />
      {/* Four different kinds of note, four different looks: privacy = helper text under the box (above),
          data scope = a small info card, Dallas = a north arrow, imagery credit = map attribution text. */}
      <div className="map-notes">
        <div className="map-top-row">
          <div className="map-left">
          <div className="map-scope" role="note">
            <span className="map-scope-icon" aria-hidden="true"><Layers size={16} /></span>
            <span className="map-scope-text">
              <strong>{t('pick.scopeTitle', { n: OUTLINES.length })}</strong>
              <small>{t('pick.scopeSub')}</small>
            </span>
          </div>
          <p className="map-attrib">{online ? t('pick.imagery') : <><WifiOff size={12} aria-hidden="true" />{t('pick.offline')}</>}</p>
          </div>
          <div className="map-side">
            {zoom < 13 && (
              <p className="map-dallas" role="note" aria-label={t('pick.dallasAlt', { km: mapLayers.dallas.km })}>
                <span className="map-dallas-arrow" aria-hidden="true"><Navigation2 size={14} /></span>
                <span><strong>{t('pick.dallasName')}</strong> {t('pick.dallasKm', { km: mapLayers.dallas.km })}</span>
              </p>
            )}
          </div>
        </div>
        {legend && (
          <div className="map-legend" id="map-legend" role="region" aria-label={t('pick.legendTitle')}>
            <div className="map-legend-head">
              <strong>{t('pick.legendTitle')}</strong>
              <button type="button" className="map-sheet-close" aria-label={t('common.close')} onClick={() => setLegend(false)}><X size={18} aria-hidden="true" /></button>
            </div>
            <ul>
              <li><span className="lg-swatch lg-hull" aria-hidden="true" />{t('pick.legendHull')}</li>
              <li><span className="lg-swatch lg-field" aria-hidden="true" />{t('pick.legendField')}</li>
              <li><span className="lg-swatch lg-selected" aria-hidden="true" />{t('pick.legendSelected')}</li>
              <li><span className="lg-swatch lg-county" aria-hidden="true" />{t('pick.legendCounty')}</li>
            </ul>
          </div>
        )}
      </div>
      </div>

      <div className="map-bottom" ref={bottomRef}>
        <div className="map-ctrl" role="group" aria-label={t('pick.mapTools')}>
          <div className="map-ctrl-zoom">
            <button type="button" aria-label={t('pick.zoomIn')} title={t('pick.zoomIn')} onClick={() => map?.zoomIn()}><Plus size={20} aria-hidden="true" /></button>
            <button type="button" aria-label={t('pick.zoomOut')} title={t('pick.zoomOut')} onClick={() => map?.zoomOut()}><Minus size={20} aria-hidden="true" /></button>
          </div>
          <button type="button" className="map-ctrl-btn" aria-label={t('pick.showAll')} title={t('pick.showAll')} onClick={showStudy}>
            <Scan size={20} aria-hidden="true" />
          </button>
          <button type="button" className="map-ctrl-btn" aria-label={t('pick.useLocation')} title={t('pick.useLocation')}
            disabled={geo === 'locating' || loading} onClick={locateMe}>
            {geo === 'locating' ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <LocateFixed size={20} aria-hidden="true" />}
          </button>
          <button type="button" className="map-ctrl-btn" aria-label={t('pick.legendTitle')} title={t('pick.legendTitle')}
            aria-expanded={legend} aria-controls="map-legend" onClick={() => setLegend(!legend)}>
            <Info size={20} aria-hidden="true" />
          </button>
          {!open && (
            <button type="button" className="map-reopen" onClick={() => setOpen(true)}>
              <ChevronUp size={18} aria-hidden="true" />
              <span>{field ? t('pick.fieldName', { id }) : t('pick.title')}</span>
            </button>
          )}
        </div>

        {open && (
          <section className="map-sheet" aria-label={t('pick.summaryTitle')} aria-live="polite"
            style={drag ? { transform: `translateY(${drag}px)`, transition: 'none' } : undefined}>
            <button type="button" className="map-sheet-handle" aria-label={t('pick.closeSheet')}
              onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}
              onClick={() => { if (drag <= 4) setOpen(false); }}>
              <span />
            </button>
            <div className="map-sheet-head">
              <span className="map-sheet-mark"><MapPin size={20} aria-hidden="true" /></span>
              <div className="map-sheet-title">
                <h1>{outside ? t(outside.source === 'search' ? 'pick.searchOutTitle' : 'pick.outsideTitle') : !field ? t('pick.title') : acres != null ? t('pick.fieldTitle', { id, acres }) : t('pick.fieldName', { id })}</h1>
                {field && !outside && (
                  <p>{t(acres != null ? 'pick.fieldSub' : 'pick.countyValue', { county: field.field.county, state: field.field.state })}</p>
                )}
              </div>
              <button type="button" className="map-sheet-close" aria-label={t('common.close')} onClick={() => setOpen(false)}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {geo === 'locating' && <p className="sheet-note"><LoaderCircle size={18} className="spin" aria-hidden="true" /><span>{t('pick.locating')}</span></p>}
            {geo && geo !== 'locating' && (
              <p className="sheet-note sheet-warn" role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{t(`pick.geo.${geo}`)}</span></p>
            )}
            {loadError && !loading && (
              <p className="sheet-note sheet-warn" role="alert">
                <TriangleAlert size={18} aria-hidden="true" />
                <span>{t(loadError.reason === 'missing' ? 'pick.loadMissing' : 'pick.loadError')}</span>
              </p>
            )}
            {loadError?.id && !loading && (
              <button type="button" className="btn btn-block" onClick={retryLoad}>
                <RotateCw size={20} aria-hidden="true" />{t('pick.retry')}
              </button>
            )}

            {outside?.source === 'search' && (
              <>
                <p className="map-sheet-text">{t('pick.searchOutText', { mi: Math.max(1, Math.round(outside.nearestKm * 0.621371)), town: outside.town })}</p>
                <button type="button" className="btn btn-block" onClick={showStudy}>
                  <ArrowLeft size={20} aria-hidden="true" />{t('pick.searchBack')}
                </button>
                <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={openNearest}>
                  {loading ? t('pick.loading') : t('pick.searchOpen')}{!loading && <ArrowRight size={20} aria-hidden="true" />}
                </button>
              </>
            )}

            {outside && outside.source !== 'search' && (
              <>
                <p className="map-sheet-text">{t('pick.outsideText', { n: OUTLINES.length, town: mapLayers.nearestTown })}</p>
                {outside.notCropland && <p className="sheet-note sheet-warn"><TriangleAlert size={18} aria-hidden="true" /><span>{t('pick.outsideNotCropland')}</span></p>}
                <button type="button" className="btn btn-block" onClick={showStudy}>
                  <Compass size={20} aria-hidden="true" />{t('pick.outsideShow')}
                </button>
                <button type="button" className="btn btn-block" disabled={loading} onClick={openNearest}>
                  {t('pick.outsideNearest', { km: outside.nearestKm })}
                </button>
                <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={openDemo}>
                  {loading ? t('pick.loading') : t('pick.loadDemo')}
                </button>
              </>
            )}

            {!field && !outside && (
              <>
                <p className="map-sheet-text">{t('pick.emptySummary')}</p>
                <p className="source"><Lock size={14} aria-hidden="true" /><span>{t('pick.privacy')}</span></p>
                <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={openDemo}>
                  {loading ? t('pick.loading') : t('pick.loadDemo')}
                </button>
              </>
            )}

            {field && !outside && (
              <>
                {field.nearestKm > 0 && via !== 'outline' && (
                  <p className="sheet-note">{t(via === 'gps' ? 'pick.nearestGps' : via === 'search' ? 'pick.nearestSearch' : 'pick.nearest', { km: field.nearestKm, id })}</p>
                )}
                {field.notCropland && field.nearestKm <= FAR_KM && (
                  <p className="sheet-note sheet-warn"><TriangleAlert size={18} aria-hidden="true" /><span>{t(via === 'gps' ? 'pick.notCroplandGps' : via === 'search' ? 'pick.notCroplandSearch' : 'pick.notCropland')}</span></p>
                )}
                {field.nearestKm > FAR_KM && (
                  <p className="sheet-note sheet-warn"><TriangleAlert size={18} aria-hidden="true" /><span>{t('pick.farAway', { km: field.nearestKm })}</span></p>
                )}
                {field.fallbackReason && <p className="sheet-note sheet-warn">{t('pick.fallback')}</p>}
                <div className="sheet-rows">
                  <CropRow field={field} />
                  <SheetRow icon={Layers}
                    sub={t('pick.soilSub', { slope: t(`pick.slopeWord.${slopeWord(field.terrain.slopePct)}`), pct: field.terrain.slopePct })}>
                    <Receipt src={['USDA SSURGO', 'SRTM']}>
                      {soil.texture ? t('pick.soilShort', { texture: t(`soil.texture.${soil.texture}`), series: soil.seriesName ?? '–' }) : t('common.unknown')}
                    </Receipt>
                  </SheetRow>
                </div>
                <p className="source"><Lock size={14} aria-hidden="true" /><span>{t('pick.privacy')}</span></p>
                <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={() => setScreen('farm')}>
                  {loading ? t('pick.loading') : t('pick.continue')}{!loading && <ArrowRight size={20} aria-hidden="true" />}
                </button>
              </>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
