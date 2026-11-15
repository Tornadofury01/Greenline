// Screen 1: a full-screen satellite map of the 300 Ellis County study fields. Tap an outline to load that field;
// a card slides up over the map with the field at a glance.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MapContainer, TileLayer, Polygon, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import {
  Layers, Mountain, Wheat, MapPin, ArrowRight, WifiOff, Lock, LocateFixed, LoaderCircle, TriangleAlert, RotateCw,
  Plus, Minus, Scan, X, ChevronUp, Sprout,
} from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { Receipt } from '../components/Small.jsx';
import { slopeWord } from '../display.js';
import { fieldOutlines, outlineFor } from '../data/loadField.js';
import { cropThisYear } from '../si.js';
// import FieldWalkMode from '../components/future/FieldWalkMode.jsx';  // FUTURE
// import MemoryPins from '../components/future/MemoryPins.jsx';        // FUTURE

const FAR_KM = 25; // beyond this the nearest sampled field is probably not like the farmer's field
// GPS error code -> which message to show (1 denied, 2 unavailable, 3 timeout).
const GEO_ERROR = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };

// The 300 Field Shift study fields: public USDA field outlines within ~4 km of 32.25 N, 96.75 W (Ellis County, TX).
const OUTLINES = fieldOutlines();
const ALL_BOUNDS = L.latLngBounds(OUTLINES.flatMap((f) => f.rings[0]));
// Public-domain imagery from the USGS National Map. Its tile cache stops at zoom 16; Leaflet stretches it beyond that.
const USGS_IMAGERY = 'https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/{z}/{y}/{x}';
const CLOSE_DRAG_PX = 70; // drag the card down this far to close it

// All 300 outlines. Colors come from CSS (.field-outline in styles.css), so they follow the tokens.
// A tap inside an outline loads exactly that field and does not reach the map's own tap handler.
function Outlines({ selectedId, onPick }) {
  return OUTLINES.map((f) => (
    <Polygon key={`${f.id}${f.id === selectedId ? '-on' : ''}`} positions={f.rings}
      pathOptions={{ className: f.id === selectedId ? 'field-outline is-selected' : 'field-outline' }}
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
  const { t, field, pickField, pickFieldById, pickDemo, retryLoad, loadError, loading, setScreen } = useApp();
  const online = useOnline();
  const [map, setMap] = useState(null);
  // How the current field was picked ('tap' | 'gps' | 'outline') and the state of the GPS button. No coordinates are kept here.
  const [via, setVia] = useState('outline');
  const [geo, setGeo] = useState(null); // null | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
  const [open, setOpen] = useState(true);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef(null);
  const bottomRef = useRef(null);

  const tapPick = (lat, lon) => { setVia('tap'); setGeo(null); setOpen(true); pickField(lat, lon); };
  const outlinePick = (id) => { setVia('outline'); setGeo(null); setOpen(true); pickFieldById(id); };

  // Privacy: the GPS point exists only inside this callback. It goes to pickField() to find the nearest sampled
  // field and is never put in state, storage, a URL or a request. Low accuracy is enough (nearest of 300 fields).
  function locateMe() {
    setOpen(true);
    if (!navigator.geolocation || !window.isSecureContext) { setGeo('unsupported'); return; }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setVia('gps'); setGeo(null); pickField(pos.coords.latitude, pos.coords.longitude); },
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
        <MapContainer ref={setMap} bounds={ALL_BOUNDS} boundsOptions={{ padding: [16, 16] }} minZoom={9} maxZoom={18}
          zoomControl={false} attributionControl={false} scrollWheelZoom zoomSnap={0.5} zoomDelta={1}
          wheelPxPerZoomLevel={100} className="map">
          <TileLayer url={USGS_IMAGERY} maxNativeZoom={16} maxZoom={18} className="map-imagery" />
          <ClickToPick onPick={tapPick} />
          <Outlines selectedId={id} onPick={outlinePick} />
        </MapContainer>
      </section>

      {/* Reserved for the map view chips (built later). Nothing else may sit here. */}
      <div className="map-chips" aria-hidden="true" />

      <div className="map-notes">
        <p>{t('pick.note300')}</p>
        <p>{online ? t('pick.imagery') : <><WifiOff size={12} aria-hidden="true" />{t('pick.offline')}</>}</p>
      </div>

      <div className="map-bottom" ref={bottomRef}>
        <div className="map-ctrl" role="group" aria-label={t('pick.mapTools')}>
          <div className="map-ctrl-zoom">
            <button type="button" aria-label={t('pick.zoomIn')} title={t('pick.zoomIn')} onClick={() => map?.zoomIn()}><Plus size={20} aria-hidden="true" /></button>
            <button type="button" aria-label={t('pick.zoomOut')} title={t('pick.zoomOut')} onClick={() => map?.zoomOut()}><Minus size={20} aria-hidden="true" /></button>
          </div>
          <button type="button" className="map-ctrl-btn" aria-label={t('pick.showAll')} title={t('pick.showAll')}
            onClick={() => map?.flyToBounds(ALL_BOUNDS, { padding: [16, 16], duration: 0.8 })}>
            <Scan size={20} aria-hidden="true" />
          </button>
          <button type="button" className="map-ctrl-btn" aria-label={t('pick.useLocation')} title={t('pick.useLocation')}
            disabled={geo === 'locating' || loading} onClick={locateMe}>
            {geo === 'locating' ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <LocateFixed size={20} aria-hidden="true" />}
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
                <h1>{!field ? t('pick.title') : acres != null ? t('pick.fieldTitle', { id, acres }) : t('pick.fieldName', { id })}</h1>
                {field && (
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

            {!field && (
              <>
                <p className="map-sheet-text">{t('pick.emptySummary')}</p>
                <p className="source"><Lock size={14} aria-hidden="true" /><span>{t('pick.privacy')}</span></p>
                <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={() => { setVia('outline'); pickDemo(); }}>
                  {loading ? t('pick.loading') : t('pick.loadDemo')}
                </button>
              </>
            )}

            {field && (
              <>
                {field.nearestKm > 0 && via !== 'outline' && (
                  <p className="sheet-note">{t(via === 'gps' ? 'pick.nearestGps' : 'pick.nearest', { km: field.nearestKm, id })}</p>
                )}
                {field.notCropland && field.nearestKm <= FAR_KM && (
                  <p className="sheet-note sheet-warn"><TriangleAlert size={18} aria-hidden="true" /><span>{t(via === 'gps' ? 'pick.notCroplandGps' : 'pick.notCropland')}</span></p>
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
