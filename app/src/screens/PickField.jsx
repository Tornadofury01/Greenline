// Screen 1: tap the map to load a field, then see the field at a glance.
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Rectangle, CircleMarker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Hand, Layers, Mountain, Wheat, MapPin, ArrowRight, WifiOff, Lock, LocateFixed, LoaderCircle, TriangleAlert, RotateCw } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { PageHead, Source } from '../components/Small.jsx';
import { slopeWord } from '../display.js';
import { fieldIndex } from '../data/loadField.js';
// import FieldWalkMode from '../components/future/FieldWalkMode.jsx';  // FUTURE
// import MemoryPins from '../components/future/MemoryPins.jsx';        // FUTURE

// The 300 Field Shift study fields: USDA field outlines within ~4 km of this point (Ellis County, TX).
const STUDY_AREA = [32.25, -96.75];
const CELL_HALF_DEG = 0.000135; // ~15 m, so the box is one 30 m cell
const FAR_KM = 25; // beyond this the nearest sampled field is probably not like the farmer's field

// GPS error code -> which message to show (1 denied, 2 unavailable, 3 timeout).
const GEO_ERROR = { 1: 'denied', 2: 'unavailable', 3: 'timeout' };
const SAMPLED = fieldIndex();
// Dot look: small visible dot plus an invisible stroke so the tap target is ~24 px. Kept modest because the 300 dots
// sit ~4 km apart: a bigger target would swallow most map taps at the starting zoom. Tapping the map works too.
const DOT = { radius: 6, color: '#1f5130', weight: 12, opacity: 0, fillColor: '#2f7a46', fillOpacity: 0.85 };
const DOT_ON = { ...DOT, fillColor: '#f2b33d', fillOpacity: 1 };

// The 300 study fields we have data for. Tapping one loads exactly that field.
function SampledDots({ selectedId, onPick, label }) {
  return SAMPLED.map((f) => (
    <CircleMarker key={f.id} center={[f.lat, f.lon]} pathOptions={f.id === selectedId ? DOT_ON : DOT}
      bubblingMouseEvents={false} eventHandlers={{ click: () => onPick(f.id) }}>
      <Tooltip>{label(f)}</Tooltip>
    </CircleMarker>
  ));
}

function ClickToPick({ onPick }) {
  useMapEvents({ click: (e) => onPick(e.latlng.lat, e.latlng.lng) });
  return null;
}

// Leaflet doesn't notice when its box changes size (rotation, window resize, layout switch).
function FitOnResize() {
  const map = useMap();
  useEffect(() => {
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map]);
  return null;
}

