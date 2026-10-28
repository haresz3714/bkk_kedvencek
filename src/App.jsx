import { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { Search, MapPin, Clock, Trash2, X, Sun, Moon, Bell, ChevronDown, RefreshCw, Route } from 'lucide-react';
import SavedRoutes from './SavedRoutes.jsx';
import VehicleBadge from './VehicleBadge.jsx';
import { groupStopsByName } from './stopGroups.js';

const API_KEY = import.meta.env.VITE_BKK_API_KEY;
const ALERT_FILTERS = [
  { id: 'metro', label: 'Metró' },
  { id: 'tram', label: 'Villamos' },
  { id: 'bus', label: 'Busz' },
  { id: 'hev', label: 'HÉV' },
  { id: 'trolley', label: 'Troli' },
  { id: 'night', label: 'Éjszakai' },
  { id: 'other', label: 'Egyéb' }
];
const getTranslatedAlertText = (value) =>
  value?.translations?.hu || value?.translations?.en || value?.someTranslation || '';

function getAlertCategories(alert) {
  const categories = new Set();
  const routes = alert.routes || [];

  routes.forEach(routeAlert => {
    const route = routeAlert.route || {};
    const name = String(route.shortName || route.routeShortName || '').trim();
    const type = route.type;

    if (type === 'SUBWAY' || /^M[1-4]$/i.test(name)) categories.add('metro');
    else if (type === 'TRAM') categories.add('tram');
    else if (
      type === 'SUBURBAN_RAILWAY' ||
      /^H[5-9]$/i.test(name)
    ) categories.add('hev');
    else if (type === 'TROLLEYBUS') categories.add('trolley');
    else if (type === 'BUS') categories.add(/^9\d{2}[A-Z]?$/i.test(name) ? 'night' : 'bus');
    else if (type) categories.add('other');
  });

  if (categories.size === 0) {
    (alert.vehicleRouteTypes || []).forEach(type => {
      if (type === 'SUBWAY') categories.add('metro');
      else if (type === 'TRAM') categories.add('tram');
      else if (type === 'SUBURBAN_RAILWAY') categories.add('hev');
      else if (type === 'TROLLEYBUS') categories.add('trolley');
      else if (type === 'BUS') categories.add('bus');
      else categories.add('other');
    });
  }

  if (categories.size === 0) categories.add('other');
  return categories;
}

function normalizeAlertText(value) {
  const html = getTranslatedAlertText(value)
    .replace(/<br\s*\/?>|<\/(div|p|li|ul|ol)>/gi, ' ');
  return new DOMParser()
    .parseFromString(html, 'text/html')
    .body.textContent
    .replace(/\s+/g, ' ')
    .trim()
    .toLocaleLowerCase('hu');
}

function groupTrafficAlerts(alerts) {
  const groups = new Map();

  alerts.forEach(alert => {
    const routes = (alert.routes || [])
      .map(route => [
        route.routeId,
        route.effectType,
        normalizeAlertText(route.affectedEntityDescription),
        normalizeAlertText(route.header)
      ])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
    const contentKey = JSON.stringify([
      normalizeAlertText(alert.header),
      normalizeAlertText(alert.description),
      routes
    ]);
    const period = {
      start: alert.start,
      end: alert.end,
      endText: alert.endText
    };
    let group = groups.get(contentKey);

    if (!group) {
      group = { ...alert, groupKey: contentKey, occurrences: [] };
      groups.set(contentKey, group);
    }

    const periodKey = JSON.stringify([
      period.start || null,
      period.end || null,
      normalizeAlertText(period.endText)
    ]);
    if (!group.occurrences.some(existing => existing.key === periodKey)) {
      group.occurrences.push({ ...period, key: periodKey });
    }
  });

  return Array.from(groups.values()).map(group => ({
    ...group,
    occurrences: group.occurrences.sort((a, b) => (a.start || 0) - (b.start || 0))
  }));
}

function groupAlertPeriods(occurrences) {
  const groups = new Map();
  const standalone = [];

  occurrences.forEach(period => {
    if (!period.start || !period.end) {
      standalone.push({ ...period, count: 1 });
      return;
    }

    const start = new Date(period.start * 1000);
    const end = new Date(period.end * 1000);
    const startDay = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()) / 86400000;
    const endDay = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) / 86400000;
    const signature = [
      start.getHours(), start.getMinutes(),
      end.getHours(), end.getMinutes(),
      endDay - startDay,
      normalizeAlertText(period.endText)
    ].join(':');
    const group = groups.get(signature) || [];
    group.push({ ...period, startDay, signature });
    groups.set(signature, group);
  });

  const grouped = [];
  groups.forEach(periods => {
    periods.sort((a, b) => a.startDay - b.startDay);
    let run = [];

    const saveRun = () => {
      if (run.length === 0) return;
      grouped.push({
        ...run[0],
        end: run[run.length - 1].end,
        count: run.length
      });
      run = [];
    };

    periods.forEach(period => {
      if (run.length > 0 && period.startDay !== run[run.length - 1].startDay + 1) {
        saveRun();
      }
      run.push(period);
    });
    saveRun();
  });

  return [...grouped, ...standalone].sort((a, b) => (a.start || 0) - (b.start || 0));
}

function sanitizeAlertHtml(html) {
  const parsed = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const allowedTags = new Set(['A', 'B', 'BR', 'DIV', 'EM', 'I', 'LI', 'OL', 'P', 'SMALL', 'SPAN', 'STRONG', 'U', 'UL']);
  const removedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH', 'TEMPLATE']);

  const sanitizeNode = (node) => {
    if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.textContent || '');
    if (node.nodeType !== Node.ELEMENT_NODE) return document.createDocumentFragment();

    const element = node;
    if (removedTags.has(element.tagName)) return document.createDocumentFragment();

    const children = document.createDocumentFragment();
    element.childNodes.forEach(child => children.appendChild(sanitizeNode(child)));
    if (!allowedTags.has(element.tagName)) return children;

    const safeElement = document.createElement(element.tagName.toLowerCase());
    if (element.tagName === 'A') {
      safeElement.className = 'text-violet-300 underline underline-offset-2';
      const href = element.getAttribute('href');
      if (href) {
        try {
          const url = new URL(href, window.location.origin);
          if (url.protocol === 'https:' || url.protocol === 'http:') {
            safeElement.setAttribute('href', url.href);
            safeElement.setAttribute('target', '_blank');
            safeElement.setAttribute('rel', 'noopener noreferrer');
          }
        } catch {
          // Leave invalid links as plain text.
        }
      }
    }
    safeElement.appendChild(children);
    return safeElement;
  };

  const container = document.createElement('div');
  parsed.body.childNodes.forEach(node => container.appendChild(sanitizeNode(node)));
  return container.innerHTML;
}

function DestinationText({ children, className = '' }) {
  const containerRef = useRef(null);
  const textRef = useRef(null);
  const [overflowDistance, setOverflowDistance] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    const text = textRef.current;
    if (!container || !text) return;

    const updateOverflow = () => {
      setOverflowDistance(Math.max(0, text.scrollWidth - container.clientWidth));
    };

    updateOverflow();
    const resizeObserver = new ResizeObserver(updateOverflow);
    resizeObserver.observe(container);
    resizeObserver.observe(text);
    return () => resizeObserver.disconnect();
  }, [children]);

  const scrollStyle = overflowDistance > 0
    ? {
        '--destination-shift': `-${overflowDistance}px`,
        '--destination-duration': `${Math.max(6, overflowDistance / 18)}s`
      }
    : undefined;

  return (
    <span ref={containerRef} className={`min-w-0 flex-1 overflow-hidden ${className}`}>
      <span
        ref={textRef}
        className={`block w-max whitespace-nowrap${overflowDistance > 0 ? ' destination-scroll' : ''}`}
        style={scrollStyle}
      >
        {children}
      </span>
    </span>
  );
}

