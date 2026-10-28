import { Bus, TramFront } from 'lucide-react';

const OFFICIAL_ROUTE_COLORS = {
  M1: { background: '#FFD800', text: '#000000' },
  M2: { background: '#FF1C24', text: '#FFFFFF' },
  M3: { background: '#005CA5', text: '#FFFFFF' },
  M4: { background: '#19A74E', text: '#FFFFFF' },
  H5: { background: '#821066', text: '#FFFFFF' },
  H6: { background: '#884200', text: '#FFFFFF' },
  H7: { background: '#EE7203', text: '#FFFFFF' },
  H8: { background: '#E56EA6', text: '#FFFFFF' },
  H9: { background: '#E56EA6', text: '#FFFFFF' }
};

export default function VehicleBadge({ route, type, color, textColor, className = '' }) {
  const officialColors = Object.hasOwn(OFFICIAL_ROUTE_COLORS, route)
    ? OFFICIAL_ROUTE_COLORS[route]
    : undefined;
  const backgroundColor = officialColors?.background || (color ? `#${color}` : '#009FE3');
  const foregroundColor = officialColors?.text || (textColor ? `#${textColor}` : '#FFFFFF');
  const isBadgeOnly = Boolean(officialColors) ||
    type === 'SUBWAY' || type === 'SUBURBAN_RAILWAY' || type === 'RAIL';

  return (
    <span
      className={`flex flex-shrink-0 items-center rounded px-2 py-0.5 text-sm font-bold ${isBadgeOnly ? 'mr-2 min-w-[2.5rem] justify-center' : 'mr-2' } ${className}`}
      style={{ backgroundColor, color: foregroundColor }}
    >
      {!isBadgeOnly && (type === 'TRAM'
        ? <TramFront className="mr-1 h-3 w-3" />
        : <Bus className="mr-1 h-3 w-3" />)}
      {route}
    </span>
  );
}
