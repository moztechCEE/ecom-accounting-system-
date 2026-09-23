import { useState } from 'react';
import mascot from './corely-claw.png';

/** The same Corely Claw artwork and finite greeting animation as customer service. */
export function ClawMascot({ variant }: { variant: 'launcher' | 'header' }) {
  return <span className={`claw-mascot mascot-${variant}`} aria-hidden="true">
    <span className="mascot-floor" />
    <span className="mascot-arrival"><span className="mascot-pose"><img src={mascot} alt="" draggable={false} /></span></span>
    <svg className="mascot-charm mascot-heart" width="12" height="12" viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
    <svg className="mascot-charm mascot-spark" width="11" height="11" viewBox="0 0 24 24"><path d="m12 2 2.8 7.2L22 12l-7.2 2.8L12 22l-2.8-7.2L2 12l7.2-2.8Z" /></svg>
  </span>;
}

export function ClawGreeting({ label }: { label: string }) {
  const [greeting, setGreeting] = useState(0);
  return <button type="button" className="claw-greeting-button mascot-interaction" aria-label={label} title={label} onClick={() => setGreeting(value => value + 1)}>
    <ClawMascot key={greeting} variant="header" />
  </button>;
}