export default function App() {
  const [theme, setTheme] = useState(() =>
    document.documentElement.dataset.theme === 'light' ? 'light' : 'dark'
  );
  const [dashboardTab, setDashboardTab] = useState('departures');
  const [displayedDashboardTab, setDisplayedDashboardTab] = useState('departures');
  const [isDashboardContentExiting, setIsDashboardContentExiting] = useState(false);
  const dashboardTransitionTimeoutRef = useRef(null);
  const [favorites, setFavorites] = useState(() => {
    const saved = localStorage.getItem('bkk_favorites');
    return saved ? JSON.parse(saved) : [];
  });
  const [favoriteDrag, setFavoriteDrag] = useState(null);
  const [enteringFavoriteIds, setEnteringFavoriteIds] = useState(() => new Set());
  const favoritesListRef = useRef(null);
  const favoriteTouchPressRef = useRef(null);
  const favoriteTouchDragRef = useRef(null);

  // Most már tömböket (több időpontot) tárolunk egy-egy járathoz
  const [liveTimes, setLiveTimes] = useState({});

  const [searchQuery, setSearchQuery] = useState('');
  const [stopResults, setStopResults] = useState([]);
  const [displayedStopResults, setDisplayedStopResults] = useState([]);
  const [recentStops, setRecentStops] = useState(() => {
    const saved = localStorage.getItem('bkk_recent_stops');
    return saved ? JSON.parse(saved) : [];
  });
  const [removingRecentStops, setRemovingRecentStops] = useState(() => new Set());
  const [removingFavoriteIds, setRemovingFavoriteIds] = useState(() => new Set());
  const [showRecentStops, setShowRecentStops] = useState(false);
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [selectedStopName, setSelectedStopName] = useState(null);
  const [routeOptions, setRouteOptions] = useState([]);
  const [isLoadingRoutes, setIsLoadingRoutes] = useState(false);
  const [searchPanelMinHeight, setSearchPanelMinHeight] = useState(null);
  const searchRoutePanelRef = useRef(null);
  const [showTrafficChanges, setShowTrafficChanges] = useState(false);
  const [trafficAlerts, setTrafficAlerts] = useState([]);
  const [isLoadingTrafficAlerts, setIsLoadingTrafficAlerts] = useState(false);
  const [trafficAlertsError, setTrafficAlertsError] = useState(null);
  const [trafficAlertsRefreshKey, setTrafficAlertsRefreshKey] = useState(0);
  const [selectedAlertFilters, setSelectedAlertFilters] = useState(() => new Set());
  const showStopResults = searchQuery.length >= 3 && stopResults.length > 0;
  const showRecentStopsPanel = showRecentStops && recentStops.length > 0;
  const isSearchSuggestionsOpen =
    showStopResults ||
    (showRecentStopsPanel && isSearchFocused && searchQuery.length === 0);

  const transitionSearchPanel = (update) => {
    if (typeof document.startViewTransition !== 'function') {
      update();
      return null;
    }

    return document.startViewTransition(() => flushSync(update));
  };

  const switchDashboardTab = (nextTab) => {
    if (nextTab === dashboardTab) return;

    setDashboardTab(nextTab);
    setIsDashboardContentExiting(true);
    window.clearTimeout(dashboardTransitionTimeoutRef.current);
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 140;
    dashboardTransitionTimeoutRef.current = window.setTimeout(() => {
      setDisplayedDashboardTab(nextTab);
      setIsDashboardContentExiting(false);
    }, duration);
  };

  useEffect(() => {
    localStorage.setItem('bkk_favorites', JSON.stringify(favorites));
  }, [favorites]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('bkk_theme', theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('bkk_recent_stops', JSON.stringify(recentStops));
  }, [recentStops]);

  useEffect(() => {
    if (!showTrafficChanges) return;

    if (!API_KEY || API_KEY === 'A_TE_API_KULCSOD') return;

    const controller = new AbortController();
    const fetchTrafficAlerts = async () => {
      try {
        const params = new URLSearchParams({
          key: API_KEY,
          filterClosed: 'true',
          listView: 'true',
          includeReferences: 'alerts,routes'
        });
        const response = await fetch(
          `https://go.bkk.hu/api/query/v1/ws/otp/api/where/alert-search.json?${params}`,
          { signal: controller.signal }
        );
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const result = await response.json();
        if (result.code !== 200 || !result.data) {
          throw new Error(result.text || 'Érvénytelen API-válasz');
        }

        const alertReferences = result.data.references?.alerts || {};
        const routeReferences = result.data.references?.routes || {};
        const alertIds = result.data.entry?.alertIds || [];
        const alerts = Array.isArray(alertReferences)
          ? alertReferences
          : alertIds.length > 0
            ? alertIds.map(id => alertReferences[id]).filter(Boolean)
            : Object.values(alertReferences);
        const uniqueAlerts = Array.from(
          new Map(alerts.filter(alert => alert?.id).map(alert => [alert.id, alert])).values()
        ).map(alert => ({
          ...alert,
          routes: (alert.routes || []).map(alertRoute => ({
            ...alertRoute,
            route: routeReferences[alertRoute.routeId]
          }))
        }));

        setTrafficAlerts(groupTrafficAlerts(uniqueAlerts));
      } catch (error) {
        if (error.name === 'AbortError') return;
        console.error('Forgalmi változások lekérési hiba:', error);
        setTrafficAlertsError('Nem sikerült betölteni a forgalmi változásokat. Próbáld újra később.');
      } finally {
        if (!controller.signal.aborted) setIsLoadingTrafficAlerts(false);
      }
    };

    fetchTrafficAlerts();
    return () => controller.abort();
  }, [showTrafficChanges, trafficAlertsRefreshKey]);

  useEffect(() => {
    if (favorites.length === 0 || !API_KEY || API_KEY === 'A_TE_API_KULCSOD') return;

    const controller = new AbortController();
    let active = true;
    let isFetching = false;

    const fetchTimes = async () => {
      if (isFetching || controller.signal.aborted) return;
      isFetching = true;

      try {
        const newTimes = {};
        const nowInSeconds = Math.floor(Date.now() / 1000);
        const uniqueStops = [...new Set(favorites.map(f => f.stopId))];
        const pendingStops = [...uniqueStops];
        const attemptedStopIds = new Set(uniqueStops);
        const stopDataById = new Map();
        const fetchStopData = async (stopId) => {
          const url = `https://go.bkk.hu/api/query/v1/ws/otp/api/where/arrivals-and-departures-for-stop.json?key=${API_KEY}&stopId=${stopId}&minutesBefore=0&minutesAfter=60`;
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const result = await response.json();
          if (result.code !== 200 || !result.data) {
            throw new Error(result.text || 'Érvénytelen API-válasz');
          }
          return result.data;
        };

        const workers = Array.from(
          { length: Math.min(4, pendingStops.length) },
          async () => {
            while (pendingStops.length > 0 && !controller.signal.aborted) {
              const stopId = pendingStops.shift();
              try {
                stopDataById.set(stopId, await fetchStopData(stopId));
              } catch (error) {
                if (error.name !== 'AbortError') {
                  console.error("API Hiba élő idők lekérésekor:", error);
                }
              }
            }
          }
        );
        await Promise.all(workers);
        if (!active || controller.signal.aborted) return;

        const findMatchingRides = (fav, stopData) => {
          const stopTimes = stopData?.entry?.stopTimes || [];
          const trips = stopData?.references?.trips || {};
          const routes = stopData?.references?.routes || {};
          let matchingRides = stopTimes.filter(item => {
            const trip = trips[item.tripId] || {};
            const route = routes[trip.routeId] || {};
            return route.shortName === fav.route &&
              (!fav.routeId || trip.routeId === fav.routeId);
          });

          if (matchingRides.length === 0) return matchingRides;

          if (!fav.routeId) {
            const tramRouteIds = new Set(
              Object.entries(routes)
                .filter(([, route]) => route.shortName === fav.route && route.type === 'TRAM')
                .map(([routeId]) => routeId)
            );
            if (tramRouteIds.size > 0) {
              matchingRides = matchingRides.filter(item =>
                tramRouteIds.has(trips[item.tripId]?.routeId)
              );
            }
          }

          if (fav.headsign) {
            const headsign = fav.headsign.toLowerCase();
            const matchingHeadsign = matchingRides.filter(item =>
              (item.stopHeadsign || '').toLowerCase().includes(headsign)
            );
            if (matchingHeadsign.length > 0) return matchingHeadsign;
          }

          if (fav.directionId !== undefined) {
            return matchingRides.filter(item =>
              String(trips[item.tripId]?.directionId) === String(fav.directionId)
            );
          }

          return matchingRides;
        };
        const getRideTime = ride =>
          ride.predictedDepartureTime || ride.predictedArrivalTime || ride.departureTime || ride.arrivalTime;

        const stopDataByName = new Map();
        const favoritesToMigrate = new Map();

        for (const fav of favorites) {
          let stopData = stopDataById.get(fav.stopId);
          let matchedStopId = fav.stopId;
          let lookupFailed = !stopData;
          let matchingRides = findMatchingRides(fav, stopData);

          if (matchingRides.length === 0 && fav.stopName) {
            try {
              let siblingStopIds = stopDataByName.get(fav.stopName);
              if (!siblingStopIds) {
                const response = await fetch(
                  `https://go.bkk.hu/api/query/v1/ws/otp/api/where/search.json?key=${API_KEY}&query=${encodeURIComponent(fav.stopName)}&includeReferences=true`,
                  { signal: controller.signal }
                );
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                const result = await response.json();
                if (result.code !== 200 || !result.data) {
                  throw new Error(result.text || 'Érvénytelen API-válasz');
                }
                const stops = result.data.references?.stops || {};
                siblingStopIds = (result.data.entry?.stopIds || [])
                  .filter(id => stops[id]?.name === fav.stopName);
                stopDataByName.set(fav.stopName, siblingStopIds);
              }

              for (const stopId of siblingStopIds) {
                if (!stopDataById.has(stopId)) {
                  if (attemptedStopIds.has(stopId)) {
                    lookupFailed = true;
                    continue;
                  }
                  attemptedStopIds.add(stopId);
                  try {
                    stopDataById.set(stopId, await fetchStopData(stopId));
                  } catch (error) {
                    lookupFailed = true;
                    if (error.name === 'AbortError') break;
                    console.error("API Hiba alternatív megálló élő idejének lekérésekor:", error);
                    continue;
                  }
                }

                const candidateStopData = stopDataById.get(stopId);
                const candidateRides = findMatchingRides(fav, candidateStopData);
                if (candidateRides.length > 0) {
                  stopData = candidateStopData;
                  matchedStopId = stopId;
                  matchingRides = candidateRides;
                  break;
                }
              }
            } catch (error) {
              lookupFailed = true;
              if (error.name !== 'AbortError') {
                console.error("API Hiba a megálló alternatív indulásainak lekérésekor:", fav.stopName, error);
              }
            }
          }

          if (controller.signal.aborted) return;

          if (matchingRides.length > 0) {
            const trips = stopData.references?.trips || {};
            const routes = stopData.references?.routes || {};
            const matchedTrip = trips[matchingRides[0].tripId] || {};
            const matchedRoute = routes[matchedTrip.routeId] || {};

            if (matchedRoute.type && (
              fav.routeId !== matchedTrip.routeId ||
              fav.directionId !== matchedTrip.directionId ||
              fav.stopId !== matchedStopId ||
              fav.type !== matchedRoute.type ||
              fav.color !== matchedRoute.color ||
              fav.textColor !== matchedRoute.textColor
            )) {
              favoritesToMigrate.set(fav.id, {
                routeId: matchedTrip.routeId,
                directionId: matchedTrip.directionId,
                stopId: matchedStopId,
                type: matchedRoute.type,
                color: matchedRoute.color,
                textColor: matchedRoute.textColor
              });
            }

            matchingRides.sort((a, b) => getRideTime(a) - getRideTime(b));

            const validTimes = matchingRides
              .map(ride => Math.round((getRideTime(ride) - nowInSeconds) / 60))
              .filter(mins => mins > -2);

            const formattedTimes = validTimes.map(mins => mins <= 0 ? 'Most' : `${mins}'`);
            newTimes[fav.id] = formattedTimes.length > 0 ? formattedTimes.slice(0, 3) : ['Nincs adat'];
          } else if (!lookupFailed) {
            newTimes[fav.id] = ['Nincs adat'];
          }
        }

        if (!active || controller.signal.aborted) return;

        if (favoritesToMigrate.size > 0) {
          setFavorites(currentFavorites => currentFavorites.map(fav => {
            const migration = favoritesToMigrate.get(fav.id);
            return migration ? { ...fav, ...migration } : fav;
          }));
        }

        setLiveTimes(currentTimes => {
          const updatedTimes = {};
          for (const fav of favorites) {
            if (Object.hasOwn(newTimes, fav.id)) {
              updatedTimes[fav.id] = newTimes[fav.id];
            } else if (currentTimes[fav.id]) {
              updatedTimes[fav.id] = currentTimes[fav.id];
            }
          }
          return updatedTimes;
        });
      } finally {
        isFetching = false;
      }
    };

    void fetchTimes();
    const interval = setInterval(() => void fetchTimes(), 30000);
    return () => {
      active = false;
      controller.abort();
      clearInterval(interval);
    };
  }, [favorites]);

  useEffect(() => {
    if (searchQuery.length < 3) {
      setStopResults([]);
      return;
    }

    const searchStops = async () => {
      if (!API_KEY || API_KEY === "A_TE_API_KULCSOD") return;
      try {
        const res = await fetch(`https://go.bkk.hu/api/query/v1/ws/otp/api/where/search.json?key=${API_KEY}&query=${encodeURIComponent(searchQuery)}&includeReferences=true`);
        const data = await res.json();

        if (data.code === 200 && data.data) {
          const stopIds = data.data.entry.stopIds || [];
          const stopsRef = data.data.references.stops || {};
          const grouped = groupStopsByName(stopIds, stopsRef);
          const results = grouped.slice(0, 8);
          setStopResults(results);
          if (results.length > 0) {
            setDisplayedStopResults(results);
            setShowRecentStops(false);
          }
        }
      } catch (e) {
        console.error("Keresési hiba:", e);
      }
    };

    const timeoutId = setTimeout(searchStops, 500);
    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const fetchRoutesForStop = async (stopName, stopIds) => {
    setSelectedStopName(stopName);
    setIsLoadingRoutes(true);
    setRouteOptions([]);
    const optionsMap = new Map();
    let optionsArr = [];

    try {
      const fetchPromises = stopIds.map(async (stopId) => {
        try {
          const res = await fetch(`https://go.bkk.hu/api/query/v1/ws/otp/api/where/schedule-for-stop.json?key=${API_KEY}&stopId=${stopId}&includeReferences=true`);
          const data = await res.json();

          if (data.code === 200 && data.data) {
            const schedules = data.data.entry.schedules || [];
            const routesRef = data.data.references.routes || {};

            schedules.forEach(sched => {
              const route = routesRef[sched.routeId];
              if (!route) return;

              sched.directions?.forEach(dir => {
                const dirId = dir.directionId;
                const key = `${route.id}-${dirId}`;
                let option = optionsMap.get(key);
                if (!option) {
                  option = {
                    routeId: route.id,
                    route: route.shortName,
                    directionId: dirId,
                    type: route.type,
                    color: route.color,
                    textColor: route.textColor,
                    headsignCounts: new Map(),
                    stopIdCounts: new Map()
                  };
                  optionsMap.set(key, option);
                }

                const stopTimes = dir.stopTimes || [];
                option.stopIdCounts.set(
                  stopId,
                  (option.stopIdCounts.get(stopId) || 0) + stopTimes.length
                );
                stopTimes.forEach(stopTime => {
                  if (!stopTime.stopHeadsign) return;
                  option.headsignCounts.set(
                    stopTime.stopHeadsign,
                    (option.headsignCounts.get(stopTime.stopHeadsign) || 0) + 1
                  );
                });
              });
            });
          }
        } catch (e) {
          console.error("Hiba a menetrend lekérésekor:", stopId, e);
        }
      });

      await Promise.all(fetchPromises);

      const options = Array.from(optionsMap.values()).map(option => {
        const [headsign] = Array.from(option.headsignCounts.entries()).sort((a, b) =>
          b[1] - a[1] || a[0].localeCompare(b[0], 'hu')
        )[0] || [];
        const [stopId] = Array.from(option.stopIdCounts.entries()).sort((a, b) =>
          b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))
        )[0] || [];

        return {
          stopId,
          routeId: option.routeId,
          route: option.route,
          directionId: option.directionId,
          headsign: headsign || "Ismeretlen",
          type: option.type,
          color: option.color,
          textColor: option.textColor
        };
      });
      const tramRouteNames = new Set(
        options.filter(option => option.type === 'TRAM').map(option => option.route)
      );
      const filteredOptions = options.filter(option =>
        option.type !== 'BUS' || !tramRouteNames.has(option.route)
      );

      const getRoutePriority = (option) => {
        if (
          ['SUBWAY', 'SUBURBAN_RAILWAY', 'RAIL'].includes(option.type) ||
          ['M1', 'M2', 'M3', 'M4', 'H5', 'H6', 'H7', 'H8', 'H9'].includes(option.route)
        ) {
          return 0;
        }
        if (option.type === 'TRAM') return 1;
        return 2;
      };

      optionsArr = filteredOptions.sort((a, b) =>
        getRoutePriority(a) - getRoutePriority(b) ||
        a.route.localeCompare(b.route, undefined, { numeric: true })
      );
    } catch (e) {
      console.error("Általános hiba az útvonalak feldolgozásakor:", e);
    }

    transitionSearchPanel(() => {
      setRouteOptions(optionsArr);
      setIsLoadingRoutes(false);
    });
  };

  const selectStop = (stop) => {
    const panel = searchRoutePanelRef.current?.getBoundingClientRect();
    const availablePanelHeight = panel
      ? window.innerHeight - panel.top - 16
      : 0;
    const panelHeight = panel
      ? Math.min(availablePanelHeight, Math.max(Math.min(panel.height, 420), 400))
      : null;

    transitionSearchPanel(() => {
      if (panelHeight) setSearchPanelMinHeight(panelHeight);
      setShowRecentStops(false);
      setRecentStops(currentStops => [
        stop,
        ...currentStops.filter(recentStop => recentStop.name !== stop.name)
      ].slice(0, 5));
      setIsSearchFocused(false);
      fetchRoutesForStop(stop.name, stop.stopIds);
    });
  };

  const removeRecentStop = (stopName) => {
    setRemovingRecentStops(currentStops => new Set(currentStops).add(stopName));
  };

  const finishRemovingRecentStop = (stopName) => {
    setRecentStops(currentStops => currentStops.filter(stop => stop.name !== stopName));
    if (recentStops.length === 1 && recentStops[0].name === stopName) setShowRecentStops(false);
    setRemovingRecentStops(currentStops => {
      const nextStops = new Set(currentStops);
      nextStops.delete(stopName);
      return nextStops;
    });
  };

  const handleAddFavorite = (option) => {
    const newFavorite = {
      id: Date.now(),
      stopName: selectedStopName,
      stopId: option.stopId,
      routeId: option.routeId,
      route: option.route,
      directionId: option.directionId,
      headsign: option.headsign,
      type: option.type,           
      color: option.color,         
      textColor: option.textColor  
    };


    const transition = transitionSearchPanel(() => {
      setSelectedStopName(null);
      setSearchQuery('');
      setStopResults([]);
      setDisplayedStopResults([]);
      setRouteOptions([]);
      setSearchPanelMinHeight(null);
    });

    const addFavorite = () => {
      setEnteringFavoriteIds(currentIds => new Set(currentIds).add(newFavorite.id));
      setFavorites(currentFavorites => [newFavorite, ...currentFavorites]);
    };
    if (transition) {
      transition.finished.then(addFavorite, addFavorite);
    } else {
      addFavorite();
    }
  };

  const removeFavorite = (id) => {
    setRemovingFavoriteIds(currentIds => new Set(currentIds).add(id));
    const slot = Array.from(
      favoritesListRef.current?.querySelectorAll('[data-favorite-slot]') ?? []
    ).find(favoriteSlot => favoriteSlot.dataset.favoriteId === String(id));

    if (!(slot instanceof HTMLElement)) {
      finishRemovingFavorite(id);
      return;
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finishRemovingFavorite(id);
      return;
    }

    const duration = 320;
    const slotHeight = slot.getBoundingClientRect().height;
    const nextSlot = slot.nextElementSibling;
    slot.style.overflow = 'hidden';
    slot.style.transition = 'none';
    slot.style.height = `${slotHeight}px`;
    slot.style.minHeight = '0';
    slot.style.flex = '0 0 auto';
    slot.getBoundingClientRect();

    if (!slot.previousElementSibling && nextSlot instanceof HTMLElement) {
      const nextStyles = window.getComputedStyle(nextSlot);
      nextSlot.style.transition = 'none';
      nextSlot.style.marginBlockStart = nextStyles.marginBlockStart;
      nextSlot.getBoundingClientRect();
      nextSlot.style.transition = `margin-block-start ${duration}ms cubic-bezier(0.4, 0, 0.2, 1)`;
    }

    let finished = false;
    let fallbackTimeout;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(fallbackTimeout);
      slot.removeEventListener('transitionend', handleTransitionEnd);
      finishRemovingFavorite(id);
      if (nextSlot instanceof HTMLElement) {
        requestAnimationFrame(() => {
          if (nextSlot.isConnected) nextSlot.style.removeProperty('margin-block-start');
        });
      }
    };
    const handleTransitionEnd = (event) => {
      if (event.target === slot && event.propertyName === 'height') finish();
    };

    slot.addEventListener('transitionend', handleTransitionEnd);
    slot.style.transition = `height ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), margin-block-start ${duration}ms cubic-bezier(0.4, 0, 0.2, 1), opacity ${duration}ms ease`;
    fallbackTimeout = window.setTimeout(finish, duration + 100);
    requestAnimationFrame(() => {
      slot.style.height = '0px';
      slot.style.marginBlockStart = '0px';
      slot.style.opacity = '0';
      if (!slot.previousElementSibling && nextSlot instanceof HTMLElement) {
        nextSlot.style.marginBlockStart = '0px';
      }
    });
  };

  const finishRemovingFavorite = (id) => {
    setFavorites(currentFavorites => currentFavorites.filter(fav => fav.id !== id));
    setRemovingFavoriteIds(currentIds => {
      const nextIds = new Set(currentIds);
      nextIds.delete(id);
      return nextIds;
    });
  };

  const finishEnteringFavorite = (id) => {
    setEnteringFavoriteIds(currentIds => {
      const nextIds = new Set(currentIds);
      nextIds.delete(id);
      return nextIds;
    });
  };

  const createFavoriteDrag = (favorite, index, currentTarget, x, y) => {
    const card = currentTarget.getBoundingClientRect();
    const list = favoritesListRef.current;
    if (!list) return null;

    const otherCenters = Array.from(list.querySelectorAll('[data-favorite-slot]'))
      .filter(slot => slot.dataset.favoriteId !== String(favorite.id))
      .map(slot => {
        const bounds = slot.getBoundingClientRect();
        return bounds.top + bounds.height / 2;
      });

    return {
      id: favorite.id,
      x,
      y,
      offsetX: x - card.left,
      offsetY: y - card.top,
      width: card.width,
      height: card.height,
      originalIndex: index,
      targetIndex: index,
      otherCenters,
      step: card.height + (parseFloat(getComputedStyle(list).rowGap) || 12)
    };
  };

  const reorderFavorite = (drag) => {
    const fromIndex = favorites.findIndex(favorite => favorite.id === drag.id);
    if (fromIndex < 0 || fromIndex === drag.targetIndex) return;

    const reordered = [...favorites];
    const [movingFavorite] = reordered.splice(fromIndex, 1);
    reordered.splice(drag.targetIndex, 0, movingFavorite);
    setFavorites(reordered);
  };

  const handleFavoritePointerDown = (event, favorite, index) => {
    if (event.pointerType === 'touch' || event.button !== 0 || event.target.closest('button')) return;

    const { clientX, clientY, currentTarget, pointerId } = event;
    const drag = createFavoriteDrag(favorite, index, currentTarget, clientX, clientY);
    if (!drag) return;

    setFavoriteDrag({
      ...drag,
      pointerId,
    });
    currentTarget.setPointerCapture(pointerId);
  };

  const cancelFavoriteTouchPress = () => {
    const press = favoriteTouchPressRef.current;
    if (!press) return;

    clearTimeout(press.timeoutId);
    document.removeEventListener('touchmove', press.handleMove);
    document.removeEventListener('touchend', press.handleEnd);
    document.removeEventListener('touchcancel', press.handleCancel);
    favoriteTouchPressRef.current = null;
    favoriteTouchDragRef.current = null;
  };

  const handleFavoriteTouchStart = (event, favorite, index) => {
    if (event.target.closest('button') || event.touches.length !== 1) return;

    cancelFavoriteTouchPress();
    const touch = event.touches[0];
    const currentTarget = event.currentTarget;
    const handleEnd = (endEvent) => finishFavoriteTouch(endEvent, true);
    const handleCancel = (cancelEvent) => finishFavoriteTouch(cancelEvent, false);
    const handleMove = (moveEvent) => {
      const activeTouch = Array.from(moveEvent.touches)
        .find(item => item.identifier === touch.identifier);
      if (!activeTouch) return;

      const drag = favoriteTouchDragRef.current;
      if (!drag) {
        if (Math.hypot(activeTouch.clientX - touch.clientX, activeTouch.clientY - touch.clientY) > 8) {
          cancelFavoriteTouchPress();
        }
        return;
      }

      moveEvent.preventDefault();
      const targetIndex = drag.otherCenters.filter(center => activeTouch.clientY > center).length;
      favoriteTouchDragRef.current = {
        ...drag,
        x: activeTouch.clientX,
        y: activeTouch.clientY,
        targetIndex
      };
      setFavoriteDrag(current => current && ({
        ...current,
        x: activeTouch.clientX,
        y: activeTouch.clientY,
        targetIndex
      }));
    };
    const timeoutId = setTimeout(() => {
      const drag = createFavoriteDrag(
        favorite,
        index,
        currentTarget,
        touch.clientX,
        touch.clientY
      );
      if (!drag) {
        cancelFavoriteTouchPress();
        return;
      }

      favoriteTouchDragRef.current = drag;
      setFavoriteDrag(drag);
    }, 1000);

    favoriteTouchPressRef.current = {
      touchId: touch.identifier,
      timeoutId,
      handleMove,
      handleEnd,
      handleCancel
    };
    document.addEventListener('touchmove', handleMove, { passive: false });
    document.addEventListener('touchend', handleEnd);
    document.addEventListener('touchcancel', handleCancel);
  };

  const finishFavoriteTouch = (event, shouldReorder) => {
    const press = favoriteTouchPressRef.current;
    const touch = Array.from(event.changedTouches)
      .find(item => item.identifier === press?.touchId);
    if (!press || !touch) return;

    const drag = favoriteTouchDragRef.current;
    cancelFavoriteTouchPress();
    if (shouldReorder && drag) reorderFavorite(drag);
    setFavoriteDrag(null);
  };

  const handleFavoritePointerMove = (event) => {
    if (!favoriteDrag || favoriteDrag.pointerId !== event.pointerId) return;

    event.preventDefault();
    const targetIndex = favoriteDrag.otherCenters.filter(center => event.clientY > center).length;
    setFavoriteDrag(current => current && ({
      ...current,
      x: event.clientX,
      y: event.clientY,
      targetIndex
    }));
  };

  const finishFavoriteDrag = (event, shouldReorder) => {
    if (!favoriteDrag || favoriteDrag.pointerId !== event.pointerId) return;

    if (shouldReorder) reorderFavorite(favoriteDrag);
    setFavoriteDrag(null);
  };

  const renderVehicleBadge = (route, type, color, textColor) => {
    return <VehicleBadge route={route} type={type} color={color} textColor={textColor} />;
  };

  const formatAlertDate = (timestamp) => {
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('hu-HU', {
      month: 'short',
      day: 'numeric'
    }).format(new Date(timestamp * 1000));
  };

  const formatAlertClock = (timestamp) => {
    if (!timestamp) return '';
    return new Intl.DateTimeFormat('hu-HU', {
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(timestamp * 1000));
  };

  const toggleTrafficChanges = () => {
    if (showTrafficChanges) {
      setIsLoadingTrafficAlerts(false);
      setShowTrafficChanges(false);
      return;
    }

    if (API_KEY && API_KEY !== 'A_TE_API_KULCSOD') {
      setIsLoadingTrafficAlerts(true);
      setTrafficAlertsError(null);
    }
    setShowTrafficChanges(true);
  };

  const refreshTrafficAlerts = () => {
    setIsLoadingTrafficAlerts(true);
    setTrafficAlertsError(null);
    setTrafficAlertsRefreshKey(key => key + 1);
  };

  const toggleAlertFilter = (filterId) => {
    setSelectedAlertFilters(current => {
      const next = new Set(current);
      if (next.has(filterId)) next.delete(filterId);
      else next.add(filterId);
      return next;
    });
  };

  const visibleTrafficAlerts = trafficAlerts.filter(alert =>
    Array.from(getAlertCategories(alert)).some(category => selectedAlertFilters.has(category))
  );
  const hasSelectedAlertFilters = selectedAlertFilters.size > 0;

  return (
    <div data-theme={theme} className="app-shell min-h-dvh bg-zinc-900 text-white p-4 pt-[calc(1rem+env(safe-area-inset-top,0px))] pb-[calc(5rem+env(safe-area-inset-bottom,0px))] pl-[calc(1rem+env(safe-area-inset-left,0px))] pr-[calc(1rem+env(safe-area-inset-right,0px))] font-sans flex flex-col">
      <div className="max-w-md mx-auto w-full flex-1">
        <div className="relative mb-6 flex items-center justify-center">
          <h1 className="text-2xl font-bold text-center text-violet-300">BudapestGO <i>Rapid</i></h1>
          <button
            type="button"
            onClick={() => setTheme(currentTheme => currentTheme === 'dark' ? 'light' : 'dark')}
            aria-label={theme === 'dark' ? 'Világos mód bekapcsolása' : 'Sötét mód bekapcsolása'}
            title={theme === 'dark' ? 'Világos mód' : 'Sötét mód'}
            className="absolute right-0 flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full bg-zinc-800 text-violet-300 transition-colors hover:bg-zinc-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
          >
            {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>

        <div className="mode-switcher mb-4 grid grid-cols-2 gap-2 rounded-xl border border-zinc-700 bg-zinc-800 p-1" role="group" aria-label="Mentett közlekedési adatok">
          <span
            aria-hidden="true"
            className={`mode-switcher-indicator${dashboardTab === 'routes' ? ' is-routes' : ''}`}
          />
          <button
            type="button"
            aria-pressed={dashboardTab === 'departures'}
            onClick={() => switchDashboardTab('departures')}
            className={`mode-switcher-button relative z-10 flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              dashboardTab === 'departures' ? 'text-white' : 'text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Clock className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">Mentett indulások</span>
          </button>
          <button
            type="button"
            aria-pressed={dashboardTab === 'routes'}
            onClick={() => switchDashboardTab('routes')}
            className={`mode-switcher-button relative z-10 flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
              dashboardTab === 'routes' ? 'text-white' : 'text-zinc-300 hover:bg-zinc-700'
            }`}
          >
            <Route className="h-4 w-4 flex-shrink-0" />
            <span className="truncate">Mentett útvonalak</span>
          </button>
        </div>

        <div className={`dashboard-content${isDashboardContentExiting ? ' is-exiting' : ''}`}>
        {displayedDashboardTab === 'departures' && (
        <div className="bg-zinc-800 p-4 rounded-xl mb-6 shadow-lg border border-zinc-700">
          <h2 className="text-lg font-semibold mb-4 flex items-center">
            <Search className="mr-2 w-5 h-5 text-violet-300" /> Új járat hozzáadása
          </h2>

          <div
            ref={searchRoutePanelRef}
            className="search-route-panel"
            style={searchPanelMinHeight ? { height: `${searchPanelMinHeight}px` } : undefined}
          >
          {!selectedStopName ? (
            <>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  if (!e.target.value && recentStops.length > 0 && isSearchFocused) {
                    setShowRecentStops(true);
                  }
                }}
                onFocus={() => {
                  setIsSearchFocused(true);
                  if (searchQuery.length === 0 && recentStops.length > 0) setShowRecentStops(true);
                }}
                onBlur={() => setIsSearchFocused(false)}
                placeholder="Megálló keresése..."
                className="w-full bg-zinc-700 text-white px-4 py-3 rounded-lg outline-none focus:ring-2 focus:ring-violet-400 border border-zinc-600 text-lg transition-all placeholder:italic"
              />

              <div
                className={`search-suggestions${isSearchSuggestionsOpen ? ' is-open' : ''}`}
                aria-hidden={!isSearchSuggestionsOpen}
                inert={!isSearchSuggestionsOpen}
                onTransitionEnd={(event) => {
                  if (
                    event.target !== event.currentTarget ||
                    event.propertyName !== 'grid-template-rows' ||
                    isSearchSuggestionsOpen
                  ) return;

                  setDisplayedStopResults([]);
                  if (!isSearchFocused || searchQuery.length > 0) setShowRecentStops(false);
                }}
              >
                <div className="search-suggestions-content">
                  {displayedStopResults.length > 0 && (
                    <div className="bg-zinc-700 rounded-lg overflow-hidden mt-2">
                      {displayedStopResults.map(stop => (
                        <button
                          key={stop.name}
                          onClick={() => selectStop(stop)}
                          className="w-full min-w-0 flex items-center p-3 border-b border-zinc-600 hover:bg-zinc-600 transition-colors text-left"
                        >
                          <MapPin className="w-5 h-5 mr-3 text-zinc-400 flex-shrink-0" />
                          <span className="min-w-0 flex-1 truncate font-bold text-base md:text-lg">{stop.name}</span>
                        </button>
                      ))}
                    </div>
                  )}

                  {showRecentStopsPanel && (
                    <div className="bg-zinc-700 rounded-lg overflow-hidden mt-2">
                      <h3 className="px-3 pt-3 pb-2 text-sm font-semibold text-zinc-300">Legutóbbi megállók</h3>
                      {recentStops.map(stop => (
                        <div
                          key={stop.name}
                          onAnimationEnd={() => finishRemovingRecentStop(stop.name)}
                          className={`flex items-center border-t border-zinc-600 ${
                            removingRecentStops.has(stop.name) ? 'recent-stop-exit' : ''
                          }`}
                        >
                          <button
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => selectStop(stop)}
                            disabled={removingRecentStops.has(stop.name)}
                            className="flex-1 flex items-center p-3 hover:bg-zinc-600 transition-colors text-left min-w-0"
                          >
                            <MapPin className="w-5 h-5 mr-3 text-zinc-400 flex-shrink-0" />
                            <span className="font-bold text-base md:text-lg truncate">{stop.name}</span>
                          </button>
                          <button
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => removeRecentStop(stop.name)}
                            disabled={removingRecentStops.has(stop.name)}
                            aria-label={`${stop.name} törlése az előzményekből`}
                            className="flex w-12 flex-shrink-0 self-stretch items-center justify-center text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-400"
                          >
                            <X className="w-5 h-5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

            </>
          ) : (
            <div className="flex h-full min-h-0 flex-col animate-in fade-in slide-in-from-right-4">
              <div className="flex justify-between items-center mb-4 border-b border-zinc-700 pb-2">
                <h3 className="min-w-0 flex-1 font-bold text-violet-300 flex items-center text-lg pr-4 truncate">
                  <MapPin className="w-5 h-5 mr-2 flex-shrink-0" /> <span className="min-w-0 truncate">{selectedStopName}</span>
                </h3>
                <button
                  onClick={() => transitionSearchPanel(() => {
                    setSelectedStopName(null);
                    setRouteOptions([]);
                    setSearchPanelMinHeight(null);
                  })}
                  className="flex h-11 w-11 min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-full bg-zinc-700 transition-colors hover:bg-zinc-600"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {isLoadingRoutes ? (
                <div className="min-h-0 flex-1 text-center py-6 text-zinc-400 flex justify-center items-center">
                  <Clock className="animate-spin w-5 h-5 mr-2" /> Járatok betöltése...
                </div>
              ) : (
                <div className="max-h-[22rem] overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                  {routeOptions.map((opt, idx) => (
                    <button
                      key={idx}
                      onClick={() => handleAddFavorite(opt)}
                      className="w-full bg-zinc-700 hover:bg-violet-700 hover:text-white transition-colors p-3 rounded-lg text-left flex items-center group min-w-0"
                    >
                      <div className="flex items-center font-bold text-lg flex-shrink-0">
                        {renderVehicleBadge(opt.route, opt.type, opt.color, opt.textColor)}
                      </div>
                      <DestinationText className="text-sm opacity-80">
                        {opt.headsign} felé
                      </DestinationText>
                    </button>
                  ))}
                </div>
              )}
              </div>
          )}
          </div>
        </div>
        )}

        {displayedDashboardTab === 'routes' ? (
          <SavedRoutes />
        ) : (
          <>
            <h2 className="text-lg font-semibold mb-3 flex items-center">
              <Clock className="mr-2 w-5 h-5 text-violet-300" /> Mentett indulások
            </h2>
            <p className="-mt-2 mb-3 text-xs text-zinc-500">
              Sorrend átrendezése: Számítógépen fogd meg, majd húzd a kártyát a helyére. Mobilon tartsd lenyomva 1 másodpercig, majd húzd a helyére.
            </p>

            {favorites.length === 0 ? (
              <div className="favorite-empty-enter">
                Keresd meg a megállódat, és adj hozzá járatokat!
              </div>
            ) : (
              <div ref={favoritesListRef} className="favorite-list flex flex-col">
                {favorites.map((fav, index) => {
              const isDragging = favoriteDrag?.id === fav.id;
              const movesDown = favoriteDrag &&
                favoriteDrag.targetIndex < favoriteDrag.originalIndex &&
                index >= favoriteDrag.targetIndex &&
                index < favoriteDrag.originalIndex;
              const movesUp = favoriteDrag &&
                favoriteDrag.targetIndex > favoriteDrag.originalIndex &&
                index > favoriteDrag.originalIndex &&
                index <= favoriteDrag.targetIndex;
              const shift = !isDragging && movesDown
                ? favoriteDrag.step
                : !isDragging && movesUp ? -favoriteDrag.step : 0;
              const times = liveTimes[fav.id];

              return (
                <div
                  key={fav.id}
                  data-favorite-slot
                  data-favorite-id={fav.id}
                  onAnimationEnd={(event) => {
                    if (event.animationName === 'favorite-enter') finishEnteringFavorite(fav.id);
                  }}
                  className={`${favoriteDrag ? 'transition-transform duration-200 ease-out' : 'transition-none'} ${
                    enteringFavoriteIds.has(fav.id) ? 'favorite-enter' : ''
                  }`}
                  style={{
                    ...(shift ? { transform: `translateY(${shift}px)` } : {}),
                    ...(isDragging ? { minHeight: favoriteDrag.height } : {})
                  }}
                >
                  <div
                    onPointerDown={(event) => handleFavoritePointerDown(event, fav, index)}
                    onPointerMove={handleFavoritePointerMove}
                    onPointerUp={(event) => finishFavoriteDrag(event, true)}
                    onPointerCancel={(event) => finishFavoriteDrag(event, false)}
                    onTouchStart={(event) => handleFavoriteTouchStart(event, fav, index)}
                    className={`favorite-animation-content bg-zinc-800 p-4 rounded-xl flex justify-between items-center shadow-md border-l-4 border-violet-400 select-none ${
                      isDragging
                        ? 'fixed z-50 cursor-grabbing scale-[1.02] shadow-2xl ring-2 ring-violet-300'
                        : 'cursor-grab'
                    }`}
                    style={isDragging ? {
                      left: favoriteDrag.x - favoriteDrag.offsetX,
                      top: favoriteDrag.y - favoriteDrag.offsetY,
                      width: favoriteDrag.width,
                      height: favoriteDrag.height,
                      touchAction: 'none'
                    } : undefined}
                  >
                    <div className="min-w-0 flex-1 pr-2 overflow-hidden">
                      <h3 className="font-bold flex items-center text-base md:text-lg truncate">
                        <MapPin className="w-4 h-4 mr-1 text-zinc-400 flex-shrink-0" />
                        <span className="truncate">{fav.stopName}</span>
                      </h3>
                      <div className="flex items-center mt-2 min-w-0 overflow-hidden">
                        {renderVehicleBadge(fav.route, fav.type, fav.color, fav.textColor)}
                        <DestinationText className="text-sm text-zinc-300">
                          {fav.headsign} felé
                        </DestinationText>
                      </div>
                    </div>

                    {/* IDŐPONTOK MEGJELENÍTÉSE */}
                    <div className="flex items-center h-full flex-shrink-0">
                      <div className="flex flex-col items-end mr-3 min-w-[3.5rem]">
                        {times && times[0] !== 'Nincs adat' ? (
                          <>
                            <span className="text-3xl font-bold text-green-400 leading-none">
                              {times[0]}
                            </span>
                            {times.length > 1 && (
                              <span className="text-xs font-semibold text-zinc-400 mt-1 whitespace-nowrap">
                                majd: {times.slice(1).join(', ')}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-lg font-bold text-zinc-500">
                            {times ? times[0] : '...'}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => removeFavorite(fav.id)}
                        disabled={removingFavoriteIds.has(fav.id)}
                        aria-label={`${fav.stopName} ${fav.route} törlése a kedvencekből`}
                        className="flex h-11 w-11 min-h-[44px] min-w-[44px] items-center justify-center rounded-full p-2 text-red-400 transition-colors hover:bg-zinc-700 hover:text-red-300 disabled:pointer-events-none"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                </div>
              );
                })}
              </div>
            )}
            <p className="mt-3 text-center text-xs italic text-zinc-500">
              A valós végállomások a feltüntetettektől eltérhetnek.
            </p>
          </>
        )}
        </div>

        <section className="traffic-changes-section mt-6 overflow-hidden rounded-xl border border-zinc-700 bg-zinc-800 shadow-lg">
          <div className="traffic-changes-header flex items-center">
            <button
              type="button"
              onClick={toggleTrafficChanges}
              aria-expanded={showTrafficChanges}
              aria-controls="traffic-changes-panel"
              className={`traffic-changes-toggle flex min-h-14 flex-1 items-center gap-3 p-4 text-left font-semibold focus-visible:outline-none ${
                showTrafficChanges ? 'rounded-t-xl' : 'rounded-xl'
              }`}
            >
              <Bell className="h-5 w-5 flex-shrink-0 text-violet-300" />
              <span className="flex-1">Forgalmi változások</span>
              {trafficAlerts.length > 0 && (
                <span className="traffic-alert-count rounded-full px-2 py-0.5 text-xs font-bold">
                  {trafficAlerts.length}
                </span>
              )}
              <ChevronDown
                className={`h-5 w-5 text-zinc-400 transition-transform ${showTrafficChanges ? 'rotate-180' : ''}`}
              />
            </button>
            {showTrafficChanges && (
              <button
                type="button"
                onClick={refreshTrafficAlerts}
                disabled={isLoadingTrafficAlerts}
                aria-label="Forgalmi változások frissítése"
                title="Frissítés"
                className="mr-3 flex h-11 w-11 min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-zinc-600 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400 disabled:opacity-50"
              >
                <RefreshCw className={`h-4 w-4 ${isLoadingTrafficAlerts ? 'animate-spin' : ''}`} />
              </button>
            )}
          </div>

          <div
            id="traffic-changes-panel"
            className={`traffic-changes-panel${showTrafficChanges ? ' is-open' : ''}`}
            aria-hidden={!showTrafficChanges}
            inert={!showTrafficChanges}
          >
            <div className={`traffic-changes-panel-content border-zinc-700${showTrafficChanges ? ' is-open' : ''}`}>
              <div className="traffic-alert-filters" role="group" aria-label="Forgalmi változások szűrése">
                {ALERT_FILTERS.map(filter => {
                  const isSelected = selectedAlertFilters.has(filter.id);
                  return (
                    <button
                      key={filter.id}
                      type="button"
                      aria-pressed={isSelected}
                      onClick={() => toggleAlertFilter(filter.id)}
                      className={`traffic-alert-filter min-h-[44px] rounded-full border px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-purple-400 ${
                        isSelected
                          ? 'border-purple-300 bg-purple-600 text-white'
                          : 'border-zinc-600 bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                      }`}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>

              {(!API_KEY || API_KEY === 'A_TE_API_KULCSOD') && (
                <p className="mt-3 text-sm text-red-400" role="alert">
                  A forgalmi változások betöltéséhez állítsd be a BKK API-kulcsot.
                </p>
              )}
              {trafficAlertsError && (
                <div className="mt-3 text-center">
                  <p className="text-sm text-red-400" role="alert">{trafficAlertsError}</p>
                  <button
                    type="button"
                    onClick={refreshTrafficAlerts}
                    className="mt-2 min-h-[44px] rounded-lg bg-zinc-700 px-4 py-2 text-sm font-semibold transition-colors hover:bg-zinc-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
                  >
                    Újrapróbálás
                  </button>
                </div>
              )}

              <div
                className={`traffic-alert-results${hasSelectedAlertFilters ? ' is-open' : ''}`}
                aria-hidden={!hasSelectedAlertFilters}
                inert={!hasSelectedAlertFilters}
              >
                <div className="traffic-alert-results-content">
                  {hasSelectedAlertFilters && isLoadingTrafficAlerts ? (
                    <p className="flex items-center justify-center py-4 text-sm text-zinc-400" role="status">
                      <Clock className="mr-2 h-4 w-4 animate-spin" /> Forgalmi változások betöltése...
                    </p>
                  ) : hasSelectedAlertFilters && (!API_KEY || API_KEY === 'A_TE_API_KULCSOD' || trafficAlertsError) ? null : trafficAlerts.length === 0 ? (
                    <p className="py-3 text-center text-sm text-zinc-400">
                      Jelenleg nincs megjeleníthető aktív forgalmi változás.
                    </p>
                  ) : hasSelectedAlertFilters && visibleTrafficAlerts.length === 0 ? (
                    <p className="py-3 text-center text-sm text-zinc-400">
                      Nincs találat a kiválasztott szűrőkre.
                    </p>
                  ) : hasSelectedAlertFilters && (
                    <ul className="space-y-3">
                      {visibleTrafficAlerts.map(alert => {
                    const header = getTranslatedAlertText(alert.header);
                    const description = getTranslatedAlertText(alert.description);
                    const affectedRoutes = Array.from(
                      new Map((alert.routes || []).map(route => [route.routeId, route])).values()
                    );
                    return (
                      <li key={alert.groupKey} className="traffic-alert-card rounded-lg border border-zinc-600 bg-zinc-700 p-3">
                        <div
                          className="font-semibold text-violet-300"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeAlertHtml(header || 'Forgalmi változás')
                          }}
                        />
                        {affectedRoutes.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-x-2 gap-y-2">
                            {affectedRoutes.map(routeAlert => {
                              const route = routeAlert.route || {};
                              const routeName = route.shortName || route.routeShortName || routeAlert.routeId;
                              const routeDescription =
                                getTranslatedAlertText(routeAlert.affectedEntityDescription) ||
                                getTranslatedAlertText(routeAlert.header);

                              return (
                                <div
                                  key={`${alert.id}-${routeAlert.routeId}`}
                                  className="traffic-alert-route flex max-w-full items-center rounded-md bg-zinc-800/70 px-2 py-1"
                                >
                                  {renderVehicleBadge(routeName, route.type, route.color, route.textColor)}
                                  {routeDescription && (
                                    <span
                                      className="min-w-0 text-sm text-zinc-300"
                                      dangerouslySetInnerHTML={{
                                        __html: sanitizeAlertHtml(routeDescription)
                                      }}
                                    />
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {description && (
                          <div
                            className="mt-2 text-sm leading-relaxed text-zinc-200 [&_li]:ml-5 [&_li]:list-disc [&_ol_li]:list-decimal [&_p]:mb-2 [&_p:last-child]:mb-0 [&_ul]:my-2"
                            dangerouslySetInnerHTML={{ __html: sanitizeAlertHtml(description) }}
                          />
                        )}
                        {alert.occurrences.some(period =>
                          period.start || period.end || getTranslatedAlertText(period.endText)
                        ) && (
                          <div className="mt-3 border-t border-zinc-600 pt-2 text-sm text-zinc-300">
                            <p className="mb-1 font-semibold text-zinc-200">Érvényesség</p>
                            <ul className="space-y-1">
                              {groupAlertPeriods(alert.occurrences).map(period => {
                                const startDate = formatAlertDate(period.start);
                                const endDate = formatAlertDate(period.end);
                                const startTime = formatAlertClock(period.start);
                                const endTime = formatAlertClock(period.end);
                                const endText = getTranslatedAlertText(period.endText);

                                return (
                                  <li key={period.key} className="flex items-start gap-2">
                                    <span className="mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-violet-300" />
                                    {period.count > 1 ? (
                                      <span>
                                        {startDate} – {endDate}
                                        {startTime && endTime && <> · naponta {startTime}–{endTime}</>}
                                      </span>
                                    ) : startDate && startTime && endDate && endTime ? (
                                      <span>{startDate} {startTime} – {endDate} {endTime}</span>
                                    ) : endText ? (
                                      <span dangerouslySetInnerHTML={{ __html: sanitizeAlertHtml(endText) }} />
                                    ) : (
                                      <span>{startDate || startTime || endDate || endTime}</span>
                                    )}
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        )}
                      </li>
                    );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <footer className="mt-8 text-center text-sm text-zinc-400">
        <p>
          GitHub:{' '}
          <a
            href="https://github.com/haresz3714"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-[44px] items-center text-violet-300 underline underline-offset-2 hover:text-white"
          >
            github.com/haresz3714
          </a>
        </p>
        <p className="mt-1">Adatok forrása: BKK Zrt., CC BY 4.0</p>
      </footer>
    </div>
  );
}