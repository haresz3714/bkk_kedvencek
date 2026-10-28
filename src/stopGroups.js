function normalizeStopGroupName(name) {
  return name
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\s+M$/i, '')
    .toLocaleLowerCase('hu');
}

function isMetroVariant(name) {
  return /\s+M$/i.test(name);
}

export function groupStopsByName(stopIds, stopsById) {
  const groupedStops = new Map();

  stopIds.forEach(id => {
    const stop = stopsById[id];
    if (!stop?.name) return;

    const name = stop.name.trim().replace(/\s+/g, ' ');
    const key = normalizeStopGroupName(name);
    const stopId = stop.id || id;
    let group = groupedStops.get(key);

    if (!group) {
      group = { name, stopId, stopIds: [] };
      groupedStops.set(key, group);
    }

    if (!group.stopIds.includes(stopId)) group.stopIds.push(stopId);
    if (isMetroVariant(group.name) && !isMetroVariant(name)) {
      group.name = name;
    }
  });

  return Array.from(groupedStops.values());
}
