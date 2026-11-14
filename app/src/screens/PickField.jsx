// Screen 1: tap the map to load a field, then see the field at a glance.
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Rectangle, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { Hand, Layers, Mountain, Wheat, MapPin, ArrowRight, WifiOff, Lock } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
import { PageHead, Source } from '../components/Small.jsx';
import { slopeWord } from '../display.js';
// import FieldWalkMode from '../components/future/FieldWalkMode.jsx';  // FUTURE
// import MemoryPins from '../components/future/MemoryPins.jsx';        // FUTURE

const NORTH_TEXAS = [33.15, -97.3];
const CELL_HALF_DEG = 0.000135; // ~15 m, so the box is one 30 m cell

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

function Fact({ icon: Icon, tone, label, value, detail, term }) {
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
  const { t, field, pickField, pickDemo, loading, setScreen } = useApp();
  const online = useOnline();
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
          <MapContainer center={NORTH_TEXAS} zoom={8} scrollWheelZoom={false} className="map">
            <FitOnResize />
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPick onPick={pickField} />
            <FlyToField field={field} />
            {cell && <Rectangle bounds={cell} pathOptions={{ color: '#1f5130', weight: 4, fillOpacity: 0.3 }} />}
          </MapContainer>
        ) : (
          <div className="notice" style={{ border: 0, borderRadius: 0 }}>
            <WifiOff size={20} aria-hidden="true" /><p>{t('pick.mapOffline')}</p>
          </div>
        )}
        <p className="map-caption"><Hand size={16} aria-hidden="true" />{t('pick.mapHint')}</p>
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
            {field.nearestKm != null && <p className="notice-inline">{t('pick.nearest', { km: field.nearestKm, id: field.field.id })}</p>}
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
