// Screen 2: the farmer's current rotation, goals and limits, in three numbered steps.
import { ArrowRight } from 'lucide-react';
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

function Step({ n, title, children }) {
  return (
    <section className="card">
      <h2 className="step-title"><span className="step-num" aria-hidden="true">{n}</span>{title}</h2>
      {children}
    </section>
  );
}

function Group({ label, children }) {
  return <div className="field-group"><span className="field-label">{label}</span>{children}</div>;
}

export default function YourFarm() {
  const { t, farm, updateFarm, setScreen } = useApp();
  const opt = (group) => (id) => t(`options.${group}.${id}`);

  return (
    <div className="screen">
      <PageHead title={t('farm.title')} intro={t('farm.intro')} />

      <div className="split split-farm">
      <div className="stack">
      <Step n={1} title={t('farm.step1')}>
        <RotationPicker label={t('farm.step1')} value={farm.currentRotation} onChange={(v) => updateFarm({ currentRotation: v })} />
      </Step>

      <Step n={2} title={t('farm.step2')}>
        <p className="hint">{t('farm.step2Hint')}</p>
        <ChipGroup multi label={t('farm.step2')} options={PRIORITIES} value={farm.priorities} onChange={(v) => updateFarm({ priorities: v })} labelFor={(id) => t(`priorities.${id}`)} />
      </Step>

      </div>
      <div className="stack">
      <Step n={3} title={t('farm.step3')}>
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
      </div>
      </div>

      <button type="button" className="btn btn-primary btn-block btn-end" onClick={() => setScreen('compare')}>
        {t('farm.seeResults')}<ArrowRight size={20} aria-hidden="true" />
      </button>
    </div>
  );
}
