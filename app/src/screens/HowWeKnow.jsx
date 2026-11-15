// "How we know": plain-language explanations of every term and data limit the app uses.
// Opened from the header and from "How we know" links on cards. Text lives in i18n under glossary.<id>.
import { useEffect } from 'react';
import { ArrowLeft, BookOpen, Lightbulb, Database } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { PageHead, JudgmentNote } from '../components/Small.jsx';
import ValidationCard from '../components/ValidationCard.jsx';

// Terms in reading order, with the datasets behind each (dataset names are not translated).
const TERMS = [
  { id: 'ndvi', data: ['Landsat 5/7/8/9'] },
  { id: 'ndti', data: ['Landsat 5/7/8/9'] },
  { id: 'evapotranspiration', data: ['MODIS MOD16A2GF'] },
  { id: 'soilMoisture', data: ['SMAP L4'] },
  { id: 'frost', data: ['NASA POWER', 'PRISM'] },
  { id: 'prism', data: ['PRISM', 'NASA POWER', 'GPM IMERG'] },
  { id: 'waterBalance', data: ['NASA POWER', 'GPM IMERG', 'FAO'] },
  { id: 'bareDays', data: ['Landsat 8/9', 'USDA Cropland Data Layer'] },
  { id: 'kFactor', data: ['USDA SSURGO', 'SRTM'] },
  { id: 'tFactor', data: ['USDA SSURGO'] },
  { id: 'waterStorage', data: ['USDA SSURGO'] },
  { id: 'landCapability', data: ['USDA SSURGO'] },
  { id: 'grossRevenue', data: ['NASS Quick Stats'] },
  { id: 'confidence', data: [] },
];
const NOTES = [{ id: 'satVsGround' }, { id: 'sensor2013', data: ['Landsat 8/9', 'Landsat 5/7/8/9'] }, { id: 'privacy', data: ['US Census Geocoder'] }];

function Entry({ id, data = [] }) {
  const { t, how } = useApp();
  return (
    <article className={`how-term${how.term === id ? ' is-target' : ''}`} id={`term-${id}`}>
      <h3>{t(`glossary.${id}.title`)}</h3>
      <p>{t(`glossary.${id}.text`)}</p>
      {data.length > 0 && (
        <div className="pills" aria-label={t('how.dataLabel')}>
          <Database size={14} aria-hidden="true" className="how-data-icon" />
          {data.map((d) => <span key={d} className="pill">{d}</span>)}
        </div>
      )}
    </article>
  );
}

export default function HowWeKnow() {
  const { t, how, setScreen } = useApp();

  // App.jsx scrolls to the top after a screen change, so wait a beat before jumping to a term.
  useEffect(() => {
    if (!how.term) return undefined;
    const id = setTimeout(() => document.getElementById(`term-${how.term}`)?.scrollIntoView({ block: 'start' }), 60);
    return () => clearTimeout(id);
  }, [how.term]);

  const jump = (id) => document.getElementById(`term-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const back = () => setScreen(how.from);

  return (
    <div className="screen screen-narrow">
      <button type="button" className="btn-text btn-back" onClick={back}>
        <ArrowLeft size={18} aria-hidden="true" />{t('how.back')}
      </button>
      <PageHead title={t('how.title')} intro={t('how.intro')} />

      <nav className="card" aria-label={t('how.jump')}>
        <h2 className="card-kicker">{t('how.jump')}</h2>
        <div className="chips chips-jump">
          {[...TERMS, ...NOTES].map(({ id }) => (
            <button key={id} type="button" className="chip" onClick={() => jump(id)}>{t(`glossary.${id}.title`)}</button>
          ))}
        </div>
      </nav>

      <section className="card how-list" aria-labelledby="how-terms">
        <h2 id="how-terms" className="card-kicker"><BookOpen size={18} aria-hidden="true" />{t('how.termsTitle')}</h2>
        {TERMS.map((x) => <Entry key={x.id} {...x} />)}
      </section>

      <section className="card how-list" aria-labelledby="how-notes">
        <h2 id="how-notes" className="card-kicker"><Lightbulb size={18} aria-hidden="true" />{t('how.notesTitle')}</h2>
        {NOTES.map((x) => <Entry key={x.id} {...x} />)}
      </section>

      <ValidationCard />

      <JudgmentNote />

      <button type="button" className="btn btn-primary btn-block btn-cta" onClick={back}>
        <ArrowLeft size={20} aria-hidden="true" />{t(`how.backTo.${how.from}`)}
      </button>
    </div>
  );
}
