// "Holds up / Under strain / Struggles" pill for a bad-year replay. Icon + words, never colour alone.
import { CircleCheck, TriangleAlert, CircleX } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

const ICON = { holds: CircleCheck, strained: TriangleAlert, struggles: CircleX };

// maxed: the scenario score bottomed out at 0, so the verdict reads "Struggles badly" and can stand in for the number.
export default function Verdict({ verdict: v, maxed = false, big = false }) {
  const { t } = useApp();
  const verdict = maxed ? 'struggles' : v;
  const Icon = ICON[verdict];
  if (!Icon) return null;
  return (
    <span className={`verdict verdict-${verdict}${big ? ' verdict-big' : ''}`}>
      <Icon size={big ? 20 : 16} aria-hidden="true" />{t(`replayUi.verdict.${maxed ? 'maxed' : verdict}`)}
    </span>
  );
}
