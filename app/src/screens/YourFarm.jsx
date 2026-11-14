// Screen 2: the farmer's current rotation, priorities and limits.
import { useApp } from '../state/AppContext.jsx';
import ChipGroup from '../components/ChipGroup.jsx';
import RotationPicker from '../components/RotationPicker.jsx';
import { PRIORITIES } from '@scoring/index.js';

// Option ids. Their labels live in i18n under options.<group>.<id>.
const OPTIONS = {
  waterMode: ['dryland', 'irrigated'],
  equipment: ['no_till_drill', 'conventional', 'baler', 'none'],
  budget: ['low', 'medium', 'high'],
  waterSource: ['rain', 'well', 'pond', 'canal'],
  market: ['elevator', 'gin', 'cattle', 'local'],
};

export default function YourFarm() {
  const { t, farm, updateFarm, setScreen } = useApp();
  const opt = (group) => (id) => t(`options.${group}.${id}`);

  return (
    <div className="screen">
      <h1>{t('farm.title')}</h1>

      <section className="card">
        <h2>{t('farm.currentRotation')}</h2>
        <p className="hint">{t('farm.currentHint')}</p>
        <RotationPicker value={farm.currentRotation} onChange={(v) => updateFarm({ currentRotation: v })} />
      </section>

      <section className="card">
        <h2>{t('farm.priorities')}</h2>
        <ChipGroup multi options={PRIORITIES} value={farm.priorities} onChange={(v) => updateFarm({ priorities: v })} labelFor={(id) => t(`priorities.${id}`)} />
      </section>

      <section className="card">
        <h2>{t('farm.waterMode')}</h2>
        <ChipGroup options={OPTIONS.waterMode} value={farm.waterMode} onChange={(v) => updateFarm({ waterMode: v })} labelFor={opt('waterMode')} />
        <h2>{t('farm.waterSource')}</h2>
        <ChipGroup options={OPTIONS.waterSource} value={farm.waterSource} onChange={(v) => updateFarm({ waterSource: v })} labelFor={opt('waterSource')} />
        <h2>{t('farm.equipment')}</h2>
        <ChipGroup multi options={OPTIONS.equipment} value={farm.equipment} onChange={(v) => updateFarm({ equipment: v })} labelFor={opt('equipment')} />
        <h2>{t('farm.budget')}</h2>
        <ChipGroup options={OPTIONS.budget} value={farm.budget} onChange={(v) => updateFarm({ budget: v })} labelFor={opt('budget')} />
        <h2>{t('farm.market')}</h2>
        <ChipGroup options={OPTIONS.market} value={farm.market} onChange={(v) => updateFarm({ market: v })} labelFor={opt('market')} />
      </section>

      <button className="btn primary wide" onClick={() => setScreen('compare')}>{t('farm.seeResults')}</button>
    </div>
  );
}
