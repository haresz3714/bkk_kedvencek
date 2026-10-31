function getCanonicalStopName(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+M(?:\s*\+\s*H)?$/i, '');
}

function normalizeStopGroupName(name) {
  return getCanonicalStopName(name)
    .toLocaleLowerCase('hu');
}

function isTransitStationVariant(name) {
  return getCanonicalStopName(name) !== name.trim().replace(/\s+/g, ' ');
}

export function groupStopsByName(stopIds, stopsById) {
  const groupedStops = new Map();

  stopIds.forEach(id => {
    const stop = stopsById[id];
    if (!stop?.name) return;

    const name = stop.name.trim().replace(/\s+/g, ' ');
    const key = normalizeStopGroupName(name);
    const stopId = id;
    let group = groupedStops.get(key);

    if (!group) {
      group = { name, stopId, stopIds: [] };
      groupedStops.set(key, group);
    }

    if (!group.stopIds.includes(stopId)) group.stopIds.push(stopId);
    if (isTransitStationVariant(group.name) && !isTransitStationVariant(name)) {
      group.name = name;
    }
  });

  return Array.from(groupedStops.values());
}
