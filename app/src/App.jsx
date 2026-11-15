import { useEffect, useRef } from 'react';
import { useApp } from './state/AppContext.jsx';
import Header from './components/Header.jsx';
import BottomNav from './components/BottomNav.jsx';
import PickField from './screens/PickField.jsx';
import YourFarm from './screens/YourFarm.jsx';
import FieldStory from './screens/FieldStory.jsx';
import CompareRotations from './screens/CompareRotations.jsx';
import Plans from './screens/Plans.jsx';
import Risks from './screens/Risks.jsx';
import FarmSimulator from './screens/FarmSimulator.jsx';
import ExpertHandoff from './screens/ExpertHandoff.jsx';
import HowWeKnow from './screens/HowWeKnow.jsx';

// To add a screen: add it here and to SCREENS in components/BottomNav.jsx.
const SCREEN_COMPONENTS = {
  field: PickField,
  farm: YourFarm,
  story: FieldStory,
  risks: Risks,
  options: Plans, // compatibility: the navigation setter opens Browse all rotations
  plans: Plans,
  sim: FarmSimulator,
  compare: CompareRotations,
  handoff: ExpertHandoff,
  how: HowWeKnow, // opened from the header and from card links, not a bottom tab
};

export default function App() {
  const { screen, pickFieldById, setScreen } = useApp();
  const openedLink = useRef(false);
  useEffect(() => {
    if (openedLink.current) return;
    openedLink.current = true;
    // Share a sampled field's replay by id, never a GPS point or farmer answer.
    const query = new URLSearchParams(window.location.search);
    const id = query.get('field');
    // Any safe field id (ec-251 today, 48257-0000 after the pipeline merge); an unknown id shows the load error + Retry.
    if (/^[A-Za-z0-9_-]{1,40}$/.test(id || '')) {
      pickFieldById(id);
      if (SCREEN_COMPONENTS[query.get('screen')]) setScreen(query.get('screen'));
    }
  }, [pickFieldById, setScreen]);
  const Screen = SCREEN_COMPONENTS[screen];
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);
  return (
    <div className={`app${screen === 'field' ? ' app-map' : ''}`}>
      <Header />
      <main><Screen /></main>
      <BottomNav />
    </div>
  );
}