// When a field loads, zoom to it so its 30 m square is visible.
function FlyToField({ field }) {
  const map = useMap();
  useEffect(() => {
    if (field) map.flyTo([field.field.lat, field.field.lon], 15, { duration: 0.8 });
  }, [field, map]);
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

// Plain-language field summary. Science details sit in the small grey lines.
export function FieldFacts({ field }) {
  const { t } = useApp();
  const { soil, terrain } = field;
  const recent = field.cropHistory.slice(-3).reverse();
  return (
    <div className="facts">
      <Fact icon={MapPin} label={t('pick.location')}
        value={t('pick.countyValue', { county: field.field.county, state: field.field.state })}
        detail={t('pick.cellDetail', { cell: field.field.gridCell })} />
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

export default function PickField() {
  const { t, field, pickField, pickFieldById, pickDemo, retryLoad, loadError, loading, setScreen } = useApp();
  const online = useOnline();
  // How the current field was picked ('tap' | 'gps' | 'dot') and the state of the GPS button. No coordinates are kept here.
  const [via, setVia] = useState('tap');
  const [geo, setGeo] = useState(null); // null | 'locating' | 'denied' | 'unavailable' | 'timeout' | 'unsupported'
  const tapPick = (lat, lon) => { setVia('tap'); setGeo(null); pickField(lat, lon); };
  const dotPick = (id) => { setVia('dot'); setGeo(null); pickFieldById(id); };
  const dotLabel = (f) => t('pick.dotLabel', { id: f.id, county: f.county });

  // Privacy: the GPS point exists only inside this callback. It goes to pickField() to find the nearest sampled
  // field and is never put in state, storage, a URL or a request. Low accuracy is enough (nearest of 300 fields).
  function locateMe() {
    if (!navigator.geolocation || !window.isSecureContext) { setGeo('unsupported'); return; }
    setGeo('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => { setVia('gps'); setGeo(null); pickField(pos.coords.latitude, pos.coords.longitude); },
      (err) => setGeo(GEO_ERROR[err.code] || 'unavailable'),
      { enableHighAccuracy: false, maximumAge: 600000, timeout: 10000 },
    );
  }

  const cell = field && [
    [field.field.lat - CELL_HALF_DEG, field.field.lon - CELL_HALF_DEG],
    [field.field.lat + CELL_HALF_DEG, field.field.lon + CELL_HALF_DEG],
  ];

  return (
    <div className="screen">
      <PageHead title={t('pick.title')} intro={t('pick.intro')} />

      <div className="split split-map">
      <section className="card card-flush map-card" aria-label={t('pick.mapLabel')}>
        {online ? (
          <MapContainer center={STUDY_AREA} zoom={13} scrollWheelZoom={false} className="map">
            <FitOnResize />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPick onPick={tapPick} />
            <SampledDots selectedId={field?.field?.id} onPick={dotPick} label={dotLabel} />
            <FlyToField field={field} />
            {cell && <Rectangle bounds={cell} pathOptions={{ color: '#1f5130', weight: 4, fillOpacity: 0.3 }} />}
          </MapContainer>
        ) : (
          <div className="notice" style={{ border: 0, borderRadius: 0 }}>
            <WifiOff size={20} aria-hidden="true" /><p>{t('pick.mapOffline')}</p>
          </div>
        )}
        <p className="map-caption"><Hand size={16} aria-hidden="true" />{t('pick.mapHint')}</p>
        <div className="locate">
          <button type="button" className="btn btn-block" disabled={geo === 'locating' || loading} onClick={locateMe}>
            {geo === 'locating' ? <LoaderCircle size={20} className="spin" aria-hidden="true" /> : <LocateFixed size={20} aria-hidden="true" />}
            {geo === 'locating' ? t('pick.locating') : t('pick.useLocation')}
          </button>
          {geo && geo !== 'locating' && (
            <p className="locate-error" role="alert"><TriangleAlert size={18} aria-hidden="true" /><span>{t(`pick.geo.${geo}`)}</span></p>
          )}
          {loadError && !loading && (
            <div className="locate-error" role="alert">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>{t(loadError.reason === 'missing' ? 'pick.loadMissing' : 'pick.loadError')}</span>
            </div>
          )}
          {loadError?.id && !loading && (
            <button type="button" className="btn btn-block" onClick={retryLoad}>
              <RotateCw size={20} aria-hidden="true" />{t('pick.retry')}
            </button>
          )}
        </div>
      </section>

      <div className="stack">
      {!field && (
        <section className="card">
          <h2>{t('pick.summaryTitle')}</h2>
          <p className="muted">{t('pick.emptySummary')}</p>
          <button type="button" className="btn btn-primary btn-block" disabled={loading} onClick={pickDemo}>
            {loading ? t('pick.loading') : t('pick.loadDemo')}
          </button>
        </section>
      )}

      {field && (
        <>
          <section className="card">
            <h2>{t('pick.summaryTitle')}</h2>
            {via === 'dot' && field.nearestKm == null && <p className="notice-inline">{t('pick.sampledField', { id: field.field.id })}</p>}
            {field.nearestKm != null && <p className="notice-inline">{t(via === 'gps' ? 'pick.nearestGps' : 'pick.nearest', { km: field.nearestKm, id: field.field.id })}</p>}
            {field.notCropland && field.nearestKm <= FAR_KM && <p className="notice-inline notice-warn">{t(via === 'gps' ? 'pick.notCroplandGps' : 'pick.notCropland')}</p>}
            {field.nearestKm > FAR_KM && <p className="notice-inline notice-warn">{t('pick.farAway', { km: field.nearestKm })}</p>}
            {field.fallbackReason && <p className="notice-inline">{t('pick.fallback')}</p>}
            <FieldFacts field={field} />
            <p className="source"><Lock size={14} aria-hidden="true" /><span>{t('pick.privacy')}</span></p>
            <Source datasets={['USDA SSURGO', 'SRTM', 'USDA Cropland Data Layer']} />
          </section>
          <button type="button" className="btn btn-primary btn-block" onClick={() => setScreen('farm')}>
            {t('pick.continue')}<ArrowRight size={20} aria-hidden="true" />
          </button>
        </>
      )}
      </div>
      </div>
    </div>
  );
}
