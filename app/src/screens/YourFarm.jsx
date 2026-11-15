// Screen 2: the farmer's current rotation, goals and limits, in three numbered step cards.
import { ArrowRight, Sprout, Target, SlidersHorizontal, Lock } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import ChipGroup from '../components/ChipGroup.jsx';
import RotationPicker from '../components/RotationPicker.jsx';
import { PageHead } from '../components/Small.jsx';
import { PRIORITIES } from '@scoring/index.js';

// Option ids. Their labels live in i18n under options.<group>.<id>.
const OPTIONS = {
  waterMode: ['dryland', 'irrigated'],
  equipment: ['no_till_drill', 'conventional', 'baler', 'none'],
  budget: ['low', 'medium', 'high'],
  waterSource: ['rain', 'well', 'pond', 'canal'],
  market: ['elevator', 'gin', 'cattle', 'local'],
};

// One step card: number pill + icon title on the left, a short status on the right.
function Step({ n, icon: Icon, title, meta, children }) {
  const { t } = useApp();
  return (
    <section className="card" aria-labelledby={`step-${n}`}>
      <div className="card-head">
        <h2 id={`step-${n}`} className="card-kicker">
          <span className="step-pill">{t('farm.stepN', { n })}</span>
          <Icon size={18} aria-hidden="true" />{title}
        </h2>
        {meta && <span className="card-meta">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Group({ label, children }) {
  return <div className="field-group"><span className="group-label">{label}</span>{children}</div>;
}

export default function YourFarm() {
  const { t, farm, updateFarm, setScreen } = useApp();
  const opt = (group) => (id) => t(`options.${group}.${id}`);

  return (
    <div className="screen screen-narrow">
      <PageHead title={t('farm.title')} intro={t('farm.intro')} />

      <Step n={1} icon={Sprout} title={t('farm.step1')}
        meta={farm.currentRotation.length ? t('farm.metaCrops', { n: farm.currentRotation.length }) : null}>
        <RotationPicker label={t('farm.step1')} value={farm.currentRotation} onChange={(v) => updateFarm({ currentRotation: v })} />
      </Step>

      <Step n={2} icon={Target} title={t('farm.step2')} meta={t('farm.metaPicked', { n: farm.priorities.length })}>
        <p className="hint">{t('farm.step2Hint')}</p>
        <ChipGroup multi label={t('farm.step2')} options={PRIORITIES} value={farm.priorities} onChange={(v) => updateFarm({ priorities: v })} labelFor={(id) => t(`priorities.${id}`)} />
      </Step>

      <Step n={3} icon={SlidersHorizontal} title={t('farm.step3')}>
        <Group label={t('farm.waterMode')}>
          <ChipGroup label={t('farm.waterMode')} options={OPTIONS.waterMode} value={farm.waterMode} onChange={(v) => updateFarm({ waterMode: v })} labelFor={opt('waterMode')} />
        </Group>
        <Group label={t('farm.waterSource')}>
          <ChipGroup label={t('farm.waterSource')} options={OPTIONS.waterSource} value={farm.waterSource} onChange={(v) => updateFarm({ waterSource: v })} labelFor={opt('waterSource')} />
        </Group>
        <Group label={t('farm.equipment')}>
          <ChipGroup multi label={t('farm.equipment')} options={OPTIONS.equipment} value={farm.equipment} onChange={(v) => updateFarm({ equipment: v })} labelFor={opt('equipment')} />
        </Group>
        <Group label={t('farm.budget')}>
          <ChipGroup label={t('farm.budget')} options={OPTIONS.budget} value={farm.budget} onChange={(v) => updateFarm({ budget: v })} labelFor={opt('budget')} />
        </Group>
        <Group label={t('farm.market')}>
          <ChipGroup label={t('farm.market')} options={OPTIONS.market} value={farm.market} onChange={(v) => updateFarm({ market: v })} labelFor={opt('market')} />
        </Group>
      </Step>

      <p className="source"><Lock size={14} aria-hidden="true" /><span>{t('farm.privacy')}</span></p>

      <button type="button" className="btn btn-primary btn-block btn-cta" onClick={() => setScreen('compare')}>
        {t('farm.seeResults')}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
