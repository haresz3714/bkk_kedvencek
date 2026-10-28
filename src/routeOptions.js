const PRIORITY_TYPES = ['SUBWAY', 'SUBURBAN_RAILWAY', 'RAIL'];
const PRIORITY_ROUTES = ['M1', 'M2', 'M3', 'M4', 'H5', 'H6', 'H7', 'H8', 'H9'];

function getRoutePriority(option) {
  if (
    PRIORITY_TYPES.includes(option.type) ||
    PRIORITY_ROUTES.includes(option.route)
  ) return 0;
  if (option.type === 'TRAM') return 1;
  return 2;
}

export function sortRouteOptions(options) {
  const tramRouteNames = new Set(
    options.filter(option => option.type === 'TRAM').map(option => option.route)
  );

  return options
    .filter(option => option.type !== 'BUS' || !tramRouteNames.has(option.route))
    .sort((a, b) =>
      getRoutePriority(a) - getRoutePriority(b) ||
      a.route.localeCompare(b.route, undefined, { numeric: true })
    );
}
