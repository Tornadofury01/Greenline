// "Holds up / Under strain / Struggles" pill for a bad-year replay. Icon + words, never colour alone.
import { CircleCheck, TriangleAlert, CircleX } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';

const ICON = { holds: CircleCheck, strained: TriangleAlert, struggles: CircleX };

export default function Verdict({ verdict }) {
  const { t } = useApp();
  const Icon = ICON[verdict];
  if (!Icon) return null;
  return (
    <span className={`verdict verdict-${verdict}`}>
      <Icon size={16} aria-hidden="true" />{t(`replayUi.verdict.${verdict}`)}
    </span>
  );
}
