// Farm simulator (under "More"): the farm game. Its start screen is the first thing shown; "Play this plan" on Plans /
// Compare lands here too. The game (scene, toolbar, engine worker) loads as its own chunk when this screen opens.
import { Suspense, lazy } from 'react';
import { useApp } from '../state/AppContext.jsx';

const FarmGame = lazy(() => import('../game/FarmGame.jsx'));

export default function FarmSimulator() {
  const { t } = useApp();
  return (
    <Suspense fallback={<div className="screen"><p className="muted" role="status">{t('game.loading')}</p></div>}>
      <FarmGame />
    </Suspense>
  );
}
