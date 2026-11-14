import { useEffect } from 'react';
import { useApp } from './state/AppContext.jsx';
import Header from './components/Header.jsx';
import BottomNav from './components/BottomNav.jsx';
import PickField from './screens/PickField.jsx';
import YourFarm from './screens/YourFarm.jsx';
import FieldStory from './screens/FieldStory.jsx';
import CompareRotations from './screens/CompareRotations.jsx';
import ExpertHandoff from './screens/ExpertHandoff.jsx';
import HowWeKnow from './screens/HowWeKnow.jsx';

// To add a screen: add it here and to SCREENS in components/BottomNav.jsx.
const SCREEN_COMPONENTS = {
  field: PickField,
  farm: YourFarm,
  story: FieldStory,
  compare: CompareRotations,
  handoff: ExpertHandoff,
  how: HowWeKnow, // opened from the header and from card links, not a bottom tab
};

export default function App() {
  const { screen } = useApp();
  const Screen = SCREEN_COMPONENTS[screen];
  useEffect(() => { window.scrollTo(0, 0); }, [screen]);
  return (
    <div className="app">
      <Header />
      <main><Screen /></main>
      <BottomNav />
    </div>
  );
}
