// Screen 1: tap the map to load a field, then see a summary card.
import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Rectangle, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { useApp } from '../state/AppContext.jsx';
import GlossaryIcon from '../components/GlossaryIcon.jsx';
// import FieldWalkMode from '../components/future/FieldWalkMode.jsx';  // FUTURE
// import MemoryPins from '../components/future/MemoryPins.jsx';        // FUTURE

const NORTH_TEXAS = [33.15, -97.3];
const CELL_HALF_DEG = 0.000135; // ~15 m, so the box is one 30 m cell

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

export function FieldSummary({ field }) {
  const { t } = useApp();
  const { soil } = field;
  const recent = field.cropHistory.slice(-3).reverse();
  return (
    <dl className="summary">
      <div><dt>{t('pick.county')}</dt><dd>{field.field.county}, {field.field.state}</dd></div>
      <div><dt>{t('pick.cell')}</dt><dd className="mono">{field.field.gridCell}</dd></div>
      <div>
        <dt>{t('pick.soil')} <GlossaryIcon term="hydrologicGroup" /></dt>
        <dd>
          {soil.seriesName} · {t(`soil.texture.${soil.texture}`)} · {t(`soil.drainage.${soil.drainageClass}`)}
          <br />{t('soil.organicMatter', { value: soil.organicMatterPct })} · {t('soil.group', { group: soil.hydrologicGroup })}
        </dd>
      </div>
      <div><dt>{t('pick.slope')} <GlossaryIcon term="slope" /></dt><dd>{field.terrain.slopePct}%</dd></div>
      <div>
        <dt>{t('pick.recentCrops')}</dt>
        <dd>{recent.map((h) => `${h.year}: ${t(`crops.${h.crop}`)}`).join(' · ')}</dd>
      </div>
    </dl>
  );
}

export default function PickField() {
  const { t, field, pickField, setScreen } = useApp();
  const online = useOnline();
  const cell = field && [
    [field.field.lat - CELL_HALF_DEG, field.field.lon - CELL_HALF_DEG],
    [field.field.lat + CELL_HALF_DEG, field.field.lon + CELL_HALF_DEG],
  ];

  return (
    <div className="screen">
      <h1>{t('pick.title')}</h1>
      <p className="hint">{t('pick.hint')}</p>

      {online ? (
        <div className="map-wrap">
          <MapContainer center={NORTH_TEXAS} zoom={8} scrollWheelZoom={false} className="map">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <ClickToPick onPick={pickField} />
            {cell && <Rectangle bounds={cell} pathOptions={{ color: '#c2410c', weight: 3 }} />}
          </MapContainer>
        </div>
      ) : (
        <p className="notice">{t('pick.mapOffline')}</p>
      )}

      {!field && (
        <button className="btn" onClick={() => pickField(NORTH_TEXAS[0], NORTH_TEXAS[1])}>{t('pick.loadSample')}</button>
      )}

      {field && (
        <section className="card">
          <h2>{t('pick.summaryTitle')}</h2>
          <FieldSummary field={field} />
          <p className="muted small">{t('pick.privacy')}</p>
          <button className="btn primary" onClick={() => setScreen('farm')}>{t('pick.continue')}</button>
        </section>
      )}
    </div>
  );
}
